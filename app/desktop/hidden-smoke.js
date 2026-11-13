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
  await openScreen('joiner')
  const joiner = children.get('joiner')
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
  await evaluate(`location.hash = '#/translate'`)
  let translatorReady = false
  for (let attempt = 0; attempt < 100; attempt++) {
    translatorReady = await evaluate(`!!document.querySelector('#editor_holder input, #editor_holder textarea')`)
    if (translatorReady) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.equal(translatorReady, true, 'Translator editor did not initialize')
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
  await fs.writeFile(path.join(output, 'hidden-smoke.json'), JSON.stringify({ state, bridge, secondary, joined, joinedImage, translatorReady, runtimeInstrumentationVerified: true, nativeImage: builtin, foreignNavigationRejected: prevented, closeFlushed: true, runtimeErrors }, null, 2))
  console.log('HIDDEN_SMOKE_PASS')
  app.exit(0)
}
