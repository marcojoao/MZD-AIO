'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const pause = () => new Promise(resolve => setTimeout(resolve, 30))
module.exports = async function finalFrontDoor ({ primary, fixtureControls, app, imageParent, output }) {
  const evaluate = code => primary.webContents.executeJavaScript(code)
  async function ready () {
    await evaluate('window.desktopStartup')
    for (let i = 0; i < 300; i++) { if (await evaluate(`!!document.querySelector('#compileButton')`)) return; await pause() }
    throw Error('Compile control did not load after reopen')
  }
  async function reopen () { primary = await fixtureControls.reopen(); await ready() }
  async function frontDoor (setup = '') {
    await evaluate(`location.hash='#/'; undefined`)
    await ready()
    await evaluate('bootbox.hideAll(); undefined')
    for (let i = 0; i < 100; i++) { if (await evaluate(`document.querySelectorAll('.bootbox').length === 0`)) break; await pause() }
    await evaluate(`(() => { bootbox.hideAll(); const scope=angular.element(document.body).scope(); scope.compileResult=null; scope.compileError=null; ${setup}; scope.$apply(); document.querySelector('#compileButton').click() })()`)
    for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector('.confirmCompile .btn-success')`)) break; await pause() }
    assert.equal(await evaluate(`!!document.querySelector('.confirmCompile .btn-success')`), true, 'ordinary compile button must reach confirmation')
    await evaluate(`document.querySelector('.confirmCompile .btn-success').click(); undefined`)
    for (let i = 0; i < 2000; i++) {
      const state = await evaluate(`(() => { const s=angular.element(document.body).scope(); return {compiling:s.compiling,result:s.compileResult,error:s.compileError} })()`)
      if (!state.compiling && (state.result || state.error)) { await evaluate('bootbox.hideAll(); undefined'); return state }
      await pause()
    }
    throw Error('Ordinary compile did not settle')
  }
  await evaluate(`location.hash='#/'; undefined`)
  await ready()
  const results = []
  const theme = await frontDoor('scope.user.options=[5];scope.user.mainOps=[0,3,4];scope.user.colors=8')
  assert.equal(theme.error, null); assert.ok(theme.result.files.some(n => n.startsWith('config/color-schemes/theme/jci/')))
  results.push({ route: 'bundled-theme-button-confirmation', files: theme.result.files.length })
  const { nativeImage } = require('electron')
  const legacyBytes = nativeImage.createFromBitmap(Buffer.from([10,20,30,255]), { width: 1, height: 1 }).resize({ width: 800, height: 480 }).toPNG()
  // Use real native PNG fixtures, distinguishable by pixels and dimensions.
  assert.equal(nativeImage.createFromBuffer(legacyBytes).isEmpty(), false)
  const themeDir = path.join(output, 'fixture-theme/jci'); await fs.mkdir(themeDir, { recursive: true }); await fs.writeFile(path.join(themeDir, 'fixture.png'), legacyBytes)
  fixtureControls.choose(themeDir)
  const grant = await evaluate(`(async()=>{ await selectTheme(); return angular.element(document.body).scope().user.customTheme })()`)
  assert.ok(grant.token)
  const custom = await frontDoor(`scope.user.colors=17;scope.user.customTheme=${JSON.stringify(grant)}`)
  assert.equal(custom.error, null)
  assert.deepEqual(await fs.readFile(path.join(custom.result.outputDirectory, 'config/color-schemes/theme/jci/fixture.png')), legacyBytes)
  const previous = await fs.readFile(path.join(custom.result.outputDirectory, 'tweaks.sh'))
  const unavailable = await frontDoor('scope.user.colors=0;scope.user.customTheme=false')
  assert.equal(unavailable.result, null); assert.match(unavailable.error, /Required asset unavailable.*downloads are disabled/)
  assert.deepEqual(await fs.readFile(path.join(custom.result.outputDirectory, 'tweaks.sh')), previous)
  results.push({ route: 'chooser-theme-button-confirmation', grant: !!grant.token }, { route: 'unavailable-theme', error: unavailable.error })
  // Old snapshots contain old output, native chooser acknowledgement records new.
  const oldParent = path.join(output, 'old-choice'), newParent = path.join(output, 'current-choice')
  await fs.mkdir(oldParent); await fs.mkdir(newParent)
  fixtureControls.choose(oldParent); await evaluate('aio.chooseOutputDirectory()')
  await frontDoor('scope.user.colors=8;scope.user.mainOps=[0,4];scope.user.options=[5]')
  const oldScript = await fs.readFile(path.join(oldParent, '_copy_to_usb/tweaks.sh'))
  await evaluate(`(async()=>{ const s=angular.element(document.body).scope(); s.user.copydir=${JSON.stringify(oldParent)}; await settings.set(JSON.parse(angular.toJson(s.user))); await lastView.set(JSON.parse(angular.toJson(s.user))); await desktopClient.flush() })()`)
  fixtureControls.choose(newParent); await evaluate('aio.chooseOutputDirectory()')
  await reopen()
  for (const route of ['restart', 'loadOps', 'loadLast']) {
    if (route !== 'restart') await evaluate(`document.querySelector(${JSON.stringify(route === 'loadOps' ? '#load-btn' : '#load-last-btn')}).click(); undefined`)
    const state = await frontDoor('scope.user.options=[6]')
    assert.equal(state.error, null); assert.equal(state.result.outputDirectory, path.join(newParent, '_copy_to_usb'))
    assert.deepEqual(await fs.readFile(path.join(oldParent, '_copy_to_usb/tweaks.sh')), oldScript)
    assert.notDeepEqual(await fs.readFile(path.join(newParent, '_copy_to_usb/tweaks.sh')), oldScript)
    results.push({ route, outputDirectory: state.result.outputDirectory, oldBytesPreserved: true })
  }
  const kinds = { background: ['background.png','config/background.png'], offscreen: ['OffScreenBackground.png','config/OffScreenBackground.png'], album: ['no_artwork_icon.png','config/blank-album-art-frame/jci/gui/common/images/no_artwork_icon.png'] }
  const legacy = path.join(app.getPath('userData'), 'background')
  await fs.mkdir(legacy, { recursive: true }); await fs.mkdir(path.join(imageParent, '_copy_to_usb'), { recursive: true })
  for (const [filename] of Object.values(kinds)) await fs.writeFile(path.join(legacy, filename), legacyBytes)
  for (const mode of ['legacy', 'current', 'invalid-current', 'invalid-legacy', 'default']) {
    for (const [kind, [filename]] of Object.entries(kinds)) {
      const current = path.join(imageParent, '_copy_to_usb', filename), historical = path.join(legacy, filename)
      if (mode === 'legacy') await fs.rm(current, { force: true })
      if (mode === 'current') {
        // Real staging via native writer through the named bridge.
        await evaluate(`aio.selectBuiltinImage(${JSON.stringify(kind)})`)
      }
      if (mode === 'invalid-current') await fs.writeFile(current, legacyBytes.subarray(0, 33))
      if (mode === 'invalid-legacy') { await fs.rm(current, { force: true }); await fs.writeFile(historical, legacyBytes.subarray(0, 33)) }
      if (mode === 'default') await fs.rm(historical, { force: true })
    }
    await reopen()
    const states = await evaluate('aio.getImageState()')
    const bootstrap = await evaluate('desktopData.images')
    for (const kind of Object.keys(kinds)) assert.deepEqual(states[kind], bootstrap[kind], 'restart preview must use main resolution')
    const state = await frontDoor('scope.user.mainOps=[0,2,4,10];scope.user.options=[5,16]')
    if (mode.startsWith('invalid')) {
      assert.equal(state.result, null); assert.match(state.error, /decode.*image/)
      for (const item of Object.values(states)) assert.match(item.error, /decode.*image/)
      // Also isolate each kind so a bad background cannot mask album/offscreen.
      for (const [kind, ops, options] of [['background',[2],[5]],['offscreen',[10],[5]],['album',[0],[16]]]) {
        const bad = await frontDoor(`scope.user.mainOps=${JSON.stringify(ops)};scope.user.options=${JSON.stringify(options)}`)
        assert.equal(bad.result, null); assert.match(bad.error, new RegExp('decode ' + kind + ' image'))
      }
    } else {
      assert.equal(state.error, null)
      for (const [kind, [filename, generated]] of Object.entries(kinds)) {
        const bytes = await fs.readFile(path.join(state.result.outputDirectory, generated))
        assert.ok(bytes.equals(Buffer.from(states[kind].preview.split(',')[1], 'base64')), 'preview/compiler exact PNG agreement: ' + kind)
        const selector = kind === 'background' ? '#infotnmtBG' : kind === 'album' ? '#blnk-albm-img img' : '#resolved-offscreen-preview img'
        assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.src`), states[kind].preview)
        if (mode !== 'default') assert.ok((await fs.readFile(path.join(legacy, filename))).equals(legacyBytes), 'legacy originals remain unmodified')
      }
    }
    results.push({ route: 'restart-images', mode, success: !state.error, kinds: Object.keys(kinds) })
  }
  // Restore the standard fixture output and defaults for the retained smoke.
  fixtureControls.choose(output); await evaluate('aio.chooseOutputDirectory()')
  await evaluate(`(async()=>{ const s=angular.element(document.body).scope(); s.user.options=[5];s.user.mainOps=[0,4,7]; await settings.set({copydir:${JSON.stringify(output)},mainOps:[0,4,7],options:[5]}); await desktopClient.flush() })()`)
  console.log('FINAL_FRONT_DOOR_PASS', JSON.stringify(results))
  return { primary, results, frontDoor }
}
