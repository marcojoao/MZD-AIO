'use strict'
const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
async function readRegular (source) {
  const handle = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error('Unsafe image source')
    return await handle.readFile()
  } finally { await handle.close() }
}
async function writeAtomic (directory, filename, data) {
  await fs.mkdir(directory, { recursive: true })
  const before = await fs.lstat(directory)
  if (!before.isDirectory() || before.isSymbolicLink() || await fs.realpath(directory) !== path.resolve(directory)) throw Error('Unsafe staging directory')
  const target = path.join(directory, filename)
  try { const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unsafe output leaf') } catch (e) { if (e.code !== 'ENOENT') throw e }
  const temp = path.join(directory, '.' + filename + '.' + randomUUID())
  let handle
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null
    const after = await fs.lstat(directory)
    if (after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink()) throw Error('Unsafe staging replacement')
    await fs.rename(temp, target)
  } finally { if (handle) await handle.close(); await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e }) }
}
function createNativeAdapters ({ electron, window, imageParent, drives, testMode = false }) {
  const choose = async options => {
    if (testMode) return null // Never show native UI during hidden automation.
    const result = await electron.dialog.showOpenDialog(window, options)
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
  }
  return {
    imageParent,
    dialogs: {
      chooseOutputDirectory: () => choose({ properties: ['openDirectory'] }),
      chooseImage: kind => choose({ title: 'Choose ' + kind + ' image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }] })
    },
    images: { async resizeToPng ({ source, width, height }) {
      const image = electron.nativeImage.createFromBuffer(await readRegular(source))
      if (image.isEmpty()) throw Error('Could not decode image')
      return image.resize({ width, height }).toPNG()
    } },
    files: { async writePng ({ directory, filename, data }) {
      if (directory !== path.join(imageParent, '_copy_to_usb') || !['background.png', 'OffScreenBackground.png', 'no_artwork_icon.png'].includes(filename)) throw Error('Unsafe image destination')
      await writeAtomic(directory, filename, data)
    } },
    drives: { list: () => { if (testMode) throw Error('Drive enumeration disabled in hidden test mode'); return drives.list() } },
    window: { async setFullscreen (enabled) { if (!testMode) window.setFullScreen(enabled) }, print: () => new Promise((resolve, reject) => {
      if (testMode) return reject(Error('Native printing disabled in hidden test mode'))
      window.webContents.print({}, (ok, reason) => ok ? resolve() : reject(Error(reason)))
    }) },
    external: { async open (url) { if (testMode) throw Error('External launch disabled in hidden test mode'); await electron.shell.openExternal(url) } }
  }
}
module.exports = { createNativeAdapters, readRegular, writeAtomic }
