'use strict'
const { fileURLToPath } = require('node:url')
const path = require('node:path')
function registerPreferenceIpc ({ ipcMain, service, getWebContents, indexPath }) {
  function guard (event) {
    const contents = getWebContents()
    if (!contents || event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame) throw new Error('Invalid preference sender/frame')
    const url = new URL(event.senderFrame.url)
    if (url.protocol !== 'file:' || url.host || path.resolve(fileURLToPath(url)) !== path.resolve(indexPath)) throw new Error('Invalid preference sender/frame URL')
    return url
  }
  const handle = (channel, count, action) => ipcMain.handle(channel, async (event, ...args) => {
    const url = guard(event)
    if (args.length !== count) throw new Error('Invalid preference arguments')
    return action(url, ...args)
  })
  handle('aio:bootstrap', 0, async url => {
    const language = url.searchParams.get('lang')
    if (['english', 'french', 'magyar', 'german'].includes(language)) await service.setPreference('aio-persist', 'lang', language)
    return service.bootstrap()
  })
  handle('aio:get-preferences', 1, (_, store) => service.getPreferences(store))
  handle('aio:set-preference', 3, (_, store, key, value) => service.setPreference(store, key, value))
}
module.exports = { registerPreferenceIpc }
