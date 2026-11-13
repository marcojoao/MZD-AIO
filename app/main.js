'use strict'
if (process.env.MZD_AIO_TEST === '1') console.log('HIDDEN_MAIN_ENTERED')
const electron = require('electron')
const { app, BrowserWindow, ipcMain, Menu } = electron
const path = require('node:path')
const fs = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const { createPreferenceService } = require('./desktop/preferences')
const { registerPreferenceIpc } = require('./desktop/preferences-ipc')
const { createDesktopServices, registerServiceIpc, SERVICE_INTERFACE } = require('./desktop/services')
const { createNativeAdapters } = require('./desktop/native-adapters')
const { windowOptions, secureWindow, attachCloseBarrier } = require('./desktop/windows')
const { registerScopedIpc } = require('./desktop/scoped-ipc')
const { createExtraMethods } = require('./desktop/extra-methods')
const testMode = process.env.MZD_AIO_TEST === '1'
// Capture legacy location before any product naming changes. Test mode must explicitly
// supply its own userData and never probes the real installation.
const legacyDirectory = testMode ? process.env.MZD_AIO_TEST_USER_DATA : app.getPath('userData')
if (testMode && (!legacyDirectory || !path.isAbsolute(legacyDirectory) || !process.env.MZD_AIO_TEST_OUTPUT)) throw Error('Explicit isolated test paths required')
if (testMode) {
  app.setPath('userData', legacyDirectory)
  app.setPath('sessionData', path.join(legacyDirectory, 'session'))
  app.dock?.hide()
}
const pjson = require('./package.json')
let primary
const children = new Map()
const pendingFlush = new Map()
const runtimeErrors = []
const reportError = error => {
  console.error(error.stack || error)
  if (!testMode) electron.dialog.showErrorBox('MZD-AIO', error.message)
}
process.on('uncaughtException', error => { runtimeErrors.push(String(error)); reportError(error); if (testMode) app.exit(1) })
process.on('unhandledRejection', error => { runtimeErrors.push(String(error)); reportError(error); if (testMode) app.exit(1) })
async function start () {
  await fs.mkdir(legacyDirectory, { recursive: true })
  const imageParent = path.join(legacyDirectory, 'image-staging')
  await fs.mkdir(imageParent, { recursive: true })
  const preferences = createPreferenceService({ directory: path.join(legacyDirectory, 'preferences'), legacyDirectory,
    resourceDirectory: __dirname, app: { name: pjson.productName, version: pjson.version },
    paths: { home: __dirname, userData: legacyDirectory, desktop: testMode ? process.env.MZD_AIO_TEST_OUTPUT : app.getPath('desktop'), documents: testMode ? legacyDirectory : app.getPath('documents') } })
  await preferences.bootstrap()
  await preferences.setPreference('aio-persist', 'AIO-Ver', pjson.version)
  function makeWindow (page, dimensions = {}) {
    const win = new BrowserWindow({ ...windowOptions(path.join(__dirname, 'preload.js')), ...dimensions })
    secureWindow(win, page)
    win.webContents.on('preload-error', (_, preload, error) => runtimeErrors.push('preload: ' + error.message))
    win.webContents.on('console-message', event => { if (event.level === 'error') runtimeErrors.push('renderer: ' + event.message) })
    if (testMode) {
      // CDP is main-owned test instrumentation, never a renderer capability.
      win.webContents.debugger.attach('1.3')
      win.webContents.debugger.on('message', (_, method, params) => {
        if (method === 'Runtime.exceptionThrown') runtimeErrors.push('exception: ' + JSON.stringify(params.exceptionDetails))
      })
      win.webContents.debugger.sendCommand('Runtime.enable').catch(error => runtimeErrors.push(String(error)))
    }
    win.webContents.on('render-process-gone', (_, details) => runtimeErrors.push('renderer gone: ' + details.reason))
    // No remote executable content or legacy services, even outside test mode.
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|data:|blob:|devtools:)/.test(details.url) }))
    if (!testMode) win.once('ready-to-show', () => win.show())
    return win
  }
  const indexPath = path.join(__dirname, 'index.html')
  if (testMode) {
    const binding = require('./node_modules/drivelist/build/Release/drivelist.node')
    const image = electron.nativeImage.createFromPath(path.join(__dirname, '../background-images/default/default.png'))
    if (image.isEmpty()) throw Error('Bundled default image failed native decode')
    const dimensions = image.resize({ width: 800, height: 480 }).getSize()
    console.log('REAL_NATIVE_CHECK', JSON.stringify({ drivelist: require('drivelist/package.json').version, exports: Object.keys(binding), dimensions }))
  }
  primary = makeWindow(indexPath)
  const service = { ...createDesktopServices(createNativeAdapters({ electron, window: primary, imageParent, drives: require('drivelist'), testMode })) }
  const chooseOutput = service.chooseOutputDirectory.bind(service)
  service.chooseOutputDirectory = async () => {
    const destination = await chooseOutput()
    if (destination !== null) {
      await preferences.setPreference('aio-persist', 'copyFolderLocation', path.dirname(destination))
      primary.webContents.send('aio:preferences-changed', 'aio-persist')
    }
    return destination
  }
  registerPreferenceIpc({ ipcMain, service: preferences, getWebContents: () => primary?.webContents, indexPath })
  registerServiceIpc({ ipcMain, service, getWebContents: () => primary?.webContents, indexPath, capabilities: Object.keys(SERVICE_INTERFACE) })
  const primaryScope = { screen: 'primary', win: () => primary, getWebContents: () => primary?.webContents, indexPath, capabilities: [] }
  const secondaryScopes = ['joiner', 'info'].map(screen => ({ screen, win: () => children.get(screen), getWebContents: () => children.get(screen)?.webContents, indexPath: path.join(__dirname, 'views', screen + '.html'), capabilities: screen === 'joiner' ? ['secondary-bootstrap', 'joined-image', 'save-joined-image', 'background-rotator'] : ['secondary-bootstrap'] }))
  async function openScreen (name) {
    if (children.has(name)) { if (!testMode) children.get(name).focus(); return }
    const scope = secondaryScopes.find(x => x.screen === name)
    const win = makeWindow(scope.indexPath, { width: name === 'joiner' ? 1600 : 600, height: 650, parent: primary })
    children.set(name, win); win.on('closed', () => children.delete(name))
    await win.loadFile(scope.indexPath)
  }
  const methods = createExtraMethods({ electron, preferences, userData: legacyDirectory, imageParent, resources: __dirname, testMode, openScreen,
    imageStaged: result => primary?.webContents.send('aio:image-staged', result),
    preferencesChanged: store => primary?.webContents.send('aio:preferences-changed', store),
    requestFlushAck (scope, token, error) {
      const pending = pendingFlush.get(token)
      if (!pending || scope.screen !== 'primary') throw Error('Unknown flush acknowledgement')
      pendingFlush.delete(token); clearTimeout(pending.timer)
      if (error !== null) pending.reject(Error(error)); else pending.resolve()
    } })
  primaryScope.capabilities = Object.keys(methods).filter(name => name !== 'secondary-bootstrap')
  const drainScoped = registerScopedIpc({ ipcMain, scopes: [primaryScope, ...secondaryScopes], methods })
  attachCloseBarrier(primary, async () => {
    await new Promise((resolve, reject) => {
      const token = randomUUID()
      const timer = setTimeout(() => { pendingFlush.delete(token); reject(Error('Renderer preference flush timed out; window remains open')) }, 10000)
      pendingFlush.set(token, { resolve, reject, timer })
      primary.webContents.send('aio:flush-request', token)
    })
    await drainScoped()
    const saved = await preferences.getPreferences('aio-persist')
    await preferences.setPreference('aio-persist', 'visits', Number(saved.visits || 0) + 1)
  }, reportError)
  app.on('before-quit', event => {
    if (primary) { event.preventDefault(); primary.close() }
  })
  primary.on('closed', () => { primary = null; if (!testMode) app.quit() })
  Menu.setApplicationMenu(testMode ? null : Menu.buildFromTemplate([
    { label: pjson.productName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'Save selections', accelerator: 'CmdOrCtrl+S', click: () => primary?.webContents.send('aio:menu-action', 'save-options') },
      { label: 'Load selections', accelerator: 'CmdOrCtrl+L', click: () => primary?.webContents.send('aio:menu-action', 'load-options') },
      { label: 'Load Last Compile', accelerator: 'CmdOrCtrl+Shift+L', click: () => primary?.webContents.send('aio:menu-action', 'load-last') },
      { label: 'Choose output folder', click: () => service.chooseOutputDirectory().catch(reportError) },
      { label: 'Print', click: () => service.print().catch(reportError) }, { role: 'close' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [{ label: 'About', click: () => openScreen('info').catch(reportError) }, { label: 'Image joiner', click: () => openScreen('joiner').catch(reportError) }] }
  ]))
  await primary.loadFile(indexPath)
  if (testMode) await require('./desktop/hidden-smoke')({ app, primary, openScreen, children, service, imageParent, runtimeErrors, output: process.env.MZD_AIO_TEST_OUTPUT })
}
// The hidden launcher owns a scratch-only OS file lock: Chromium's native
// singleton socket directory is denied by the outer sandbox. Production always
// uses Electron's lock, before any migration/write/window creation.
if (!testMode && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!testMode && primary) {
      if (primary.isMinimized()) primary.restore()
      primary.focus()
    }
  })
  app.whenReady().then(start).catch(error => { reportError(error); app.exit(1) })
  app.on('window-all-closed', () => { if (!testMode) app.quit() })
}
