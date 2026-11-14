'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { readRegular, writeAtomic } = require('./native-adapters')
const { validateValue } = require('../assets/js/desktop-client')
const { resolveOutputDirectory } = require('./policy')
function createExtraMethods ({ electron, preferences, userData, imageParent, resources, testMode, openScreen, requestFlushAck, imageStaged = () => {}, preferencesChanged = () => {} }) {
  const themeGrants = new Map()
  const compile = require('./services').createCompilationService(require('./compiler').createCompiler({
    resources, userData, imageParent,
    getState: async user => {
      const theme = themeGrants.get(user.customTheme?.token)
      // Acknowledged preference state, not renderer-provided filenames or metadata.
      const data = await preferences.getPreferences('aio-data')
      return { backgroundRotator: data.backgroundRotator, theme }
    }
  }))
  const editorNames = { translator: 'aio-translate-save', speedo: 'speedo-config' }
  const editorName = name => { if (!Object.hasOwn(editorNames, name)) throw Error('Invalid editor'); return editorNames[name] }
  const object = value => { validateValue(value); if (!value || Array.isArray(value) || typeof value !== 'object' || JSON.stringify(value).length > 4 * 1024 * 1024) throw Error('Invalid editor object'); return value }
  const loadEditor = async name => {
    const file = editorName(name) + '.json'
    for (const dir of [path.join(userData, 'editors'), userData]) {
      try { return object(JSON.parse((await readRegular(path.join(dir, file))).toString())).data || null } catch (e) { if (e.code !== 'ENOENT') throw e }
    }
    return null
  }
  // Queue by exact persistent target. A rejected request stays rejected to its
  // caller, but does not poison later requests (or the scoped IPC drain).
  const tails = new Map()
  function ordered (target, operation) {
    const result = (tails.get(target) || Promise.resolve()).then(operation)
    const tail = result.catch(() => {})
    tails.set(target, tail)
    tail.then(() => { if (tails.get(target) === tail) tails.delete(target) })
    return result
  }
  const saveEditor = async (name, value) => {
    const file = editorName(name)
    const bytes = JSON.stringify({ data: object(value) })
    return ordered('editor:' + file, async () => { await writeAtomic(path.join(userData, 'editors'), file + '.json', bytes); return JSON.parse(bytes).data })
  }
  const choose = async (scope, options) => { if (testMode) return null; const result = await electron.dialog.showOpenDialog(scope.win(), options); return result.canceled ? null : result.filePaths[0] || null }
  async function stageImage (source, kind, resize = true) {
    const image = electron.nativeImage.createFromBuffer(await readRegular(source))
    if (image.isEmpty()) throw Error('Could not decode image')
    return stageNative(image, kind, resize)
  }
  async function stageNative (image, kind, resize) {
    const size = kind === 'album' ? { width: 146, height: 146 } : { width: 800, height: 480 }
    const result = resize ? image.resize(size) : image
    const filename = { background: 'background.png', offscreen: 'OffScreenBackground.png', album: 'no_artwork_icon.png' }[kind]
    const destination = path.join(imageParent, '_copy_to_usb', filename)
    await writeAtomic(path.dirname(destination), filename, result.toPNG())
    const staged = { kind, destination, ...result.getSize() }
    imageStaged(staged)
    return staged
  }
  const messageFile = path.join(resources, 'files/tweaks/config/message_replies/jci/settings/configurations/blm_msg-system.xml')
  const messageDir = path.join(userData, 'messages')
  const xml = require('xml2js')
  // Current edits override read-only legacy edits, then bundled defaults. Reset
  // writes defaults to the current target, so a legacy copy cannot reappear.
  const legacyMessageFile = path.join(userData, 'background/message_replies/jci/settings/configurations/blm_msg-system.xml')
  async function loadMessages () {
    for (const file of [path.join(messageDir, 'blm_msg-system.xml'), legacyMessageFile, messageFile]) {
      try { return await xml.parseStringPromise(await readRegular(file)) } catch (e) { if (e.code !== 'ENOENT') throw e }
    }
    throw Error('Message defaults missing')
  }
  const method = (count, run) => ({ count, run })
  return {
    'reset-window': method(0, async scope => { if (!testMode) { scope.win().setSize(1280, 800); scope.win().center() } }),
    'open-screen': method(1, (_, name) => { if (!['info', 'joiner'].includes(name)) throw Error('Invalid screen'); return openScreen(name) }),
    'secondary-bootstrap': method(0, async scope => { const data = await preferences.bootstrap(); return { app: data.app, screen: scope.screen, labels: { imgOps: data.language.messages.imgOps, menu: data.language.messages.menu } } }),
    'builtin-image': method(1, async (_, name) => {
      const builtin = { background: ['default/default.png', 'background'], offscreen: ['default/OffScreenBackground.png', 'offscreen'], album: ['blank-album-art/no_artwork_icon.png', 'album'], transparent: ['blank-album-art/no_artwork_icon_blank.png', 'album'] }
      if (!Object.hasOwn(builtin, name)) throw Error('Invalid built-in image')
      return stageImage(path.join(resources, '../background-images', builtin[name][0]), builtin[name][1])
    }),
    'joined-image': method(0, async scope => { const source = await choose(scope, { properties: ['openFile'], filters: [{ name: 'Joined image', extensions: ['png', 'jpg', 'jpeg'] }] }); return source ? stageImage(source, 'background', false) : null }),
    'save-joined-image': method(1, async (_, data) => {
      if (typeof data !== 'string' || data.length > 48 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data)) throw Error('Invalid joined PNG')
      const image = electron.nativeImage.createFromBuffer(Buffer.from(data.split(',')[1], 'base64'))
      if (image.isEmpty()) throw Error('Could not decode joined image')
      return stageNative(image, 'background', false)
    }),
    'background-rotator': method(2, async (_, images, seconds) => {
      if (!Number.isInteger(images) || images < 1 || images > 100 || !Number.isInteger(seconds) || seconds < 10 || seconds > 300) throw Error('Invalid background rotator selection')
      await preferences.setPreference('aio-data', 'backgroundRotator', { images, seconds })
      preferencesChanged('aio-data')
    }),
    'choose-theme': method(0, async scope => { const source = await choose(scope, { properties: ['openDirectory'], title: 'Choose theme JCI folder' }); if (!source) return null; const stat = await fs.lstat(source); if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Unsafe theme directory'); if (scope.theme) themeGrants.delete(scope.theme.token); scope.theme = { source: await fs.realpath(source), token: randomUUID() }; themeGrants.set(scope.theme.token, scope.theme); return { token: scope.theme.token, name: path.basename(source) } }),
    'reveal-folder': method(1, async (_, name) => {
      const folders = { defaults: path.join(resources, '../background-images/default'), downloads: path.join(userData, 'color-schemes'), apk: path.join(resources, '../castscreenApp') }
      if (name === 'output') { const saved = await preferences.getPreferences('aio-persist'); folders.output = resolveOutputDirectory(saved.copyFolderLocation) }
      if (!Object.hasOwn(folders, name)) throw Error('Invalid folder')
      if (testMode) throw Error('Folder reveal disabled in hidden test mode')
      const error = await electron.shell.openPath(folders[name]); if (error) throw Error(error)
    }),
    'clipboard-read': method(0, () => testMode ? '' : electron.clipboard.readText()),
    'clipboard-write': method(1, (_, text) => { if (typeof text !== 'string' || text.length > 1048576) throw Error('Invalid clipboard text'); if (!testMode) electron.clipboard.writeText(text) }),
    'editor-load': method(1, (_, name) => loadEditor(name)),
    'editor-save': method(2, (_, name, value) => saveEditor(name, value)),
    'editor-import': method(1, async (scope, name) => { editorName(name); const source = await choose(scope, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] }); return source ? object(JSON.parse((await readRegular(source)).toString())) : null }),
    'editor-export': method(2, async (scope, name, value) => {
      editorName(name); object(value); if (testMode) return null
      const result = await electron.dialog.showSaveDialog(scope.win(), { defaultPath: name + '.aio.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (result.canceled || !result.filePath) return null
      await writeAtomic(path.dirname(result.filePath), path.basename(result.filePath), JSON.stringify(value, null, 2)); return true
    }),
    'messages-load': method(0, () => loadMessages()),
    'messages-save': method(2, async (_, language, messages) => {
      if (typeof language !== 'string' || !Array.isArray(messages) || messages.some(x => typeof x !== 'string' || x.length > 4096)) throw Error('Invalid messages')
      messages = messages.slice()
      return ordered('messages', async () => {
        const data = await loadMessages(); const node = data.Node.Node[0].Node.find(x => x.$.key === language)
        if (!node || node.Node.length !== messages.length) throw Error('Invalid message language/count')
        node.Node.forEach((x, i) => { x.$.value = messages[i] })
        await writeAtomic(messageDir, 'blm_msg-system.xml', new xml.Builder({ headless: true }).buildObject(data))
      })
    }),
    'messages-reset': method(0, () => ordered('messages', async () => { const bytes = await readRegular(messageFile); const data = await xml.parseStringPromise(bytes); await writeAtomic(messageDir, 'blm_msg-system.xml', bytes); return data })),
    compile: method(1, (scope, request) => compile(request, event => {
      const owner = scope.getWebContents()
      if (owner && !owner.isDestroyed()) owner.send('aio:progress', event)
    })),
    'flush-ack': method(2, (scope, token, error) => { if (typeof token !== 'string' || !(error === null || typeof error === 'string')) throw Error('Invalid flush acknowledgement'); requestFlushAck(scope, token, error) })
  }
}
module.exports = { createExtraMethods }
