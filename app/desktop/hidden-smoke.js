'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
module.exports = async function hiddenSmoke ({ app, primary, openScreen, children, service, imageParent, runtimeErrors, output }) {
  const evaluate = code => primary.webContents.executeJavaScript(code)
  await evaluate('window.desktopStartup')
  // Angular bootstrap completion precedes asynchronous ng-view template loading.
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(`!!document.querySelector('#compileButton')`)) break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const state = await evaluate(`({require:typeof require, process:typeof process, angular:!!angular.element(document).injector(), text:document.body.textContent.slice(0,180), bridge:typeof aio.chooseImage, compileButton:document.querySelectorAll('#compileButton').length})`)
  assert.equal(state.compileButton, 1)
  const runtime = { packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, arch: process.arch, electron: process.versions.electron, modules: process.versions.modules, napi: process.versions.napi }
  if (app.isPackaged) assert.match(runtime.appPath, /Contents\/Resources\/app\.asar$/)
  console.log('PACKAGED_RUNTIME', JSON.stringify(runtime))
  console.log('PRIMARY_STATE', JSON.stringify(state))
  assert.equal(state.require, 'undefined'); assert.equal(state.process, 'undefined'); assert.equal(state.angular, true); assert.equal(state.bridge, 'function')
  await evaluate(`setTimeout(() => { throw Error('smoke-uncaught-marker') }, 0); setTimeout(() => Promise.reject(Error('smoke-rejection-marker')), 0); undefined`)
  await new Promise(resolve => setTimeout(resolve, 200))
  for (const marker of ['smoke-uncaught-marker', 'smoke-rejection-marker']) {
    assert.ok(runtimeErrors.some(error => error.includes(marker)), 'Runtime instrumentation missed ' + marker)
  }
  // Remove only deliberately injected diagnostics, retaining all real failures.
  for (let i = runtimeErrors.length - 1; i >= 0; i--) if (/smoke-(uncaught|rejection)-marker/.test(runtimeErrors[i])) runtimeErrors.splice(i, 1)
  const bridge = await evaluate(`(async () => { await aio.setPreference('aio-persist','hiddenSmoke',true); await desktopClient.refresh('aio-persist'); return persistantData.get('hiddenSmoke') })()`)
  assert.equal(bridge, true)
  await evaluate(`location.hash = '#/background'`)
  assert.match(primary.webContents.getURL(), /#\/background$/)
  const navigation = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Foreign navigation was not observed')), 3000)
    primary.webContents.once('will-navigate', event => { clearTimeout(timer); resolve(event.defaultPrevented) })
  })
  await evaluate(`location.assign('https://example.invalid'); undefined`)
  const prevented = await navigation
  assert.equal(prevented, true)
  assert.match(primary.webContents.getURL(), /#\/background$/)
  assert.equal(await evaluate(`aio.chooseImage('background')`), null)
  await assert.rejects(evaluate(`aio.chooseImage('invalid')`), /kind/i)
  await assert.rejects(evaluate(`aio.compile({ options: { options: [999] }, outputParent: '/invalid' })`), /allowed|Invalid/)
  const compilation = await evaluate(`(async () => {
    const scope = angular.element(document.body).scope()
    scope.user.options = [5]; scope.user.mainOps = [0, 4, 7]
    await scope.compileTweaks()
    return { result: scope.compileResult, error: scope.compileError }
  })()`)
  assert.ok(compilation.result?.files.includes('tweaks.sh'), 'Real UI compile did not return an awaited package')
  assert.equal(compilation.error, null)
  const generatedScript = await fs.readFile(path.join(compilation.result.outputDirectory, 'tweaks.sh'), 'utf8')
  assert.match(generatedScript, /INSTALL MAIN_MENU_LOOP/)
  const generatedConfig = 'config/main-menu-loop/jci/gui/apps/system/controls/MainMenu/js/MainMenuCtrl.js'
  assert.deepEqual(await fs.readFile(path.join(compilation.result.outputDirectory, generatedConfig)), await fs.readFile(path.join(__dirname, '../files/tweaks', generatedConfig)))
  const compilationFailure = await evaluate(`(async () => {
    bootbox.hideAll()
    const scope = angular.element(document.body).scope()
    scope.user.options = [999]
    await scope.compileTweaks()
    // Bootstrap removes hidden dialogs after its asynchronous fade transition.
    // Inspect the newly appended error dialog, not a fading previous success.
    const state = { result: scope.compileResult, error: scope.compileError, text: [...document.querySelectorAll('.bootbox')].at(-1)?.textContent || '' }
    bootbox.hideAll(); scope.user.options = [5]
    return state
  })()`)
  assert.equal(compilationFailure.result, null)
  assert.match(compilationFailure.error, /Invalid compilation/)
  assert.match(compilationFailure.text, /Could not compile:.*Invalid compilation/)
  assert.doesNotMatch(compilationFailure.text, /Package generated|Compilation finished|success/i)
  assert.equal(await fs.readFile(path.join(compilation.result.outputDirectory, 'tweaks.sh'), 'utf8'), generatedScript)
  // Exercise renderer/main validation and post-commit warning delivery, not a
  // substitute compiler. Only the hidden harness injects one owned-backup rm.
  const scalarFailures = []
  for (const field of ['sbmain', 'barSpeedoRows']) {
    const failure = await evaluate(`(async () => {
      const scope = angular.element(document.body).scope(), saved = structuredClone(scope.user)
      scope.user.options = [19]
      if (${JSON.stringify(field)} === 'sbmain') scope.user.speedoOps.sbmain = 'x /usr/bin/id'
      else scope.user.spdExtra.barSpeedoRows = '4 / 0'
      try {
        bootbox.hideAll(); await scope.compileTweaks()
        return { result: scope.compileResult, error: scope.compileError }
      } finally { scope.user = saved; bootbox.hideAll() }
    })()`)
    assert.equal(failure.result, null); assert.match(failure.error, /Invalid compilation/)
    assert.equal(await fs.readFile(path.join(compilation.result.outputDirectory, 'tweaks.sh'), 'utf8'), generatedScript)
    scalarFailures.push({ field, ...failure })
  }
  const compileSelection = id => evaluate(`(async () => {
    const scope = angular.element(document.body).scope()
    scope.user.options = [${id}]; bootbox.hideAll(); await scope.compileTweaks(); bootbox.hideAll()
    return { result: scope.compileResult, error: scope.compileError }
  })()`)
  const newControl = await compileSelection(6)
  assert.equal(newControl.error, null)
  const newScript = await fs.readFile(path.join(newControl.result.outputDirectory, 'tweaks.sh'), 'utf8')
  assert.notEqual(newScript, generatedScript)
  await compileSelection(5)
  await evaluate(`window.cleanupEvents = []; window.stopCleanupEvents = aio.onProgress(e => cleanupEvents.push(e)); undefined`)
  const sync = require('node:fs'), originalRm = sync.rmSync
  let retainedBackup
  sync.rmSync = (name, ...args) => {
    if (path.dirname(String(name)) === path.dirname(compilation.result.outputDirectory) && path.basename(String(name)).startsWith('.aio-previous-')) {
      retainedBackup = String(name); throw Error('hidden-only old-backup removal failure')
    }
    return originalRm(name, ...args)
  }
  let cleanupCompilation
  try { cleanupCompilation = await compileSelection(6) } finally { sync.rmSync = originalRm }
  const cleanupEvents = await evaluate(`(() => { stopCleanupEvents(); return cleanupEvents })()`)
  assert.equal(cleanupCompilation.error, null); assert.ok(cleanupCompilation.result?.files.includes('tweaks.sh'))
  assert.equal(await fs.readFile(path.join(cleanupCompilation.result.outputDirectory, 'tweaks.sh'), 'utf8'), newScript)
  assert.equal(await fs.readFile(path.join(retainedBackup, 'tweaks.sh'), 'utf8'), generatedScript)
  assert.equal(require('./compiler-manifest').verifyOwned(retainedBackup), true)
  assert.ok(cleanupEvents.some(e => e.stage === 'warning' && e.code === 'BACKUP_CLEANUP_FAILED' && e.recoverable && e.backupDirectory === retainedBackup))
  console.log('COMPILER_FIX_REGRESSION_PASS', JSON.stringify({ scalarFailures, cleanupCompilation, retainedBackup, cleanupEvents: cleanupEvents.filter(e => e.stage !== 'generate') }))
  const builtin = await evaluate(`aio.selectBuiltinImage('background')`)
  const { nativeImage } = require('electron')
  assert.deepEqual(nativeImage.createFromPath(builtin.destination).getSize(), { width: 800, height: 480 })
  console.log('NATIVE_LOAD', JSON.stringify({ drivelist: require('../node_modules/drivelist/package.json').version, native: typeof require('../node_modules/drivelist/build/Release/drivelist.node').list, image: builtin }))
  await openScreen('info')
  const info = children.get('info')
  const secondary = await info.webContents.executeJavaScript(`window.secondaryStartup.then(() => ({require:typeof require, process:typeof process, text:document.body.textContent}))`)
  assert.equal(secondary.require, 'undefined'); assert.equal(secondary.process, 'undefined')
  await assert.rejects(info.webContents.executeJavaScript(`aio.getPreferences('aio-persist')`), /sender\/frame/i)
  await assert.rejects(info.webContents.executeJavaScript(`aio.chooseImage('album')`), /capability|sender/i)
  // Exercise the immutable payload's actual action, not the alternate menu.
  const retainedJoiner = await evaluate(`(async () => {
    const host = document.createElement('div'); host.hidden = true
    host.innerHTML = await (await fetch('opts/bgoptions.htm')).text(); document.body.append(host)
    migratePayloadControls()
    const button = [...host.querySelectorAll('[onclick]')].find(x => x.getAttribute('onclick').includes("openScreen('joiner')"))
    if (!button) throw Error('Retained joiner control not normalized')
    const normalized = button.getAttribute('onclick'); button.click(); host.remove(); return normalized
  })()`)
  for (let attempt = 0; !children.has('joiner') && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(children.has('joiner'), 'Retained control did not open joiner')
  const joiner = children.get('joiner')
  if (joiner.webContents.isLoading()) await new Promise(resolve => joiner.webContents.once('did-finish-load', resolve))
  const joined = await joiner.webContents.executeJavaScript(`window.secondaryStartup.then(() => ({require:typeof require, process:typeof process, ready:!!angular.element(document).injector()}))`)
  assert.equal(joined.require, 'undefined'); assert.equal(joined.process, 'undefined'); assert.equal(joined.ready, true)
  assert.equal(joiner.isVisible(), false)
  const joinedImage = await joiner.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 480
    const result = await aio.saveJoinedImage(canvas.toDataURL('image/png'))
    await aio.setBackgroundRotator(2, 60)
    return result
  })()`)
  assert.deepEqual(nativeImage.createFromPath(joinedImage.destination).getSize(), { width: 1600, height: 480 })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await evaluate(`settings.get('stagedImages.background')`), joinedImage.destination)
  assert.deepEqual(await evaluate(`settings.get('backgroundRotator')`), { images: 2, seconds: 60 })
  const representative = await evaluate(`(async () => {
    await aio.selectBuiltinImage('offscreen'); await aio.selectBuiltinImage('album')
    const messages = await aio.loadMessages(), language = messages.Node.Node[0].Node[0]
    const values = language.Node.map(node => node.$.value)
    values[0] = 'Task 5 scratch message & XML'
    await aio.saveMessages(language.$.key, values)
    const scope = angular.element(document.body).scope()
    scope.user.options = [5, 11, 16, 19]
    scope.user.mainOps = [0, 2, 3, 4, 6, 10]; scope.user.colors = 8
    bootbox.hideAll(); await scope.compileTweaks(); bootbox.hideAll()
    return { result: scope.compileResult, error: scope.compileError }
  })()`)
  assert.equal(representative.error, null)
  assert.ok(representative.result?.files.includes('config/speedometer/speedometer-config.js'))
  const generated = representative.result.outputDirectory
  const representativeScript = await fs.readFile(path.join(generated, 'tweaks.sh'), 'utf8')
  assert.match(representativeScript, /BG_STEPS=2\nBG_SECONDS=120\nBG_SEC_EACH=60\nBG_WIDTH=1600/)
  assert.ok(representativeScript.indexOf('START ENABLE WIFI') < representativeScript.indexOf('INSTALL MAIN_MENU_LOOP'))
  assert.deepEqual(await fs.readFile(path.join(generated, 'config/background.png')), await fs.readFile(joinedImage.destination))
  assert.match(await fs.readFile(path.join(generated, 'config/message_replies/jci/settings/configurations/blm_msg-system.xml'), 'utf8'), /Task 5 scratch message &amp; XML/)
  assert.ok(representative.result.files.some(name => name.startsWith('config/color-schemes/theme/jci/')))
  const { verifyOwned, manifest } = require('./compiler-manifest')
  assert.equal(verifyOwned(generated), true)
  const generatedManifest = manifest(generated)
  assert.deepEqual(representative.result.files, [...Object.keys(generatedManifest.files), '.mzd-aio-owned.json'].sort())
  await fs.writeFile(path.join(output, 'compiler-manifest.json'), JSON.stringify(generatedManifest, null, 2))
  console.log('COMPILER_GENERATION_PASS', JSON.stringify({ outputDirectory: generated, files: representative.result.files.length }))
  assert.equal(primary.isVisible(), false); assert.equal(info.isVisible(), false)
  // Hidden-only fixture: fetch/compile fixed bundled payload bytes, never user HTML.
  const delayedMessages = await evaluate(`(async () => {
    const injector = angular.element(document).injector(), scope = injector.get('$rootScope').$new()
    scope.user = { replyMsgLang: 0 }
    const [messagesSource, controller, html, data] = await Promise.all([
      fetch('assets/js/messages-settings.js').then(x => x.text()), fetch('controllers/home.js').then(x => x.text()),
      fetch('opts/11options.htm').then(x => x.text()), aio.loadMessages()
    ])
    let release
    const delayed = new Promise(resolve => { release = resolve })
    const binding = controller.slice(controller.indexOf('      $scope.replyLangs ='), controller.indexOf('      $scope.checkDuplicatePos ='))
    const initialize = new Function('aio', '$scope', messagesSource + '\\n' + binding + '\\nreturn messagesReady')
    const ready = initialize({ loadMessages: () => delayed }, scope)
    const host = document.createElement('div'); host.hidden = true; host.innerHTML = html; document.body.append(host)
    injector.get('$compile')(host)(scope); scope.$digest(); migratePayloadControls()
    const select = host.querySelector('select'), before = select.options.length
    release(data); await ready
    await new Promise(resolve => scope.$evalAsync(() => scope.$$postDigest(resolve)))
    const after = select.options.length, count = scope.replyLangs.length
    const saveNormalized = !host.querySelector('[ng-click="savePresetMsgs()"]').hasAttribute('onclick')
    const resetNormalized = [...host.querySelectorAll('[onclick]')].some(x => x.getAttribute('onclick') === 'resetMsgLang()')
    scope.$destroy(); host.remove()
    return { before, after, count, saveNormalized, resetNormalized }
  })()`)
  assert.ok(delayedMessages.count > 0)
  assert.ok(delayedMessages.after > delayedMessages.before, 'Delayed languages did not render in retained dropdown')
  assert.equal(delayedMessages.saveNormalized, true); assert.equal(delayedMessages.resetNormalized, true)
  await evaluate(`location.hash = '#/translate'`)
  let translatorReady = false
  for (let attempt = 0; attempt < 100; attempt++) {
    translatorReady = await evaluate(`!!document.querySelector('#editor_holder input, #editor_holder textarea')`)
    if (translatorReady) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(translatorReady, true, 'Translator editor did not initialize')
  // Dispatch only: verify retained editor handlers do not intercept macOS text
  // shortcuts. Never touch the user's native clipboard or focus a window.
  const editorShortcuts = await evaluate(`(() => {
    const input = document.querySelector('#editor_holder input, #editor_holder textarea')
    return ['x', 'c', 'v', 'a'].map(key => {
      const event = new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true })
      input.dispatchEvent(event); return { key, prevented: event.defaultPrevented }
    })
  })()`)
  assert.ok(editorShortcuts.every(event => !event.prevented))
  // Allow route scripts to finish, so asynchronous errors cannot hide behind script load events.
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.deepEqual(runtimeErrors, [])
  joiner.destroy()
  info.destroy()
  await evaluate(`persistantData.set('closeSmoke','flushed')`)
  primary.close()
  await new Promise(resolve => primary.once('closed', resolve))
  const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'preferences/aio-persist.json'), 'utf8'))
  assert.equal(saved.closeSmoke, 'flushed')
  await fs.writeFile(path.join(output, 'hidden-smoke.json'), JSON.stringify({ runtime, windowsHiddenAtChecks: true, scalarFailures, cleanupCompilation, retainedBackup, cleanupEvents, compilation, compilationFailure, representative, generatedManifest, state, bridge, retainedJoiner, delayedMessages, editorShortcuts, secondary, joined, joinedImage, translatorReady, runtimeInstrumentationVerified: true, nativeImage: builtin, foreignNavigationRejected: prevented, closeFlushed: true, runtimeErrors }, null, 2))
  console.log('HIDDEN_SMOKE_PASS')
  app.exit(0)
}
