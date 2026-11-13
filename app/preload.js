'use strict'
const { contextBridge, ipcRenderer } = require('electron')
// No transport, Node, filesystem, remote, or protection configuration crosses this bridge.
contextBridge.exposeInMainWorld('aio', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('aio:bootstrap'),
  getPreferences: store => ipcRenderer.invoke('aio:get-preferences', store),
  setPreference: (store, key, value) => ipcRenderer.invoke('aio:set-preference', store, key, value)
}))
