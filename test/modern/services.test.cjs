'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createDesktopServices, registerServiceIpc, SERVICE_INTERFACE } = require('../../app/desktop/services')

function fixture (t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-services-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const name of ['home', 'images', 'output']) fs.mkdirSync(path.join(root, name))
  const calls = []
  const chosen = path.join(root, 'chosen.jpg')
  fs.writeFileSync(chosen, 'inert source fixture')
  const config = {
    policyOptions: { home: path.join(root, 'home') },
    imageParent: path.join(root, 'images'),
    dialogs: { chooseOutputDirectory: async () => path.join(root, 'output'), chooseImage: async () => chosen },
    images: { resizeToPng: async request => { calls.push(['resize', request]); return Buffer.from('inert PNG adapter fixture') } },
    files: { writePng: async request => {
      calls.push(['write', { directory: request.directory, filename: request.filename }])
      fs.mkdirSync(request.directory, { recursive: true })
      fs.writeFileSync(path.join(request.directory, request.filename), request.data)
    } },
    drives: { list: async () => [] },
    window: { setFullscreen: async enabled => { calls.push(['fullscreen', enabled]) }, print: async () => { calls.push(['print']) } },
    external: { open: async url => { calls.push(['external', url]) } },
    ...overrides
  }
  return { root, chosen, calls, config, service: createDesktopServices(config) }
}

test('cancelled choosers return null without creating output or changing existing authorization', async t => {
  const f = fixture(t, { dialogs: { chooseOutputDirectory: async () => null, chooseImage: async () => null } })
  assert.equal(await f.service.chooseOutputDirectory(), null)
  assert.equal(await f.service.chooseImage('background'), null)
  assert.deepEqual(f.calls, [])
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'images')), [])
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'output')), [])
})

test('output chooser uses canonical policy and rejects protected parents without writes', async t => {
  const f = fixture(t)
  assert.equal(await f.service.chooseOutputDirectory(), path.join(f.root, 'output/_copy_to_usb'))
  f.config.dialogs.chooseOutputDirectory = async () => path.join(f.root, 'home')
  await assert.rejects(f.service.chooseOutputDirectory(), /Output directory is not allowed/)
  f.config.dialogs.chooseOutputDirectory = async () => undefined
  await assert.rejects(f.service.chooseOutputDirectory(), /dialog result/i)
  assert.deepEqual(f.calls, [])
})

test('unknown kinds and malformed resize payloads reject before any native operation', async t => {
  const f = fixture(t)
  for (const kind of ['other', '__proto__', null, {}, 'BACKGROUND']) await assert.rejects(f.service.chooseImage(kind), /image kind/i)
  for (const payload of [null, [], {}, { kind: 'background' }, { kind: 'album', source: 1 }, { kind: 'album', source: 'x', destination: '/elsewhere' }]) {
    await assert.rejects(f.service.resizeImage(payload), /image|payload|source/i)
  }
  assert.deepEqual(f.calls, [])
})

test('unchosen path and token from another service cannot authorize reads', async t => {
  const f = fixture(t)
  const other = fixture(t)
  const token = await other.service.chooseImage('background')
  for (const source of [f.chosen, '/etc/passwd', token]) await assert.rejects(f.service.resizeImage({ kind: 'background', source }), /authorized/i)
  assert.deepEqual(f.calls, [])
})

for (const [kind, filename, width, height] of [
  ['background', 'background.png', 800, 480], ['offscreen', 'OffScreenBackground.png', 800, 480], ['album', 'no_artwork_icon.png', 146, 146]
]) {
  test(`${kind} chooser grants one-use kind-bound token and writes fixed PNG dimensions/destination`, async t => {
    const f = fixture(t)
    const source = await f.service.chooseImage(kind)
    assert.equal(typeof source, 'string')
    assert.notEqual(source, f.chosen)
    await assert.rejects(f.service.resizeImage({ kind: kind === 'album' ? 'background' : 'album', source }), /authorized/i)
    const result = await f.service.resizeImage({ kind, source })
    const destination = path.join(f.root, 'images/_copy_to_usb', filename)
    assert.deepEqual(result, { kind, destination, width, height })
    assert.deepEqual(f.calls, [
      ['resize', { source: f.chosen, width, height }],
      ['write', { directory: path.dirname(destination), filename }]
    ])
    assert.equal(fs.readFileSync(destination, 'utf8'), 'inert PNG adapter fixture')
    await assert.rejects(f.service.resizeImage({ kind, source }), /authorized/i)
    assert.equal(f.calls.length, 2)
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  })
}

test('new choice revokes old kind grant; cancel preserves latest grant', async t => {
  const f = fixture(t)
  const old = await f.service.chooseImage('album')
  const current = await f.service.chooseImage('album')
  f.config.dialogs.chooseImage = async () => null
  assert.equal(await f.service.chooseImage('album'), null)
  await assert.rejects(f.service.resizeImage({ kind: 'album', source: old }), /authorized/i)
  await f.service.resizeImage({ kind: 'album', source: current })
})

test('invalid chooser paths and unsafe image output reject before image adapters', async t => {
  const f = fixture(t)
  for (const value of [[], '', 'relative.jpg', '/tmp/../etc/passwd', '/tmp/null\0.jpg']) {
    f.config.dialogs.chooseImage = async () => value
    await assert.rejects(f.service.chooseImage('album'), /dialog result/i)
  }
  f.config.dialogs.chooseImage = async () => f.chosen
  const source = await f.service.chooseImage('album')
  fs.symlinkSync(path.join(f.root, 'output'), path.join(f.root, 'images/_copy_to_usb'))
  await assert.rejects(f.service.resizeImage({ kind: 'album', source }), /Output directory is not allowed/)
  assert.deepEqual(f.calls, [])
})

test('existing symlink image destination rejects before read or write', async t => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.root, 'images/_copy_to_usb'))
  fs.symlinkSync(f.chosen, path.join(f.root, 'images/_copy_to_usb/background.png'))
  const source = await f.service.chooseImage('background')
  await assert.rejects(f.service.resizeImage({ kind: 'background', source }), /destination/i)
  assert.deepEqual(f.calls, [])
})

test('native image failure or invalid PNG output never calls writer and consumes grant', async t => {
  for (const resizeToPng of [async () => { throw new Error('decode failed') }, async () => null, async () => Buffer.alloc(0)]) {
    const writes = []
    const f = fixture(t, { images: { resizeToPng }, files: { writePng: async request => writes.push(request) } })
    const source = await f.service.chooseImage('album')
    await assert.rejects(f.service.resizeImage({ kind: 'album', source }), /decode failed|image output/i)
    await assert.rejects(f.service.resizeImage({ kind: 'album', source }), /authorized/i)
    assert.deepEqual(writes, [])
  }
})

test('writer, dialog and drive failures propagate rather than reporting success', async t => {
  const fail = async () => { throw new Error('native failed') }
  const f = fixture(t, { files: { writePng: fail }, drives: { list: fail } })
  const source = await f.service.chooseImage('album')
  await assert.rejects(f.service.resizeImage({ kind: 'album', source }), /native failed/)
  f.config.dialogs.chooseImage = fail
  await assert.rejects(f.service.chooseImage('album'), /native failed/)
  await assert.rejects(f.service.listDrives(), /native failed/)
})

test('drive list strips native data and filters system, fixed and malformed records', async t => {
  const good = { device: '/dev/fixture', description: 'Fixture', isSystem: false, isRemovable: true, mountpoints: [{ path: '/fixture/usb', label: 'USB', extra: () => {} }], native: () => {} }
  const f = fixture(t, { drives: { list: async () => [good, { ...good, isSystem: true }, { ...good, isRemovable: false }, { ...good, isSystem: undefined }, { ...good, mountpoints: [{ path: '/' }] }, null] } })
  const result = await f.service.listDrives()
  assert.deepEqual(result, [{ device: '/dev/fixture', description: 'Fixture', isSystem: false, isRemovable: true, mountpoints: [{ path: '/fixture/usb' }] }])
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  f.config.drives.list = async () => ({})
  await assert.rejects(f.service.listDrives(), /drive list/i)
})

test('fullscreen, printing and external URL operations validate before native effects', async t => {
  const f = fixture(t)
  for (const enabled of [1, 'true', null, {}]) await assert.rejects(f.service.setFullscreen(enabled), /boolean/i)
  for (const url of ['http://github.com/a', 'https://example.com', 'https://github.com@evil.test', 'file:///tmp/a', null]) await assert.rejects(f.service.openExternal(url), /External URL is not allowed/)
  assert.deepEqual(f.calls, [])
  assert.equal(await f.service.setFullscreen(true), undefined)
  assert.equal(await f.service.print(), undefined)
  assert.equal(await f.service.openExternal('https://github.com/Trevelopment/MZD-AIO'), undefined)
  assert.deepEqual(f.calls, [['fullscreen', true], ['print'], ['external', 'https://github.com/Trevelopment/MZD-AIO']])
})

test('window and external failures propagate; legacy features explicitly disabled', async t => {
  const fail = async () => { throw new Error('native failed') }
  const f = fixture(t, { window: { setFullscreen: fail, print: fail }, external: { open: fail } })
  await assert.rejects(f.service.setFullscreen(false), /native failed/)
  await assert.rejects(f.service.print(), /native failed/)
  await assert.rejects(f.service.openExternal('https://github.com'), /native failed/)
  await assert.rejects(f.service.downloadLegacy(), /disabled/i)
  await assert.rejects(f.service.updateLegacy(), /disabled/i)
})

const contract = {
  chooseOutputDirectory: { channel: 'aio:choose-output-directory', args: [] },
  chooseImage: { channel: 'aio:choose-image', args: ['kind'] },
  resizeImage: { channel: 'aio:resize-image', args: ['request'] },
  listDrives: { channel: 'aio:list-drives', args: [] },
  setFullscreen: { channel: 'aio:set-fullscreen', args: ['enabled'] },
  print: { channel: 'aio:print', args: [] },
  openExternal: { channel: 'aio:open-external', args: ['url'] },
  downloadLegacy: { channel: 'aio:download-legacy', args: [] },
  updateLegacy: { channel: 'aio:update-legacy', args: [] }
}
function transport (service, capabilities = Object.keys(contract)) {
  const handlers = new Map()
  const frame = { url: pathToFileURL('/fixture/app/index.html').href + '?lang=french' }
  const contents = { mainFrame: frame }
  registerServiceIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, service, getWebContents: () => contents, indexPath: '/fixture/app/index.html', capabilities })
  return { handlers, event: { sender: contents, senderFrame: frame }, contents }
}

test('exported protocol matches actual registration; every endpoint rejects foreign frames and exact-arity violations', async t => {
  const f = fixture(t)
  const { handlers, event, contents } = transport(f.service)
  assert.deepEqual(SERVICE_INTERFACE, contract)
  assert.deepEqual([...handlers.keys()].sort(), Object.values(contract).map(x => x.channel).sort())
  for (const { channel, args } of Object.values(contract)) {
    const handler = handlers.get(channel)
    const payload = args.map(() => null)
    for (const invalid of [
      { sender: {}, senderFrame: contents.mainFrame },
      { sender: contents, senderFrame: { url: contents.mainFrame.url } },
      { sender: contents }, null
    ]) await assert.rejects(handler(invalid, ...payload), /sender\/frame/i)
    await assert.rejects(handler(event, ...Array(args.length + 1).fill(null)), /arguments/i)
    if (args.length) await assert.rejects(handler(event), /arguments/i)
    for (const url of ['https://github.com', 'file://evil/fixture/app/index.html', 'file:///fixture/app/other.html', 'not a url']) {
      contents.mainFrame.url = url
      await assert.rejects(handler(event, ...payload), /sender\/frame/i)
    }
    contents.mainFrame.url = 'file:///fixture/app/index.html'
  }
  assert.deepEqual(f.calls, [])
})

test('valid local IPC delegates to validated services; malformed payload never reaches adapters', async t => {
  const f = fixture(t)
  const { handlers, event } = transport(f.service)
  const invoke = (method, ...args) => handlers.get(contract[method].channel)(event, ...args)
  assert.equal(await invoke('chooseOutputDirectory'), path.join(f.root, 'output/_copy_to_usb'))
  const source = await invoke('chooseImage', 'album')
  assert.equal((await invoke('resizeImage', { kind: 'album', source })).width, 146)
  assert.deepEqual(await invoke('listDrives'), [])
  await invoke('setFullscreen', false)
  await invoke('print')
  await invoke('openExternal', 'https://github.com')
  const count = f.calls.length
  for (const [method, value] of [['chooseImage', 'bad'], ['resizeImage', { kind: 'album', source: '/etc/passwd' }], ['setFullscreen', 'yes'], ['openExternal', 'http://github.com']]) await assert.rejects(invoke(method, value))
  await assert.rejects(invoke('downloadLegacy'), /disabled/i)
  await assert.rejects(invoke('updateLegacy'), /disabled/i)
  assert.equal(f.calls.length, count)
})

test('secondary scope registers only explicitly granted capabilities and fails closed on bad scope', async t => {
  const f = fixture(t)
  const { handlers, event } = transport(f.service, ['print'])
  assert.deepEqual([...handlers.keys()], ['aio:print'])
  await handlers.get('aio:print')(event)
  assert.deepEqual(f.calls, [['print']])
  for (const capabilities of [undefined, ['require'], ['print', 'print'], 'print']) {
    assert.throws(() => registerServiceIpc({ ipcMain: { handle () {} }, service: f.service, getWebContents: () => ({}), indexPath: '/fixture/app/index.html', capabilities }), /capabilities/i)
  }
})

// Catches a global-channel implementation that cannot route separately owned windows.
test('one registration routes multiple owned windows with per-window service and capability scope', async t => {
  const primary = fixture(t)
  const secondary = fixture(t)
  const primaryFrame = { url: 'file:///fixture/app/index.html' }
  const secondaryFrame = { url: 'file:///fixture/app/translator.html' }
  const primaryContents = { mainFrame: primaryFrame }
  const secondaryContents = { mainFrame: secondaryFrame }
  const handlers = new Map()
  registerServiceIpc({
    ipcMain: { handle: (name, action) => { assert.equal(handlers.has(name), false); handlers.set(name, action) } },
    service: primary.service, getWebContents: () => primaryContents, indexPath: '/fixture/app/index.html', capabilities: Object.keys(contract),
    additionalScopes: [{ service: secondary.service, getWebContents: () => secondaryContents, indexPath: '/fixture/app/translator.html', capabilities: ['print'] }]
  })
  const secondaryEvent = { sender: secondaryContents, senderFrame: secondaryFrame }
  await handlers.get('aio:print')(secondaryEvent)
  assert.deepEqual(primary.calls, [])
  assert.deepEqual(secondary.calls, [['print']])
  await assert.rejects(handlers.get('aio:choose-image')(secondaryEvent, 'album'), /capability/i)
  secondaryFrame.url = primaryFrame.url
  await assert.rejects(handlers.get('aio:print')(secondaryEvent), /sender\/frame/i)
})

// Catches weakening the chooser grant after a pathname is replaced or decoding yields.
test('changed chosen source and destination substitution during decode fail closed', async t => {
  const f = fixture(t)
  const source = await f.service.chooseImage('album')
  fs.writeFileSync(f.chosen, 'replacement is not the chosen file content')
  await assert.rejects(f.service.resizeImage({ kind: 'album', source }), /source changed/i)
  assert.deepEqual(f.calls, [])
  const next = await f.service.chooseImage('album')
  f.config.images.resizeToPng = async () => {
    fs.symlinkSync(path.join(f.root, 'output'), path.join(f.root, 'images/_copy_to_usb'))
    return Buffer.from('inert PNG')
  }
  await assert.rejects(f.service.resizeImage({ kind: 'album', source: next }), /Output directory is not allowed/)
  assert.deepEqual(f.calls, [])
})
