'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { EventEmitter } = require('node:events')
const { secureWindow, windowOptions, attachCloseBarrier } = require('../../app/desktop/windows')
const vm = require('node:vm')
const { SERVICE_INTERFACE } = require('../../app/desktop/services')
test('preload named service methods match the reviewed channel and exact positional arity', async () => {
  let bridge; const calls = []
  vm.runInNewContext(require('node:fs').readFileSync(path.join(__dirname, '../../app/preload.js'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_, api) => { bridge = api } }, ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve() }, on () {}, removeListener () {} } })
  })
  for (const [name, spec] of Object.entries(SERVICE_INTERFACE)) {
    assert.equal(typeof bridge[name], 'function', name)
    const args = spec.args.map((_, i) => 'arg' + i)
    await bridge[name](...args)
    assert.deepEqual(calls.pop(), [spec.channel, ...args])
  }
  for (const forbidden of ['invoke', 'send', 'require', 'process', 'ipcRenderer', 'fs']) assert.equal(bridge[forbidden], undefined)
})
test('browser cache refresh waits queued writes and replaces native-changed store', async () => {
  const { createDesktopClient, stores } = require('../../app/assets/js/desktop-client')
  const preferences = Object.fromEntries(stores.map(name => [name, {}]))
  const calls = []
  const client = createDesktopClient({ preferences }, { async setPreference () { calls.push('write') }, async getPreferences () { calls.push('read'); return { copyFolderLocation: '/new' } } })
  client.stores['aio-persist'].set('old', true)
  assert.equal(typeof client.refresh, 'function')
  await client.refresh('aio-persist')
  assert.deepEqual(calls, ['write', 'read'])
  assert.equal(client.stores['aio-persist'].get('copyFolderLocation'), '/new')
  assert.equal(client.stores['aio-persist'].has('old'), false)
})
const { createNativeAdapters } = require('../../app/desktop/native-adapters')
test('windows deny foreign navigation and child windows but allow owned routes', () => {
  const page = path.resolve('app/index.html')
  const wc = new EventEmitter(); let handler
  wc.setWindowOpenHandler = fn => { handler = fn }
  secureWindow({ webContents: wc }, page)
  assert.deepEqual(handler({ url: 'https://example.com' }), { action: 'deny' })
  for (const [url, denied] of [[pathToFileURL(page) + '?lang=french#/home', false], ['file:///etc/passwd', true], ['https://example.com', true]]) {
    let prevented = false; wc.emit('will-navigate', { preventDefault () { prevented = true } }, url)
    assert.equal(prevented, denied)
  }
  assert.deepEqual(windowOptions('/trusted/preload.js').webPreferences, { preload: '/trusted/preload.js', nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false })
})
test('native dialogs normalize cancellation without side effects and decode rejects invalid images', async () => {
  let calls = 0
  const adapters = createNativeAdapters({ electron: { dialog: { async showOpenDialog () { calls++; return { canceled: true, filePaths: [] } } }, nativeImage: { createFromBuffer () { return { isEmpty: () => true } } } }, window: {}, imageParent: '/unused' })
  assert.equal(await adapters.dialogs.chooseImage('background'), null)
  assert.equal(await adapters.dialogs.chooseOutputDirectory(), null)
  assert.equal(calls, 2)
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-'))
  try {
    const source = path.join(dir, 'bad.png'); await fs.writeFile(source, 'invalid')
    await assert.rejects(adapters.images.resizeToPng({ source, width: 800, height: 480 }), /decode/i)
  } finally { await fs.rm(dir, { recursive: true }) }
})
test('native writer replaces fixed files atomically and refuses symlink directories and leaves', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'writer-'))
  const adapters = createNativeAdapters({ electron: {}, window: {}, imageParent: root })
  try {
    const directory = path.join(root, '_copy_to_usb')
    await adapters.files.writePng({ directory, filename: 'background.png', data: Buffer.from('png') })
    assert.equal(await fs.readFile(path.join(directory, 'background.png'), 'utf8'), 'png')
    await fs.unlink(path.join(directory, 'background.png')); await fs.symlink('/etc/passwd', path.join(directory, 'background.png'))
    await assert.rejects(adapters.files.writePng({ directory, filename: 'background.png', data: Buffer.from('x') }), /unsafe/i)
    await fs.rm(directory, { recursive: true }); await fs.symlink(root, directory)
    await assert.rejects(adapters.files.writePng({ directory, filename: 'background.png', data: Buffer.from('x') }), /unsafe/i)
  } finally { await fs.rm(root, { recursive: true }) }
})
test('close barrier awaits renderer acknowledgement and refuses false saved state', async () => {
  const win = new EventEmitter(); win.webContents = new EventEmitter()
  let destroyed = 0; let release; let error
  win.destroy = () => { destroyed++ }
  attachCloseBarrier(win, () => new Promise(resolve => { release = resolve }), e => { error = e })
  let prevented = false; win.emit('close', { preventDefault () { prevented = true } })
  assert.equal(prevented, true); assert.equal(destroyed, 0)
  await Promise.resolve(); release(); await new Promise(resolve => setImmediate(resolve)); assert.equal(destroyed, 1); assert.equal(error, undefined)
  const failed = new EventEmitter(); failed.destroy = () => { destroyed++ }
  attachCloseBarrier(failed, async () => { throw Error('not saved') }, e => { error = e })
  failed.emit('close', { preventDefault () {} }); await new Promise(resolve => setImmediate(resolve))
  assert.equal(destroyed, 1); assert.match(error.message, /not saved/)
})

 test('primary inline startup scripts parse without Node or legacy remote translation', () => {
  const html = require('node:fs').readFileSync('app/index.html', 'utf8')
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1])
  assert.doesNotMatch(html, /google\.translate|translate\.google/)
 })
 test('production never appends Chromium sandbox-disabling switches', () => {
  const main = require('node:fs').readFileSync('app/main.js', 'utf8')
  assert.doesNotMatch(main, /no-sandbox|disable-setuid-sandbox|appendSwitch/)
  assert.equal(windowOptions('/fixed/preload.js').webPreferences.sandbox, true)
 })

test('optional zoom and printer browser helpers use no Node or raw IPC', () => {
  for (const name of ['zoom.js', 'printers.js']) {
    const source = require('node:fs').readFileSync('app/assets/js/' + name, 'utf8')
    assert.doesNotMatch(source, /require\s*\(|ipc\.|remote\.|process\./)
  }
})
test('native writer failures preserve prior bytes, clean temporary leaves and permit later recovery', async () => {
  const { writeAtomic } = require('../../app/desktop/native-adapters')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-'))
  try {
    for (const operation of ['write', 'sync', 'rename']) {
      await writeAtomic(root, 'background.png', 'original')
      const originalOpen = fs.open, originalRename = fs.rename
      try {
        if (operation === 'rename') fs.rename = async () => { throw Error('injected rename') }
        else fs.open = async (...args) => {
          const handle = await originalOpen(...args)
          const name = operation === 'write' ? 'writeFile' : 'sync'
          handle[name] = async () => { throw Error('injected ' + operation) }
          return handle
        }
        await assert.rejects(writeAtomic(root, 'background.png', 'changed'), /injected/)
      } finally { fs.open = originalOpen; fs.rename = originalRename }
      assert.equal(await fs.readFile(path.join(root, 'background.png'), 'utf8'), 'original')
      assert.deepEqual(await fs.readdir(root), ['background.png'])
      await writeAtomic(root, 'background.png', 'recovered')
      assert.equal(await fs.readFile(path.join(root, 'background.png'), 'utf8'), 'recovered')
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('active home controller has no remote window or raw native escape hatch', () => {
  const source = require('node:fs').readFileSync('app/controllers/home.js', 'utf8')
  assert.doesNotMatch(source, /remote\.|ipc\.|fs\.|require\s*\(/)
})
