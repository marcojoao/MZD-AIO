'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createPreferenceService } = require('../../app/desktop/preferences')
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prefs-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const options = { directory: path.join(root, 'current'), legacyDirectory: path.join(root, 'legacy'), resourceDirectory: path.resolve('app'), app: { name: 'MZD', version: '2.8.6' }, paths: { desktop: '/fixture/Desktop', home: '/fixture/app' } }
  await fs.mkdir(options.legacyDirectory)
  return { root, options, service: createPreferenceService(options) }
}
test('legacy import preserves original bytes, untouched fields and selected arrays through repeated serialized saves', async t => {
  const {options, service} = await fixture(t)
  const original = '{ "options": [1,20,103], "mainOps": [7], "unknown": {"keep": true} }\n'
  const legacy = path.join(options.legacyDirectory, 'aio-data.json')
  await fs.writeFile(legacy, original)
  assert.deepEqual((await service.getPreferences('aio-data')).options, [1,20,103])
  await Promise.all([service.setPreference('aio-data','darkMode',true), service.setPreference('aio-data','statusbar.clock',false),service.setPreference('aio-data','colors',8)])
  const reread = await createPreferenceService(options).getPreferences('aio-data')
  assert.deepEqual(reread, {options:[1,20,103], mainOps:[7], unknown:{keep:true}, darkMode:true, statusbar:{clock:false}, colors:8})
  assert.equal(await fs.readFile(legacy,'utf8'),original)
})
test('missing stores are empty without writing files; bootstrap defaults do not erase saved language or metadata', async t => {
  const {options,service} = await fixture(t)
  assert.deepEqual(await service.getPreferences('aio-last'),{})
  await assert.rejects(fs.access(options.directory), {code:'ENOENT'})
  await service.setPreference('aio-persist','lang','french')
  const result = await service.bootstrap()
  assert.deepEqual(result.app,{name:'MZD',version:'2.8.6'})
  assert.equal(result.paths.desktop,'/fixture/Desktop')
  assert.equal(result.language.name,'french')
  assert.ok(result.language.messages.menu)
  assert.ok(result.language.defaults.menu)
  assert.ok(result.language.schema)
  assert.equal(result.preferences['aio-persist'].lang,'french')
  result.preferences['aio-persist'].lang='changed snapshot'
  assert.equal((await service.getPreferences('aio-persist')).lang,'french')
})
test('unsafe or unavailable language falls back without loading arbitrary paths or overwriting choice', async t => {
  const {service}=await fixture(t)
  for (const name of ['../../secrets','nonexistent']) {
    await service.setPreference('aio-persist','lang',name)
    assert.equal((await service.bootstrap()).language.name,'english')
    assert.equal((await service.getPreferences('aio-persist')).lang,name)
  }
})
test('corrupt current or legacy stores fail explicitly and never overwrite original bytes', async t => {
  const {options,service}=await fixture(t)
  for (const dir of [options.legacyDirectory, options.directory]) {
    await fs.mkdir(dir,{recursive:true}); const file=path.join(dir,'aio-data.json')
    await fs.writeFile(file,'{broken')
    await assert.rejects(service.getPreferences('aio-data'),/corrupt.*aio-data/i)
    await assert.rejects(service.setPreference('aio-data','a',1),/corrupt.*aio-data/i)
    await assert.rejects(service.bootstrap(),/corrupt.*aio-data/i)
    assert.equal(await fs.readFile(file,'utf8'),'{broken')
    await fs.unlink(file)
  }
})
test('unknown stores, prototype paths and non JSON values are rejected before writes', async t => {
  const {service}=await fixture(t)
  await assert.rejects(service.getPreferences('../x'),/store/i)
  for(const key of ['__proto__','constructor.x','a.prototype.x','','a..b']) await assert.rejects(service.setPreference('aio-data',key,{}),/key/i)
  const cycle={}; cycle.self=cycle
  for(const value of [undefined, NaN, Infinity, new Date(), cycle, {x:undefined}, JSON.parse('{"__proto__":{}}')]) await assert.rejects(service.setPreference('aio-data','x',value),/JSON|key/i)
  assert.deepEqual(await service.getPreferences('aio-data'),{})
})
test('JSON validation rejects lossy arrays and dotted writes do not silently discard fields',async t=>{
  const {service}=await fixture(t)
  const array=[1];array.extra='lost'
  await assert.rejects(service.setPreference('aio-data','options',array),/JSON/i)
  await service.setPreference('aio-data','options',[20])
  await assert.rejects(service.setPreference('aio-data','options.extra',true),/JSON/i)
  assert.deepEqual((await service.getPreferences('aio-data')).options,[20])
})

test('failed filesystem save leaves prior file intact and next write can recover',async t=>{
  const {options,service}=await fixture(t)
  await service.setPreference('aio-data','options',[20])
  const file=path.join(options.directory,'aio-data.json'); const before=await fs.readFile(file)
  // A real filesystem error: replace the store directory with a regular file.
  await fs.rename(options.directory, options.directory+'.saved')
  await fs.writeFile(options.directory,'blocked')
  await assert.rejects(service.setPreference('aio-data','options',[1]))
  assert.deepEqual(await fs.readFile(path.join(options.directory+'.saved','aio-data.json')),before)
  await fs.unlink(options.directory); await fs.rename(options.directory+'.saved',options.directory)
  await service.setPreference('aio-data','darkMode',true)
  assert.deepEqual((await service.getPreferences('aio-data')).options,[20])
  assert.deepEqual((await fs.readdir(options.directory)).sort(),['aio-data.json'])
})
