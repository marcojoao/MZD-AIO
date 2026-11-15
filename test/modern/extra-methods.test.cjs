'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { createExtraMethods } = require('../../app/desktop/extra-methods')
const { registerScopedIpc } = require('../../app/desktop/scoped-ipc')
const { createPreferenceService } = require('../../app/desktop/preferences')
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'extras-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const preferences = createPreferenceService({ directory: path.join(root, 'preferences'), resourceDirectory: path.resolve('app'), app: { name: 'MZD', version: '2.8.6' }, paths: {} })
  const effects = []
  const electron = { dialog: { async showOpenDialog() { effects.push('open'); return { canceled: true, filePaths: [] } }, async showSaveDialog() { effects.push('save'); return { canceled: true } } }, clipboard: { readText() { effects.push('clipboard'); return 'fixture' }, writeText() { effects.push('clipboard') } } }
  const methods = createExtraMethods({ electron, preferences, userData: root, imageParent: root, resources: path.resolve('app'), openScreen: name => effects.push(name), requestFlushAck: () => effects.push('ack') })
  return { root, methods, effects, preferences }
}
test('every extra endpoint rejects foreign frames, absent capability and wrong arity before native effects', async t => {
  const { methods, effects } = await fixture(t)
  const primary = { mainFrame: { url: 'file:///fixture/index.html' } }
  const secondary = { mainFrame: { url: 'file:///fixture/info.html' } }
  const handlers = new Map()
  registerScopedIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, methods, scopes: [
    { screen: 'primary', getWebContents: () => primary, indexPath: '/fixture/index.html', capabilities: Object.keys(methods) },
    { screen: 'info', getWebContents: () => secondary, indexPath: '/fixture/info.html', capabilities: [] }
  ] })
  for (const [name, method] of Object.entries(methods)) {
    const handler = handlers.get('aio:' + name)
    const args = Array(method.count).fill(null)
    await assert.rejects(handler({ sender: {}, senderFrame: primary.mainFrame }, ...args), /sender/)
    await assert.rejects(handler({ sender: primary, senderFrame: { url: primary.mainFrame.url } }, ...args), /frame/)
    await assert.rejects(handler({ sender: secondary, senderFrame: secondary.mainFrame }, ...args), /capability/)
    await assert.rejects(handler({ sender: primary, senderFrame: primary.mainFrame }, ...args, null), /arguments/)
  }
  assert.deepEqual(effects, [])
})
test('editor persistence roundtrips separately named stores; cancellation does not mutate saved state', async t => {
  const f = await fixture(t), run = (name, ...args) => f.methods[name].run({ win: () => ({}) }, ...args)
  assert.equal(await run('editor-load', 'translator'), null)
  await run('editor-save', 'translator', { label: 'saved' })
  await run('editor-save', 'speedo', { classic: { up: 1 } })
  assert.deepEqual(await run('editor-load', 'translator'), { label: 'saved' })
  assert.deepEqual(await run('editor-load', 'speedo'), { classic: { up: 1 } })
  assert.equal(await run('editor-import', 'translator'), null)
  assert.equal(await run('editor-export', 'speedo', { x: true }), null)
  assert.deepEqual(f.effects, ['open', 'save'])
  assert.deepEqual(await run('editor-load', 'translator'), { label: 'saved' })
  for (const name of ['editor-load', 'editor-import', 'editor-save', 'editor-export']) await assert.rejects(Promise.resolve().then(() => run(name, '../outside', {})), /editor/)
  assert.deepEqual(f.effects, ['open', 'save'])
})
test('messages XML edits persist in user data without changing bundled bytes and reset restores defaults', async t => {
  const f = await fixture(t), run = (name, ...args) => f.methods[name].run({}, ...args)
  const file = 'app/files/tweaks/config/message_replies/jci/settings/configurations/blm_msg-system.xml'
  const original = await fs.readFile(file)
  const data = await run('messages-load'), node = data.Node.Node[0].Node[0]
  const messages = node.Node.map(x => x.$.value); messages[0] = '<fixture & escaped>'
  await run('messages-save', node.$.key, messages)
  assert.equal((await run('messages-load')).Node.Node[0].Node[0].Node[0].$.value, messages[0])
  assert.deepEqual(await fs.readFile(file), original)
  assert.deepEqual(await run('messages-reset'), data)
  await assert.rejects(run('messages-save', 'unknown', []), /language/)
})
test('joined rotator settings validate exact ranges and persist via named endpoint', async t => {
  const f = await fixture(t)
  assert.ok(f.methods['background-rotator'], 'named rotator persistence endpoint missing')
  const run = (...args) => f.methods['background-rotator'].run({}, ...args)
  for (const args of [[0,60],[2,9],[2,301],[2.5,60],[2,'60']]) await assert.rejects(Promise.resolve().then(() => run(...args)), /rotator/)
  await run(2, 60)
  assert.deepEqual((await f.preferences.getPreferences('aio-data')).backgroundRotator, { images: 2, seconds: 60 })
})
test('preload subscriptions strip Electron events and unsubscribe the exact listener', () => {
  let bridge; const listeners = new Map(), removed = []
  vm.runInNewContext(require('node:fs').readFileSync('app/preload.js', 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_, value) => { bridge = value } }, ipcRenderer: { on: (channel, fn) => listeners.set(channel, fn), removeListener: (channel, fn) => removed.push([channel, fn]) } }) })
  for (const [method, channel] of [['onFlushRequest','aio:flush-request'], ['onPreferencesChanged','aio:preferences-changed'], ['onMenuAction','aio:menu-action'], ['onProgress','aio:progress']]) {
    let args; const unsubscribe = bridge[method]((...values) => { args = values })
    const listener = listeners.get(channel); listener({ sender: 'private' }, 'value')
    assert.deepEqual(args, ['value']); unsubscribe(); assert.deepEqual(removed.pop(), [channel, listener])
  }
})

test('extra preload methods match the actual registered channel table and exact arity', async t => {
  const { methods } = await fixture(t)
  const mapping = { getImageState:'image-state', resetWindow:'reset-window', openScreen:'open-screen', secondaryBootstrap:'secondary-bootstrap', selectBuiltinImage:'builtin-image', chooseJoinedImage:'joined-image', saveJoinedImage:'save-joined-image', setBackgroundRotator:'background-rotator', chooseTheme:'choose-theme', revealFolder:'reveal-folder', readClipboardText:'clipboard-read', writeClipboardText:'clipboard-write', loadEditor:'editor-load', saveEditor:'editor-save', importEditor:'editor-import', exportEditor:'editor-export', loadMessages:'messages-load', saveMessages:'messages-save', resetMessages:'messages-reset', compile:'compile', acknowledgeFlush:'flush-ack' }
  assert.deepEqual(Object.values(mapping).sort(), Object.keys(methods).sort())
  let bridge; const calls = []
  vm.runInNewContext(require('node:fs').readFileSync('app/preload.js','utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_, value) => { bridge = value } }, ipcRenderer: { invoke: (...args) => calls.push(args) } }) })
  for (const [api, name] of Object.entries(mapping)) {
    const args = Array.from({ length: methods[name].count }, (_, i) => 'value' + i)
    bridge[api](...args)
    assert.deepEqual(calls.pop(), ['aio:' + name, ...args])
  }
  const expected = [...Object.keys(mapping), ...Object.keys(require('../../app/desktop/services').SERVICE_INTERFACE), 'bootstrap','getPreferences','setPreference','onImageStaged','onProgress','onMenuAction','onPreferencesChanged','onFlushRequest']
  assert.deepEqual(Object.keys(bridge).sort(), expected.sort())
})

test('scoped persistence drain waits active operation acknowledgement and propagates failure', async () => {
  const wc = { mainFrame: { url: 'file:///fixture/index.html' } }, handlers = new Map()
  let release
  const held = new Promise(yes => { release = yes })
  let next = held
  const drain = registerScopedIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, methods: { save: { count: 0, run: () => next } }, scopes: [{ getWebContents: () => wc, indexPath: '/fixture/index.html', capabilities: ['save'] }] })
  assert.equal(typeof drain, 'function', 'main needs a close drain for submitted auxiliary writes')
  const operation = handlers.get('aio:save')({ sender: wc, senderFrame: wc.mainFrame })
  await Promise.resolve()
  let finished = false; const waiting = drain().then(() => { finished = true })
  await Promise.resolve(); assert.equal(finished, false)
  release(); await operation; await waiting; assert.equal(finished, true)
  let fail
  next = new Promise((yes, no) => { fail = no })
  const failedOperation = handlers.get('aio:save')({ sender: wc, senderFrame: wc.mainFrame })
  const operationRejected = assert.rejects(failedOperation, /disk full/)
  const drainRejected = assert.rejects(drain(), /disk full/)
  fail(Error('disk full')); await operationRejected; await drainRejected
})
