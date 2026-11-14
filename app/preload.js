'use strict'
const { contextBridge, ipcRenderer } = require('electron')
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Expected callback')
  const listener = (_, ...args) => callback(...args)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
contextBridge.exposeInMainWorld('aio', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('aio:bootstrap'),
  getPreferences: store => ipcRenderer.invoke('aio:get-preferences', store),
  setPreference: (store, key, value) => ipcRenderer.invoke('aio:set-preference', store, key, value),
  chooseOutputDirectory: () => ipcRenderer.invoke('aio:choose-output-directory'),
  chooseImage: kind => ipcRenderer.invoke('aio:choose-image', kind),
  resizeImage: request => ipcRenderer.invoke('aio:resize-image', request),
  listDrives: () => ipcRenderer.invoke('aio:list-drives'),
  setFullscreen: enabled => ipcRenderer.invoke('aio:set-fullscreen', enabled),
  print: () => ipcRenderer.invoke('aio:print'),
  openExternal: url => ipcRenderer.invoke('aio:open-external', url),
  downloadLegacy: () => ipcRenderer.invoke('aio:download-legacy'),
  updateLegacy: () => ipcRenderer.invoke('aio:update-legacy'),
  resetWindow: () => ipcRenderer.invoke('aio:reset-window'),
  openScreen: screen => ipcRenderer.invoke('aio:open-screen', screen),
  secondaryBootstrap: () => ipcRenderer.invoke('aio:secondary-bootstrap'),
  selectBuiltinImage: name => ipcRenderer.invoke('aio:builtin-image', name),
  chooseJoinedImage: () => ipcRenderer.invoke('aio:joined-image'),
  saveJoinedImage: data => ipcRenderer.invoke('aio:save-joined-image', data),
  setBackgroundRotator: (images, seconds) => ipcRenderer.invoke('aio:background-rotator', images, seconds),
  onImageStaged: callback => subscribe('aio:image-staged', callback),
  chooseTheme: () => ipcRenderer.invoke('aio:choose-theme'),
  revealFolder: name => ipcRenderer.invoke('aio:reveal-folder', name),
  readClipboardText: () => ipcRenderer.invoke('aio:clipboard-read'),
  writeClipboardText: text => ipcRenderer.invoke('aio:clipboard-write', text),
  loadEditor: name => ipcRenderer.invoke('aio:editor-load', name),
  saveEditor: (name, value) => ipcRenderer.invoke('aio:editor-save', name, value),
  importEditor: name => ipcRenderer.invoke('aio:editor-import', name),
  exportEditor: (name, value) => ipcRenderer.invoke('aio:editor-export', name, value),
  loadMessages: () => ipcRenderer.invoke('aio:messages-load'),
  saveMessages: (language, messages) => ipcRenderer.invoke('aio:messages-save', language, messages),
  resetMessages: () => ipcRenderer.invoke('aio:messages-reset'),
  compile: request => ipcRenderer.invoke('aio:compile', request),
  onProgress: callback => subscribe('aio:progress', callback),
  onMenuAction: callback => subscribe('aio:menu-action', callback),
  onPreferencesChanged: callback => subscribe('aio:preferences-changed', callback),
  onFlushRequest: callback => subscribe('aio:flush-request', callback),
  acknowledgeFlush: (token, error) => ipcRenderer.invoke('aio:flush-ack', token, error)
}))
