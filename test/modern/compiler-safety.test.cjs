'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createCompiler } = require('../../app/desktop/compiler')
const { validateOptions } = require('../../app/desktop/compiler-options')
const { verifyOwned } = require('../../app/desktop/compiler-manifest')
const fixture = require('../fixtures/compile-options.json')
const fresh = () => structuredClone(fixture)
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compiler-safety-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const name of ['home', 'output', 'data', 'images']) fs.mkdirSync(path.join(root, name))
  const outputParent = path.join(root, 'output')
  const compiler = createCompiler({ resources: path.resolve(__dirname, '../../app'), userData: path.join(root, 'data'), imageParent: path.join(root, 'images'), policyOptions: { home: path.join(root, 'home') } })
  return { compiler, outputParent }
}
const script = result => fs.readFileSync(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8')
const fragment = name => fs.readFileSync(path.resolve(__dirname, '../../app/files/tweaks', name), 'utf8').replace(/\r\n?/g, '\n')

test('bounded speedometer and statusbar matrix keeps exclusive fragments and semantic variables', async t => {
  const { compiler, outputParent } = await setup(t)
  const locale = require('../../app/lang/english.aio.json')
  const cases = [
    { sml: locale.speedoOps.sml.none.id, bg: locale.speedoOps.bg.ind.id, fuel: 'disable', color: null, suffix: '%', factor: 100, opacity: 0, rows: '4', theme: '0', main: false, date: 3, yes: ['19_speedo-small_speedo_off.txt','19_speedo-own_background.txt'], no: ['19_sbfuelbar.txt','19_speedo-old_background.txt'] },
    { sml: locale.speedoOps.sml.gps.id, bg: locale.speedoOps.bg.orig.id, fuel: 'topbar', color: 'Red', suffix: 'Gal', factor: 13.2, opacity: 0.5, rows: '1', theme: '5', main: true, date: 1, yes: ['19_speedo-i2.txt','19_sbfuelbar.txt','19_speedo-old_background.txt'], no: ['19_speedo-small_speedo_off.txt','19_speedo-own_background.txt'] },
    { sml: locale.speedoOps.sml.car.id, bg: locale.speedoOps.bg.ind.id, fuel: 'bottombar', color: 'Blue', suffix: 'L', factor: 62, opacity: 1, rows: '2', theme: '1', main: false, date: 2, yes: ['19_speedo-i2.txt','19_sbfuelbar.txt','19_speedo-slovak.txt'], no: ['19_speedo-small_speedo_off.txt'] }
  ]
  for (const row of cases) {
    const options = fresh(); options.options = [19, 20]; options.mainOps = []
    Object.assign(options.speedoOps, { sml: { id: row.sml }, bg: { id: row.bg }, color: row.color, opac: row.opacity, sbmain: 'hidden', sbval1: 'vehicleSpeed', sbval2: 'gpsHeading' })
    options.speedoOps.sbfuel = row.fuel
    if (row.sml === locale.speedoOps.sml.car.id) options.speedoOps.lang.id = locale.speedoOps.lang.sl.id
    Object.assign(options.spdExtra, { fuelGaugeValueSuffix: row.suffix, fuelGaugeFactor: row.factor, barSpeedoRows: row.rows, barThemeStart: row.theme })
    Object.assign(options.statusbar, { main: row.main, opacity: row.opacity }); options.d2sbOps = row.date
    const result = await compiler.compile({ options, outputParent }), text = script(result)
    for (const name of row.yes) assert.ok(text.includes(fragment(name)), name)
    for (const name of row.no) assert.ok(!text.includes(fragment(name)), name)
    for (const line of [`SPEEDCOLOR=${row.color || 0}`, `OPACITY=${row.bg === 30 ? row.opacity : 0}`, `SPD_XTRA_FUEL_SUFF=${row.suffix}`, `SPD_XTRA_FUEL_FACT=${row.factor}`, 'SBMAIN=hidden', 'SBVAL1=vehicleSpeed', `SBFBPOS=${row.fuel}`, `BTSTART=${row.theme}`, `STATUS_BAR_OPACITY=${row.opacity}`, `DATE_FORMAT=${row.date - 1}`]) assert.ok(text.split('\n').includes(line), line)
    assert.ok(text.includes(row.main ? 'STATUS_BAR_CTRL="background-image: none;"' : 'STATUS_BAR_CTRL="background-image: url(\'../images/StatusBarBg.png\');"'))
    assert.ok(fs.readFileSync(path.join(result.outputDirectory, 'config/speedometer/speedometer-config.js'), 'utf8').includes(`var spdBottomRows = ${row.rows};`))
  }
})

test('CASDK full/apps-only install/uninstall matrix does not mask exclusive fragments', async t => {
  const { compiler, outputParent } = await setup(t)
  for (const [install, appsOnly, want, absent] of [
    [true, false, ['00__casdk-i.txt','00__casdkapps-i.txt'], ['00__casdk-u.txt','00__casdkapps-u.txt']],
    [true, true, ['00__casdkapps-i.txt'], ['00__casdk-i.txt','00__casdk-u.txt','00__casdkapps-u.txt']],
    [false, false, ['00__casdk-u.txt'], ['00__casdk-i.txt','00__casdkapps-u.txt','00__casdkapps-i.txt']],
    [false, true, ['00__casdkapps-u.txt'], ['00__casdk-i.txt','00__casdk-u.txt','00__casdkapps-i.txt']]
  ]) {
    const options = fresh(); options.casdk.inst = install; options.casdk.uninst = !install; options.casdkAppsOnly = appsOnly; options.apps = { simpledashboard: true }
    const result = await compiler.compile({ options, outputParent }), text = script(result)
    for (const name of want) assert.ok(text.includes(fragment(name)), name)
    for (const name of absent) assert.ok(!text.includes(fragment(name)), name)
    assert.ok(text.includes('APPSIMPLEDASHBOARD=1\nAPPGPSSPEED=0'))
    assert.equal(result.files.some(x => x.startsWith('casdk/apps/app.simpledashboard/')), install)
  }
})

test('reviewer scalar command and whitespace/parentheses/slash variants reject before output', async t => {
  const { compiler, outputParent } = await setup(t)
  for (const value of ['x /usr/bin/id', 'gpsSpeedValue /bin/echo hi', 'gpsSpeedValue()', 'gpsSpeedValue/other', 'gpsSpeedValue other', 'gpsSpeedValue\tother']) {
    const options = fresh(); options.options = [19]; options.speedoOps.sbmain = value
    await assert.rejects(compiler.compile({ options, outputParent }), /Invalid compilation/, value)
    assert.deepEqual(fs.readdirSync(outputParent), [])
  }
})

test('numeric JavaScript slots and semantic scalars reject invalid types ranges and nonfinite values', () => {
  const cases = [
    ['spdExtra','barSpeedoRows', '4 / 0'], ['spdExtra','barSpeedoRows','4;globalThis.pwned=1'],
    ['spdExtra','barSpeedoRows','(4)'], ['spdExtra','barSpeedoRows','Infinity'], ['spdExtra','barSpeedoRows','0'],
    ['spdExtra','barThemeStart','1 /bin/id'], ['spdExtra','fuelGaugeValueSuffix','x /bin/id'],
    ['spdExtra','fuelGaugeFactor',Infinity], ['spdExtra','fuelGaugeFactor',-1],
    ['speedoOps','color',true], ['speedoOps','color',23], ['speedoOps','color','Red /bin/id'],
    ['speedoOps','sbval1','x /bin/id'], ['speedoOps','sbval2','x()'], ['speedoOps','sbfuel','x/y'],
    ['speedoOps','sbint',NaN], ['speedoOps','sbint',-1], ['speedoOps','opac',2],
    ['statusbar','app','rgb(1, 2, 3)'], ['statusbar','clock','white /bin/id'],
    ['statusbar','opacity',2], ['uistyle','body','x /bin/id'], ['uistyle','layout',99],
    ['uistyle','mainlabel',0.5], ['vpOps','repeat',99], ['vpOps','fullscreen',-1]
  ]
  for (const [group, key, value] of cases) {
    const options = fresh(); options[group][key] = value
    assert.throws(() => validateOptions(options), /Invalid compilation/, `${group}.${key}=${value}`)
  }
  for (const value of ['1+2','1 / 0','NaN','1e2','-1','6']) {
    const options = fresh(); options.spdValues[0].pos[0] = value
    assert.throws(() => validateOptions(options), /Invalid compilation/)
  }
})

test('post-commit backup removal failure returns new package and retained exact old bytes with warning', async t => {
  const { compiler, outputParent } = await setup(t)
  const old = await compiler.compile({ options: fresh(), outputParent }); const oldBytes = script(old)
  const options = fresh(); options.options = [6]
  const control = await setup(t)
  const newBytes = script(await control.compiler.compile({ options, outputParent: control.outputParent }))
  const rm = fs.rmSync; let backup; const events = []
  fs.rmSync = (name, ...args) => {
    if (path.basename(String(name)).startsWith('.aio-previous-')) { backup = name; throw Error('only backup removal failed') }
    return rm(name, ...args)
  }
  let result
  try { result = await compiler.compile({ options, outputParent }, event => events.push(event)) } finally { fs.rmSync = rm }
  assert.deepEqual(Object.keys(result).sort(), ['files', 'outputDirectory'])
  assert.equal(script(result), newBytes); assert.notEqual(newBytes, oldBytes)
  assert.equal(fs.readFileSync(path.join(backup, 'tweaks.sh'), 'utf8'), oldBytes)
  assert.equal(verifyOwned(backup), true); assert.equal(verifyOwned(result.outputDirectory), true)
  assert.ok(events.some(e => e.stage === 'warning' && e.code === 'BACKUP_CLEANUP_FAILED' && e.recoverable === true && e.backupDirectory === backup))
  await assert.rejects(compiler.compile({ options: { ...options, options: [999] }, outputParent }), /Invalid compilation/)
  assert.equal(fs.readFileSync(path.join(backup, 'tweaks.sh'), 'utf8'), oldBytes)
})

test('post-commit backup verification failure never authorizes removal', async t => {
  const { compiler, outputParent } = await setup(t)
  const first = await compiler.compile({ options: fresh(), outputParent }), oldBytes = script(first)
  const open = fs.openSync; let retained
  fs.openSync = (name, ...args) => {
    if (String(name).includes('/.aio-previous-') && path.basename(String(name)) === '.mzd-aio-owned.json') { retained = path.dirname(name); throw Error('backup verification denied') }
    return open(name, ...args)
  }
  const options = fresh(); options.options = [6]; const events = []
  try {
    const result = await compiler.compile({ options, outputParent }, event => {
      events.push(event)
      if (event.stage === 'warning') return Promise.reject(Error('async warning observer failed'))
    })
    assert.match(script(result), /INSTALL LIST_LOOP/)
  } finally { fs.openSync = open }
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fs.readFileSync(path.join(retained, 'tweaks.sh'), 'utf8'), oldBytes)
  assert.equal(verifyOwned(retained), true)
  assert.ok(events.some(e => e.stage === 'warning' && e.code === 'BACKUP_CLEANUP_FAILED' && e.backupDirectory === retained && /unowned or modified/.test(e.diagnostic)))
})

test('warning and completion observers cannot reject committed publication', async t => {
  const { compiler, outputParent } = await setup(t)
  await compiler.compile({ options: fresh(), outputParent })
  const rm = fs.rmSync
  fs.rmSync = (name, ...args) => { if (path.basename(String(name)).startsWith('.aio-previous-')) throw Error('cleanup denied'); return rm(name, ...args) }
  const options = fresh(); options.options = [6]
  try {
    const result = await compiler.compile({ options, outputParent }, e => { if (e.stage === 'warning' || e.stage === 'complete') throw Error('observer failed') })
    assert.match(script(result), /INSTALL LIST_LOOP/)
  } finally { fs.rmSync = rm }
  const result = await compiler.compile({ options: fresh(), outputParent }, e => { if (e.stage === 'complete') return Promise.reject(Error('async observer failed')) })
  assert.match(script(result), /INSTALL MAIN_MENU_LOOP/)
  await new Promise(resolve => setImmediate(resolve))
})

test('free-form Gracenote and WiFi text remain inert quoted assignment data', async t => {
  const { compiler, outputParent } = await setup(t)
  const text = 'space /path (x) "quote" \'single\' \\ $HOME `id`; | & < > # end'
  const options = fresh(); options.options = [26]; options.gracenoteText = text
  const result = await compiler.compile({ options, outputParent })
  assert.ok(script(result).includes('GRACENOTE="space /path (x) \\"quote\\" \'single\' \\\\ \\$HOME \\`id\\`; | & < > # end"'))
  options.autorun = { installer: true, autoWIFI: true }
  options.wifi = { ssid: '"$`\\; /bin/id (x)', password: text }
  await compiler.compile({ options, outputParent })
  const config = fs.readFileSync(path.join(result.outputDirectory, '02-start-wifiAP/wifiAP.config'), 'utf8')
  assert.ok(config.includes('export NETWORK_WIFI_SSID="\\"\\$\\`\\\\; /bin/id (x)"'))
  assert.ok(config.includes('export NETWORK_WIFI_PASSWORD="space /path (x) \\"quote\\" \'single\' \\\\ \\$HOME \\`id\\`; | & < > # end"'))
})

test('optional compiler flags require actual booleans instead of silent coercion', () => {
  for (const key of ['destruct', 'aaCarGPS', 'casdkAppsOnly']) {
    for (const value of ['true', 1, null, {}, []]) assert.throws(() => validateOptions({ ...fresh(), [key]: value }), /Invalid compilation/, key)
    assert.equal(validateOptions({ ...fresh(), [key]: true })[key], true)
    assert.equal(validateOptions({ ...fresh(), [key]: false })[key], false)
  }
})

test('JavaScript comment labels reject Unicode line terminators', () => {
  for (const separator of ['\u2028', '\u2029']) {
    const options = fresh(); options.spdValues[0].label = 'label' + separator + 'globalThis.pwned=1'
    assert.throws(() => validateOptions(options), /Invalid compilation/)
  }
})

test('stage publication rename failure rejects and restores exact previous output', async t => {
  const { compiler, outputParent } = await setup(t)
  const first = await compiler.compile({ options: fresh(), outputParent }); const old = script(first)
  const rename = fs.renameSync
  fs.renameSync = (from, to) => { if (path.basename(from).startsWith('.aio-stage-')) throw Error('publication rename denied'); return rename(from, to) }
  try { await assert.rejects(compiler.compile({ options: fresh(), outputParent }), /publication rename denied/) } finally { fs.renameSync = rename }
  assert.equal(script(first), old); assert.equal(verifyOwned(first.outputDirectory), true)
  assert.deepEqual(fs.readdirSync(outputParent), ['_copy_to_usb'])
})
