'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const fixture = require('../fixtures/compile-options.json')
const { createCompiler } = require('../../app/desktop/compiler')
const resources = path.resolve(__dirname, '../../app')
const sync = require('node:fs')
async function bytes(directory) {
  const out = {}
  async function walk(dir, prefix = '') { for (const item of await fs.readdir(dir, { withFileTypes: true })) { const rel = prefix + item.name; if (item.isDirectory()) await walk(path.join(dir, item.name), rel + '/'); else out[rel] = (await fs.readFile(path.join(dir, item.name))).toString('base64') } }
  await walk(directory); return out
}
const fresh = () => structuredClone(fixture)
async function setup(t, config = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compiler-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const dir of ['home', 'output', 'data', 'images']) await fs.mkdir(path.join(root, dir))
  const compiler = createCompiler({ resources, userData: path.join(root, 'data'), imageParent: path.join(root, 'images'), policyOptions: { home: path.join(root, 'home') }, ...config })
  return { root, compiler, outputParent: path.join(root, 'output') }
}
test('real main-menu-loop package contains templates in order and awaited configuration copies', async t => {
  const { compiler, outputParent } = await setup(t)
  const events = []
  const result = await compiler.compile({ options: fresh(), outputParent }, e => events.push(e))
  assert.equal(result.outputDirectory, path.join(outputParent, '_copy_to_usb'))
  assert.ok(result.files.includes('tweaks.sh'))
  const script = await fs.readFile(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8')
  assert.match(script, /MZD-AIO/)
  assert.match(script, /KEEPBKUPS=1\nTESTBKUPS=1/)
  assert.match(script, /INSTALL MAIN_MENU_LOOP/)
  assert.doesNotMatch(script, /INSTALL LIST_LOOP/)
  assert.equal(script.includes('\r'), false)
  const fragment = await fs.readFile(path.join(resources, 'files/tweaks/05_mainloop-i.txt'), 'utf8')
  assert.ok(script.includes(fragment))
  assert.ok(script.indexOf('KEEPBKUPS=') < script.indexOf(fragment))
  // Legacy appender adds one LF after EVERY source, even a source ending in LF.
  const sourceText = name => sync.readFileSync(path.join(resources, 'files/tweaks', name), 'utf8')
  const expected = [sourceText('00_intro.txt'), 'KEEPBKUPS=1\nTESTBKUPS=1\nSKIPCONFIRM=0\nAPPS2RESOURCES=0\nFORCESSH=0\n', sourceText('00_start.txt'), sourceText('00_wifi.txt'), sourceText('00_sshbringback.txt'), fragment, sourceText('00_end.txt')].map(x => x + '\n').join('').replace(/\r\n?/g, '\n')
  assert.equal(script, expected)
  const config = 'config/main-menu-loop/jci/gui/apps/system/controls/MainMenu/js/MainMenuCtrl.js'
  assert.deepEqual(await fs.readFile(path.join(result.outputDirectory, config)), await fs.readFile(path.join(resources, 'files/tweaks', config)))
  assert.ok(events.length > 1)
  assert.match(await fs.readFile(path.join(result.outputDirectory, 'AIO_LOG.md'), 'utf8'), /Copying config\/main-menu-loop/)
  assert.ok(events.some(e => /05_mainloop-i.txt/.test(e.message)))
  assert.ok(events.every(e => Object.keys(e).sort().join(',') === 'message,stage' && typeof e.message === 'string'))
})

test('repeat publication is deterministic and different selections leave no stale files', async t => {
  const { compiler, outputParent } = await setup(t)
  const request = { options: fresh(), outputParent }
  const first = await compiler.compile(request)
  const original = await bytes(first.outputDirectory)
  const second = await compiler.compile(request)
  assert.deepEqual(await bytes(second.outputDirectory), original)
  request.options.options = [6, 105]
  const third = await compiler.compile(request)
  assert.equal(third.files.some(x => x.includes('main-menu-loop')), false)
  const script = await fs.readFile(path.join(third.outputDirectory, 'tweaks.sh'), 'utf8')
  assert.ok(script.indexOf('UNINSTALL MAIN_MENU_LOOP') < script.indexOf('INSTALL LIST_LOOP'))
})
test('unowned or modified existing output is refused without deleting unrelated content', async t => {
  const { compiler, outputParent } = await setup(t)
  const out = path.join(outputParent, '_copy_to_usb')
  await fs.mkdir(out); await fs.writeFile(path.join(out, 'unrelated.txt'), 'keep')
  await assert.rejects(compiler.compile({ options: fresh(), outputParent }), /unowned/i)
  assert.equal(await fs.readFile(path.join(out, 'unrelated.txt'), 'utf8'), 'keep')
  assert.deepEqual(await fs.readdir(outputParent), ['_copy_to_usb'])
})
test('copy failure preserves successful output, cleans stage, and permits later recovery', async t => {
  let fail = false
  const { compiler, outputParent } = await setup(t, { beforeCopy: () => { if (fail) throw Error('injected copy failure') } })
  const request = { options: fresh(), outputParent }
  const original = await compiler.compile(request), snapshot = await bytes(original.outputDirectory)
  fail = true
  await assert.rejects(compiler.compile(request), /injected copy failure/)
  assert.deepEqual(await bytes(original.outputDirectory), snapshot)
  assert.deepEqual(await fs.readdir(outputParent), ['_copy_to_usb'])
  fail = false; await compiler.compile(request)
})
test('invalid options fail before filesystem effects and concurrency is rejected', async t => {
  const { compiler, outputParent } = await setup(t)
  for (const change of [{ options: [23] }, { options: [28] }, { options: [123] }, { options: [999] }, { options: ['5'] }, { mainOps: [900] }, { options: [13], boot: { logo1: '$(touch nope)', logo2: 0, logo3: 0 } }, { backups: { org: 'yes' } }, { options: [19], speedoOps: null }]) {
    await assert.rejects(compiler.compile({ options: { ...fresh(), ...change }, outputParent }), /Invalid compilation/)
    assert.deepEqual(await fs.readdir(outputParent), [])
  }
  const request = { options: fresh(), outputParent }
  const running = compiler.compile(request)
  await assert.rejects(compiler.compile(request), /already in progress/)
  await running
})
test('missing mandatory resources produce actionable failure, no success event or package', async t => {
  const { compiler, outputParent } = await setup(t, { resources: path.join(resources, 'absent') })
  const events = []
  await assert.rejects(compiler.compile({ options: fresh(), outputParent }, e => events.push(e)), /Missing|required|ENOENT/)
  assert.equal(events.some(e => e.stage === 'complete'), false)
  assert.deepEqual(await fs.readdir(outputParent), [])
})
test('output target and substituted stage descendants cannot follow symlinks', async t => {
  let substitute = false, escaped
  const { compiler, root, outputParent } = await setup(t, { beforeCopy: (_, dest) => {
    if (substitute && dest.endsWith('/config/main-menu-loop')) {
      sync.mkdirSync(path.dirname(dest), { recursive: true })
      sync.symlinkSync(escaped, dest); substitute = false
    }
  } })
  escaped = path.join(root, 'data')
  const out = path.join(outputParent, '_copy_to_usb')
  await fs.symlink(escaped, out)
  await assert.rejects(compiler.compile({ options: fresh(), outputParent }), /not allowed/)
  await fs.unlink(out)
  substitute = true
  await assert.rejects(compiler.compile({ options: fresh(), outputParent }), /Unsafe/)
  assert.deepEqual(await fs.readdir(escaped), [])
  assert.deepEqual(await fs.readdir(outputParent), [])
})

test('configured joined/builtin images, rotator, edited XML, audio and speedometer use actual data', async t => {
  const { compiler, root, outputParent } = await setup(t, { getState: async () => ({ backgroundRotator: { images: 2, seconds: 45 } }) })
  const imageDir = path.join(root, 'images/_copy_to_usb'); await fs.mkdir(imageDir)
  const image = await fs.readFile(path.join(resources, '../background-images/default/default.png'))
  for (const name of ['background.png', 'OffScreenBackground.png', 'no_artwork_icon.png']) await fs.writeFile(path.join(imageDir, name), image)
  const xmlDir = path.join(root, 'data/messages'); await fs.mkdir(xmlDir)
  const originalXml = await fs.readFile(path.join(resources, 'files/tweaks/config/message_replies/jci/settings/configurations/blm_msg-system.xml'), 'utf8')
  const editedXml = originalXml.replace('value="', 'value="Edited &amp; ')
  await fs.writeFile(path.join(xmlDir, 'blm_msg-system.xml'), editedXml)
  const user = fresh(); user.options = [2, 9, 11, 16, 19, 26]; user.mainOps = [2, 6, 10]
  user.gracenoteText = 'Custom "text" $safe'
  const result = await compiler.compile({ options: user, outputParent })
  const readOut = name => fs.readFile(path.join(result.outputDirectory, name))
  assert.deepEqual(await readOut('config/background.png'), image)
  assert.deepEqual(await readOut('config/OffScreenBackground.png'), image)
  assert.deepEqual(await readOut('config/blank-album-art-frame/jci/gui/common/images/no_artwork_icon.png'), image)
  assert.equal((await readOut('config/message_replies/jci/settings/configurations/blm_msg-system.xml')).toString(), editedXml)
  const script = (await readOut('tweaks.sh')).toString()
  assert.match(script, /BG_STEPS=2\nBG_SECONDS=90\nBG_SEC_EACH=45\nBG_WIDTH=1600/)
  assert.ok(script.includes('GRACENOTE="Custom \\"text\\" \\$safe"'))
  const audio = (await readOut('config/audio_order_AND_no_More_Disclaimer/systemApp.js.audio')).toString()
  assert.match(audio, /var UsbAudioAPos = 1;/)
  assert.equal(audio.match(/var UsbAudioAPos/g).length, 1)
  const speedo = (await readOut('config/speedometer/speedometer-config.js')).toString()
  assert.match(speedo, /var spdBottomRows = 4;/)
  assert.match(speedo, /vehSpeed: \[0,0,0\]/)
  assert.match((await readOut('config/speedometer/barThemes.css')).toString(), /theme1/)
})
test('restore, run.sh, autorun recovery, dryrun/ADB/WiFi and serial workflows generate preserved payloads', async t => {
  const { compiler, outputParent } = await setup(t)
  let user = fresh(); user.restore.full = true
  let result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.includes('config_org/v70/MainMenuCtrl.js.org'))
  let script = await fs.readFile(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8')
  assert.ok(script.includes((await fs.readFile(path.join(resources, 'files/tweaks/00___fullRestore.sh'), 'utf8')).replace(/\r\n?/g, '\n')))
  user = fresh(); user.runsh = true
  result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.includes('run.sh')); assert.equal(result.files.includes('jci-autoupdate'), false)
  user = fresh(); user.autorun = { installer: true, id7recovery: true, autoADB: true, autoWIFI: true, dryrun: true, serial: false }; user.wifi = { ssid: 'Scratch network', password: 'scratch-only-password' }
  result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.includes('02-start-adb/start-adb-ssh.autorun'))
  assert.ok(result.files.includes('02-start-wifiAP/wifiAP.config'))
  assert.equal((await fs.readFile(path.join(result.outputDirectory, 'run.sh'), 'utf8')), await fs.readFile(path.join(resources, 'files/tweaks/cmu-autorun/sdcard/dryrun/run.sh'), 'utf8'))
  user.autorun.serial = true
  result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.includes('XX/02-start-adb/start-adb-ssh.autorun'))
  assert.equal(result.files.includes('XX/tweaks.sh'), false)
  assert.equal(result.files.includes('XX/jci-autoupdate'), false)
  assert.equal(result.files.includes('AIO_LOG.md'), false)
})
test('CASDK workflows keep app selection and region data', async t => {
  const { compiler, outputParent } = await setup(t)
  const user = fresh(); user.casdk.inst = true; user.apps = { simpledashboard: true }; user.casdk.region = 'eu'
  const result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.some(x => x.startsWith('casdk/apps/app.simpledashboard/')))
  assert.equal(result.files.some(x => x.startsWith('casdk/apps/app.gpsspeed/')), false)
  assert.match(await fs.readFile(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8'), /APPSIMPLEDASHBOARD=1/)
})
test('bundled zipped theme and chooser-authorized custom PNG theme work; renderer paths cannot authorize imports', async t => {
  let theme
  const { compiler, root, outputParent } = await setup(t, { getState: async () => ({ theme }) })
  const user = fresh(); user.mainOps = [3]; user.colors = 8
  let result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.some(x => x.startsWith('config/color-schemes/theme/jci/')))
  assert.equal(result.files.includes('config/color-schemes/theme/jci/gui/common/images/background.png'), false)
  const custom = path.join(root, 'jci'); await fs.mkdir(custom)
  await fs.writeFile(path.join(custom, 'allowed.png'), 'chosen PNG'); await fs.writeFile(path.join(custom, 'not-code.js'), 'must not import')
  theme = { source: custom, token: 'opaque-main-grant' }
  user.colors = 17; user.customTheme = { token: theme.token, name: 'jci' }
  result = await compiler.compile({ options: user, outputParent })
  assert.ok(result.files.includes('config/color-schemes/theme/jci/allowed.png'))
  assert.equal(result.files.some(x => x.endsWith('not-code.js')), false)
  user.customTheme = { token: 'forged', name: custom }
  await assert.rejects(compiler.compile({ options: user, outputParent }), /authorized/)
})

test('all standard install/uninstall selections retain source fragment order and config trees', async t => {
  const { compiler, outputParent } = await setup(t)
  const user = fresh()
  user.options = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,19,20,21,22,24,25,26,27,
    101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,124,125,126,127]
  user.mainOps = [0,1,4,5,8,9,106,110]; user.aaHUD = true; user.aaWifi = true
  user.statusbar.d2sbinst = true; user.mzdmeter.inst = true
  const result = await compiler.compile({ options: user, outputParent })
  const script = await fs.readFile(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8')
  const uninstall = await fs.readFile(path.join(resources, 'files/tweaks/05_mainloop-u.txt'), 'utf8')
  const install = await fs.readFile(path.join(resources, 'files/tweaks/05_mainloop-i.txt'), 'utf8')
  assert.ok(script.indexOf(uninstall) > 0 && script.indexOf(uninstall) < script.indexOf(install))
  for (const dir of ['bootanimation','videoplayer','androidauto','androidautowifi','USBAudioMod','aio-app','mzdmeter','test_mode','FuelConsumptionTweak','speedometer']) assert.ok(result.files.some(x => x.startsWith('config/' + dir + '/')), dir)
  assert.match(await fs.readFile(path.join(result.outputDirectory, 'config/androidauto/data_persist/dev/bin/headunit-wrapper'), 'utf8'), /DEBUG=1/)
  assert.ok(result.files.includes('config_org/v70/MainMenuCtrl.js.org'))
})
test('modified owned output and payload source-root destinations fail safely', async t => {
  const { compiler, root, outputParent } = await setup(t)
  const first = await compiler.compile({ options: fresh(), outputParent })
  await fs.writeFile(path.join(first.outputDirectory, 'user-file'), 'unrelated')
  await assert.rejects(compiler.compile({ options: fresh(), outputParent }), /unowned|modified/i)
  assert.equal(await fs.readFile(path.join(first.outputDirectory, 'user-file'), 'utf8'), 'unrelated')
  const fake = path.join(root, 'fake'); await fs.mkdir(fake); await fs.mkdir(path.join(fake,'app')); await fs.mkdir(path.join(fake,'background'))
  const protectedCompiler = createCompiler({ resources: path.join(fake,'app'), policyOptions: { home: path.join(root,'home') } })
  await assert.rejects(protectedCompiler.compile({ options: fresh(), outputParent: path.join(fake,'background') }), /not allowed/)
  assert.deepEqual(await fs.readdir(path.join(fake,'background')), [])
})

// Lock-in coverage for retained branches, not claimed as new RED chronology.
test('unavailable selected color archive rejects and preserves the previous package', async t => {
  const { compiler, outputParent } = await setup(t)
  const first = await compiler.compile({ options: fresh(), outputParent }), snapshot = await bytes(first.outputDirectory)
  for (const change of [{ mainOps: [3], colors: 1 }]) {
    const events = []
    await assert.rejects(compiler.compile({ options: { ...fresh(), ...change }, outputParent }, e => events.push(e)), /Required asset unavailable.*Legacy downloads are disabled/)
    assert.deepEqual(await bytes(first.outputDirectory), snapshot)
    assert.equal(events.some(e => e.stage === 'complete'), false)
    assert.deepEqual(await fs.readdir(outputParent), ['_copy_to_usb'])
  }
})
test('backup and media-order prelude, alternate speedometer fragments and data retrieval keep ordering', async t => {
  const { compiler, outputParent } = await setup(t)
  const user = fresh(); user.options = [19,21]; user.mainOps = [1]; user.dataDump = true
  user.speedoOps.lang.id = 2; user.speedoOps.xph.id = 10; user.speedoOps.bg.id = 31
  const result = await compiler.compile({ options: user, outputParent })
  const script = await fs.readFile(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8')
  let previous = -1
  for (const name of ['00_backup.txt','00_wifi.txt','00_sshbringback.txt','19_speedo-i1.txt','19_speedo-spanish.txt','19_speedo-mph.txt','19_speedo-old_background.txt','19_speedo-i2.txt','08_orderflac-i.txt']) {
    const fragment = await fs.readFile(path.join(resources,'files/tweaks',name),'utf8')
    const index = script.indexOf(fragment); assert.ok(index > previous, name); previous = index
  }
  assert.match(script, /ZIPBACKUP=0/)
  assert.deepEqual(await fs.readFile(path.join(result.outputDirectory,'dataRetrieval_config.txt')), await fs.readFile(path.join(resources,'files/tweaks/root/data/dataRetrieval_config.txt')))
  assert.equal(result.files.some(name => name.startsWith('data/')), false)
})
test('ZIP write-time failure rejects promptly even with legacy yauzl destroy semantics', async t => {
  const { root } = await setup(t)
  const { unzip } = require('../../app/desktop/compiler-zip')
  const { stageWriter } = require('../../app/desktop/compiler-fs')
  const io = stageWriter(path.join(root, 'data'))
  io.check = () => { throw Error('injected ZIP write failure') }
  let timer
  try {
    await assert.rejects(Promise.race([
      unzip(path.join(resources,'files/tweaks/config/themes/SmoothRed.zip'), path.join(root,'data'), io),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('ZIP rejection timed out')), 1000) })
    ]), /injected ZIP write failure/)
  } finally { clearTimeout(timer) }
})
