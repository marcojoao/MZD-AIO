'use strict'
const { createSenderGuard } = require('./ipc-sender')
function registerPreferenceIpc ({ ipcMain, service, getWebContents, indexPath }) {
  const guard = createSenderGuard({ getWebContents, indexPath })
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
