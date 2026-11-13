'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
module.exports = async function hiddenSmoke ({ app, primary, openScreen, children, service, imageParent, runtimeErrors, output }) {
  const evaluate = code => primary.webContents.executeJavaScript(code)
  await evaluate('window.desktopStartup')
  const state = await evaluate(`({require:typeof require, process:typeof process, angular:!!angular.element(document).injector(), text:document.body.textContent.slice(0,180), bridge:typeof aio.chooseImage})`)
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
  await assert.rejects(evaluate(`aio.compile()`), /Task 5/)
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
  await fs.writeFile(path.join(output, 'hidden-smoke.json'), JSON.stringify({ state, bridge, retainedJoiner, delayedMessages, editorShortcuts, secondary, joined, joinedImage, translatorReady, runtimeInstrumentationVerified: true, nativeImage: builtin, foreignNavigationRejected: prevented, closeFlushed: true, runtimeErrors }, null, 2))
  console.log('HIDDEN_SMOKE_PASS')
  app.exit(0)
}
