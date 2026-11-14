'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { resolveOutputDirectory, isEligibleDrive, validateExternalUrl } = require('./policy')
const { createSenderGuard } = require('./ipc-sender')

const IMAGE_KINDS = Object.freeze({
  background: Object.freeze({ filename: 'background.png', width: 800, height: 480 }),
  offscreen: Object.freeze({ filename: 'OffScreenBackground.png', width: 800, height: 480 }),
  album: Object.freeze({ filename: 'no_artwork_icon.png', width: 146, height: 146 })
})
const SERVICE_INTERFACE = Object.freeze(Object.fromEntries(Object.entries({
  chooseOutputDirectory: { channel: 'aio:choose-output-directory', args: [] },
  chooseImage: { channel: 'aio:choose-image', args: ['kind'] },
  resizeImage: { channel: 'aio:resize-image', args: ['request'] },
  listDrives: { channel: 'aio:list-drives', args: [] },
  setFullscreen: { channel: 'aio:set-fullscreen', args: ['enabled'] },
  print: { channel: 'aio:print', args: [] },
  openExternal: { channel: 'aio:open-external', args: ['url'] },
  downloadLegacy: { channel: 'aio:download-legacy', args: [] },
  updateLegacy: { channel: 'aio:update-legacy', args: [] }
}).map(([name, spec]) => [name, Object.freeze({ channel: spec.channel, args: Object.freeze(spec.args) })])))

function imageSpec (kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(IMAGE_KINDS, kind)) throw new Error('Unknown image kind')
  return IMAGE_KINDS[kind]
}
function validPath (value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
    path.isAbsolute(value) && !value.split(path.sep).includes('..')
}
function checkDestination (directory, filename) {
  try {
    const entry = fs.lstatSync(path.join(directory, filename))
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Unsafe image destination')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

// Only main constructs these adapters/configuration. Never spread renderer payloads
// into adapter requests. No preferences are changed by choosing or resizing.
function createDesktopServices (trustedAdapters) {
  const { dialogs, images, files, drives, window, external, imageParent, policyOptions } = trustedAdapters
  const grants = new Map()
  const disabled = async () => { throw new Error('Legacy downloads and updates are disabled') }
  return Object.freeze({
    async chooseOutputDirectory () {
      const parent = await dialogs.chooseOutputDirectory()
      if (parent === null) return null
      if (!validPath(parent)) throw new Error('Invalid output dialog result')
      return resolveOutputDirectory(parent, policyOptions)
    },
    async chooseImage (kind) {
      imageSpec(kind)
      const chosen = await dialogs.chooseImage(kind)
      if (chosen === null) return null
      if (!validPath(chosen)) throw new Error('Invalid image dialog result')
      const source = fs.realpathSync(chosen)
      const stat = fs.statSync(source)
      if (!stat.isFile()) throw new Error('Invalid image dialog result: not a file')
      const token = randomUUID()
      grants.set(kind, { token, source, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs })
      return token
    },
    async resizeImage (request) {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          Object.keys(request).length !== 2 || !Object.hasOwn(request, 'kind') ||
          !Object.hasOwn(request, 'source') || typeof request.source !== 'string') throw new Error('Invalid image payload/source')
      const { kind, source } = request
      const spec = imageSpec(kind)
      const grant = grants.get(kind)
      if (!grant || grant.token !== source) throw new Error('Image source is not authorized by chooser')
      // One attempt per grant, including native failures; wrong-kind attempts do not consume it.
      grants.delete(kind)
      const current = fs.lstatSync(grant.source)
      if (!current.isFile() || ['dev', 'ino', 'size', 'mtimeMs'].some(key => current[key] !== grant[key])) throw new Error('Chosen image source changed; choose it again')
      const directory = resolveOutputDirectory(imageParent, policyOptions)
      checkDestination(directory, spec.filename)
      // Match legacy nativeImage.resize({width, height}).toPNG(): both dimensions,
      // no added crop/contain/cover operation. Decoder validity belongs to adapter.
      const data = await images.resizeToPng({ source: grant.source, width: spec.width, height: spec.height })
      if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('Invalid image output from native adapter')
      // Async decoding may yield; recheck the parent/leaf before writer invocation.
      if (resolveOutputDirectory(imageParent, policyOptions) !== directory) throw new Error('Image output directory changed')
      checkDestination(directory, spec.filename)
      // Real writer must atomically replace the leaf without following symlinks and
      // must bind directory creation/writes to this validated directory (Task 4B).
      await files.writePng({ directory, filename: spec.filename, data })
      return { kind, destination: path.join(directory, spec.filename), width: spec.width, height: spec.height }
    },
    async listDrives () {
      const result = await drives.list()
      if (!Array.isArray(result)) throw new Error('Invalid native drive list')
      return result.filter(isEligibleDrive).map(drive => ({
        device: typeof drive.device === 'string' ? drive.device : '',
        description: typeof drive.description === 'string' ? drive.description : '',
        isSystem: false,
        isRemovable: true,
        mountpoints: drive.mountpoints.map(mountpoint => ({ path: mountpoint.path }))
      }))
    },
    async setFullscreen (enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Fullscreen requires a boolean')
      await window.setFullscreen(enabled)
    },
    async print () { await window.print() },
    async openExternal (url) { await external.open(validateExternalUrl(url)) },
    downloadLegacy: disabled,
    updateLegacy: disabled
  })
}

// Invoke/reply only: no unsolicited events, raw ipcRenderer or generic dispatch.
// Register once globally. Every owner has its own service (chooser grants/window
// adapters) and exact page, with explicit capabilities even for the primary page.
function registerServiceIpc ({ ipcMain, service, getWebContents, indexPath, capabilities, additionalScopes = [] }) {
  if (!Array.isArray(additionalScopes)) throw new Error('Invalid service capabilities/scopes')
  const scopes = [{ service, getWebContents, indexPath, capabilities }, ...additionalScopes].map(scope => {
    if (!scope || !Array.isArray(scope.capabilities) || new Set(scope.capabilities).size !== scope.capabilities.length ||
        !scope.capabilities.every(name => typeof name === 'string' && Object.hasOwn(SERVICE_INTERFACE, name))) throw new Error('Invalid service capabilities')
    return { service: scope.service, capabilities: new Set(scope.capabilities), guard: createSenderGuard(scope) }
  })
  const methods = new Set(scopes.flatMap(scope => [...scope.capabilities]))
  for (const name of methods) {
    const { channel, args } = SERVICE_INTERFACE[name]
    ipcMain.handle(channel, async (event, ...values) => {
      let owner
      for (const scope of scopes) {
        try { scope.guard(event); owner = scope; break } catch (_) {}
      }
      if (!owner) throw new Error('Invalid sender/frame or sender/frame URL')
      if (!owner.capabilities.has(name)) throw new Error('Service capability is not granted')
      if (values.length !== args.length) throw new Error('Invalid service arguments')
      return owner.service[name](...values)
    })
  }
}

// Request-only seam: transport authorization still belongs to the exact owned
// window/frame guard in registerScopedIpc. Configuration never crosses IPC.
function createCompilationService (compiler) {
  return async (request, onProgress) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'options,outputParent') throw Error('Invalid compilation request')
    return compiler.compile({ options: request.options, outputParent: request.outputParent }, onProgress)
  }
}
module.exports = { createDesktopServices, registerServiceIpc, SERVICE_INTERFACE, createCompilationService }
