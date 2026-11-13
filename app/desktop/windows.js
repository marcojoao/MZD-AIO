'use strict'
const path = require('node:path')
const { fileURLToPath } = require('node:url')
function ownsPage (url, page) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'file:' && !parsed.host && path.resolve(fileURLToPath(parsed)) === path.resolve(page)
  } catch (_) { return false }
}
function windowOptions (preload) {
  return { show: false, width: 1280, height: 800, webPreferences: { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false } }
}
function secureWindow (win, page) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const event of ['will-navigate', 'will-redirect']) win.webContents.on(event, (event, url) => {
    if (!ownsPage(url, page)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', event => event.preventDefault())
}
function attachCloseBarrier (win, flush, onError) {
  let closing = false
  win.on('close', event => {
    event.preventDefault()
    if (closing) return
    closing = true
    Promise.resolve().then(flush).then(() => win.destroy(), error => { closing = false; onError(error) })
  })
}
module.exports = { ownsPage, windowOptions, secureWindow, attachCloseBarrier }
