'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { createRequire } = require('node:module')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')
test('main composes actual migration, scoped IPC, secure production defaults and acknowledged close writes', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'main-prefs-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  const original = '{ "lang": "french", "visits": 3, "untouched": "keep" }\n'
  await fsp.writeFile(path.join(root, 'aio-persist.json'), original)
  const handlers = new Map(), errors = [], windows = [], sent = []; let ready, startup, template, quits = 0, uploads = 0
  const app = new EventEmitter()
  Object.assign(app, { requestSingleInstanceLock: () => true, getPath: () => root, whenReady: () => ({ then(fn) { ready = () => { startup = fn(); return startup }; return { catch() {} } } }), quit() { quits++ }, exit(code) { errors.push('exit ' + code) } })
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; windows.push(this)
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { setWindowOpenHandler() {}, session: { webRequest: { onBeforeRequest() {} } }, send: (channel, token) => {
        sent.push([channel, token])
        if (channel === 'aio:flush-request') {
          const frame = this.webContents.mainFrame
          handlers.get('aio:flush-ack')({ sender: this.webContents, senderFrame: frame }, token, null).catch(e => errors.push(e))
        }
      } })
    }
    async loadFile(page) { this.webContents.mainFrame = { url: pathToFileURL(page).href } }
    destroy() { this.emit('closed') }
    show() { throw Error('Unit must never show a window') }
  }
  const electron = { app, BrowserWindow, ipcMain: { handle(name, fn) { assert.equal(handlers.has(name), false); handlers.set(name, fn) } }, Menu: { setApplicationMenu() {}, buildFromTemplate: x => { template = x; return x } }, dialog: { showErrorBox: (...args) => errors.push(args) }, crashReporter: { start() { uploads++ } } }
  const local = createRequire(path.resolve('app/main.js'))
  const fakeRequire = name => name === 'electron' ? electron : name === 'drivelist' ? { list() { throw Error('No enumeration authorized') } } : local(name)
  vm.runInNewContext(fs.readFileSync('app/main.js', 'utf8'), { require: fakeRequire, __dirname: path.resolve('app'), console, process: { on() {}, env: {} }, setTimeout, clearTimeout })
  await ready()
  assert.deepEqual(errors, []); assert.equal(uploads, 0)
  assert.equal(windows.length, 1)
  const win = windows[0]
  // M2: native edit roles let the focused retained translator input receive
  // standard text shortcuts; no selection IPC callback may intercept them.
  const items = template.flatMap(menu => menu.submenu || [])
  for (const role of ['cut', 'copy', 'paste', 'selectAll', 'quit']) {
    const item = items.find(item => item.role === role)
    assert.ok(item, 'Missing native role ' + role); assert.equal(item.click, undefined)
  }
  for (const [label, accelerator, action] of [['Save selections', 'CmdOrCtrl+S', 'save-options'], ['Load selections', 'CmdOrCtrl+L', 'load-options'], ['Load Last Compile', 'CmdOrCtrl+Shift+L', 'load-last']]) {
    const item = items.find(item => item.label === label); assert.ok(item, label)
    assert.equal(item.accelerator, accelerator); item.click()
    assert.deepEqual(sent.pop(), ['aio:menu-action', action])
  }
  assert.equal(win.options.show, false); assert.equal(win.options.webPreferences.sandbox, true); assert.equal(win.options.webPreferences.nodeIntegration, false)
  for (const name of ['aio:bootstrap', 'aio:get-preferences', 'aio:set-preference']) assert.equal(typeof handlers.get(name), 'function')
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
  const data = await handlers.get('aio:bootstrap')(event)
  assert.equal(data.language.name, 'french'); assert.equal(data.preferences['aio-persist'].untouched, 'keep')
  assert.equal(data.preferences['aio-persist']['AIO-Ver'], '2.8.6')
  await handlers.get('aio:set-preference')(event, 'aio-data', 'saved', true)
  let prevented = false
  const closed = new Promise(resolve => win.once('closed', resolve))
  win.emit('close', { preventDefault() { prevented = true } })
  assert.equal(prevented, true); assert.equal(quits, 0)
  await closed
  const saved = JSON.parse(await fsp.readFile(path.join(root, 'preferences/aio-persist.json'), 'utf8'))
  assert.equal(saved.visits, 4); assert.equal(saved.untouched, 'keep'); assert.equal(quits, 1)
  assert.equal(await fsp.readFile(path.join(root, 'aio-persist.json'), 'utf8'), original)
  assert.equal(JSON.parse(await fsp.readFile(path.join(root, 'preferences/aio-data.json'), 'utf8')).saved, true)
})
