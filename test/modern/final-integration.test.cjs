'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const { createCompiler } = require('../../app/desktop/compiler')
const read = file => fs.readFileSync(file, 'utf8')
const png = fs.readFileSync('background-images/default/default.png')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'final-integration-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const n of ['old', 'new', 'data', 'images', 'home']) fs.mkdirSync(path.join(root, n))
  return { root, compiler: createCompiler({ resources: path.resolve('app'), userData: path.join(root, 'data'), imageParent: path.join(root, 'images'), policyOptions: { home: path.join(root, 'home') } }) }
}
function controller(f, saved = {}, last = {}) {
  let init, confirmation, pending
  const alerts = [], events = new Map()
  const chain = { controller(n, fn) { if (n === 'MainCtrl') init = fn; return chain }, config() { return chain }, directive() { return chain }, filter() { return chain } }
  const jquery = () => new Proxy({}, { get: (_, k) => k === 'length' ? 0 : () => jquery() })
  const c = vm.createContext({ console, angular: { module: () => chain, toJson: JSON.stringify }, $: jquery, setTimeout() {}, introJs: () => ({ setOption() {}, addHints() {}, hideHints() {} }), uiEvents: { on: (n, fn) => events.set(n, fn) }, aio: { onProgress: () => () => {} }, document: { createElement: () => ({ textContent: '' }) }, bootbox: { hideAll() {}, alert: v => alerts.push(v), confirm: v => { confirmation = v; return { on() {} } } }, closeHelpDrop() {}, updateBgModal() {}, getParameterByName: () => '', snackbar() {}, msgLangs: [], messagesReady: Promise.resolve(), desktopData: { app: { name: 'MZD', version: '2.8.6' }, paths: { desktop: path.join(f.root, 'new') } }, hasColorFiles: false })
  for (const file of ['desktop-client.js', 'spdValues.js', 'audioSourceList.js']) vm.runInContext(read('app/assets/js/' + file), c)
  c.initial = JSON.stringify({ saved, last, destination: path.join(f.root, 'new') })
  vm.runInContext(`var initial=JSON.parse(this.initial), lang='english',langObj={};var settings={store:initial.saved,get:(k,f)=>f,set:async()=>{},flush:async()=>{}};var lastView={store:initial.last,size:1,set:async()=>{},flush:async()=>{}};var speedoSave={get:(k,f)=>f};var persistantData={get:(k,f)=>k==='copyFolderLocation'?initial.destination:f};`, c)
  c.locale = read('app/lang/english.aio.json')
  vm.runInContext('langObj=JSON.parse(locale)', c)
  vm.runInContext(read('app/controllers/home.js'), c)
  const scope = { $on() {}, $watch() {}, $apply() {}, $applyAsync() {}, $evalAsync() {} }
  init(scope, {}, {}, { path: () => '/' }, () => x => x)
  c.buildTweakFile = user => f.compiler.compile({ options: JSON.parse(JSON.stringify(user)), outputParent: user.copydir })
  const compile = scope.compileTweaks
  scope.compileTweaks = (...args) => { pending = compile(...args); return pending }
  return { scope, c, alerts, events, async start() { confirmation = null; scope.startCompile(); assert.ok(confirmation, 'ordinary startCompile must reach confirmation'); confirmation.callback(true); await pending; return scope.compileResult } }
}
for (const color of [8, 17, 0]) test('ordinary MainCtrl confirmation reaches real compiler for theme ' + color, async t => {
  const f = fixture(t), h = controller(f)
  h.scope.user.options = [5]; h.scope.user.mainOps = [0, 3, 4]; h.scope.user.colors = color
  if (color === 17) {
    const source = path.join(f.root, 'jci'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'custom.png'), png)
    f.compiler = createCompiler({ resources: path.resolve('app'), userData: path.join(f.root, 'data'), getState: async () => ({ theme: { source, token: 'chooser-grant' } }) })
    h.scope.user.customTheme = { token: 'chooser-grant', name: 'jci' }
  }
  const result = await h.start()
  if (color === 0) { assert.equal(result, null); assert.match(h.scope.compileError, /Required asset unavailable.*downloads are disabled/); return }
  assert.equal(h.scope.compileError, null); assert.ok(result.files.some(n => n.startsWith('config/color-schemes/theme/jci/')))
})
for (const route of ['restart', 'loadOps', 'loadLast']) test('authoritative destination survives ' + route + ' with actual directory bytes', async t => {
  const f = fixture(t), options = JSON.parse(read('test/fixtures/compile-options.json'))
  const prior = await f.compiler.compile({ options, outputParent: path.join(f.root, 'old') })
  const old = fs.readFileSync(path.join(prior.outputDirectory, 'tweaks.sh'))
  const snapshot = { ...options, options: [6], copydir: path.join(f.root, 'old') }
  const h = controller(f, snapshot, snapshot)
  if (route !== 'restart') h.scope[route]()
  const result = await h.start()
  assert.equal(result.outputDirectory, path.join(f.root, 'new/_copy_to_usb'))
  assert.deepEqual(fs.readFileSync(path.join(prior.outputDirectory, 'tweaks.sh')), old)
  assert.notDeepEqual(fs.readFileSync(path.join(result.outputDirectory, 'tweaks.sh')), old)
})
for (const [kind, filename, output, mainOps, options] of [
  ['background', 'background.png', 'config/background.png', [2], [5]],
  ['offscreen', 'OffScreenBackground.png', 'config/OffScreenBackground.png', [10], [5]],
  ['album', 'no_artwork_icon.png', 'config/blank-album-art-frame/jci/gui/common/images/no_artwork_icon.png', [0], [16]]
]) test('fixed ' + kind + ' image legacy/current/default/invalid resolution preserves originals', async t => {
  const f = fixture(t), legacy = path.join(f.root, 'data/background'), current = path.join(f.root, 'images/_copy_to_usb')
  fs.mkdirSync(legacy); fs.mkdirSync(current)
  const legacyBytes = Buffer.concat([png, Buffer.from('legacy')]), currentBytes = Buffer.concat([png, Buffer.from('current')])
  fs.writeFileSync(path.join(legacy, filename), legacyBytes)
  const user = { ...JSON.parse(read('test/fixtures/compile-options.json')), mainOps, options }
  async function compileBytes() { const result = await f.compiler.compile({ options: user, outputParent: path.join(f.root, 'new') }); return fs.readFileSync(path.join(result.outputDirectory, output)) }
  assert.ok((await compileBytes()).equals(legacyBytes), 'legacy-only image must not be silently replaced')
  fs.writeFileSync(path.join(current, filename), currentBytes)
  assert.deepEqual(await compileBytes(), currentBytes)
  fs.writeFileSync(path.join(current, filename), png.subarray(0, 33))
  await assert.rejects(compileBytes(), /image|PNG/i)
  fs.unlinkSync(path.join(current, filename)); fs.writeFileSync(path.join(legacy, filename), 'invalid')
  await assert.rejects(compileBytes(), /image|PNG/i)
  fs.writeFileSync(path.join(legacy, filename), legacyBytes)
  assert.deepEqual(fs.readFileSync(path.join(legacy, filename)), legacyBytes)
  fs.unlinkSync(path.join(legacy, filename)); assert.ok((await compileBytes()).length > 100)
})
test('actual notification consumer displays escaped structured cleanup recovery text', () => {
  let listener, notice
  const jq = () => ({})
  jq.gritter = { add: value => { notice = value } }
  const c = vm.createContext({ window: {}, desktopData: { images: {} }, $: jq, aio: { onMenuAction() {}, onProgress: fn => { listener = fn }, onImageStaged() {} }, MutationObserver: class { observe() {} }, document: { documentElement: {}, querySelector: () => null, querySelectorAll: () => [] } })
  vm.runInContext(read('app/assets/js/notifications.js'), c); vm.runInContext(read('app/assets/js/events.js'), c)
  listener({ stage: 'warning', code: 'BACKUP_CLEANUP_FAILED', message: 'Package generated <img src=x>', backupDirectory: '/scratch/backup<&>', diagnostic: '<script>failure</script>' })
  assert.match(notice.text, /Package generated/); assert.match(notice.text, /backup.*scratch/); assert.match(notice.text, /recover|cleanup/i)
  assert.doesNotMatch(notice.text, /<img|<script>|\[object Object\]/)
  assert.match(notice.text, /&lt;/); assert.equal(notice.sticky, true)
})
