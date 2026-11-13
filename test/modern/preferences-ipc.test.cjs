'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),fsp=require('node:fs/promises')
const {pathToFileURL}=require('node:url')
const {registerPreferenceIpc}=require('../../app/desktop/preferences-ipc')
const {createPreferenceService}=require('../../app/desktop/preferences')
test('real preference preload methods and real handlers validate sender, frame, arguments and preserve data',async t=>{
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'ipc-'));t.after(()=>fsp.rm(directory,{recursive:true,force:true}))
 const service=createPreferenceService({directory,resourceDirectory:path.resolve('app'),app:{name:'MZD',version:'2.8.6'},paths:{desktop:'/Desktop'}})
 const handlers=new Map();const frame={url:pathToFileURL(path.resolve('app/index.html')).href+'?lang=french'};const sender={mainFrame:frame};const event={sender,senderFrame:frame}
 registerPreferenceIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},service,getWebContents:()=>sender,indexPath:path.resolve('app/index.html')})
 assert.equal(handlers.size,3,'preference protocol registers three handlers')
 let exposed
 vm.runInNewContext(fs.readFileSync('app/preload.js','utf8'),{require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'aio');exposed=value}},ipcRenderer:{invoke:async(name,...args)=>{assert.ok(handlers.has(name));return handlers.get(name)(event,...args)}}}}})
 for (const name of ['bootstrap','getPreferences','setPreference']) assert.equal(typeof exposed[name], 'function')
 for (const forbidden of ['invoke','send','require','process','fs','ipcRenderer']) assert.equal(exposed[forbidden], undefined)
 assert.equal((await exposed.bootstrap()).language.name,'french')
 await exposed.setPreference('aio-data','options',[20,103]);assert.deepEqual((await exposed.getPreferences('aio-data')).options,[20,103])
 for(const [channel,handler] of handlers){
  const args=channel==='aio:bootstrap'?[]:channel==='aio:get-preferences'?['aio-data']:['aio-data','colors',8]
  for(const bad of [{sender:{mainFrame:frame},senderFrame:frame},{sender,senderFrame:{url:frame.url}},{sender,senderFrame:null}])await assert.rejects(Promise.resolve().then(()=>handler(bad,...args)),/sender|frame/i)
  const original=frame.url
  for(const url of ['https://example.org/',pathToFileURL(path.resolve('app/views/404.html')).href]){frame.url=url;await assert.rejects(Promise.resolve().then(()=>handler(event,...args)),/sender|frame/i)}frame.url=original
  await assert.rejects(Promise.resolve().then(()=>handler(event,...args,'extra')),/argument/i)
 }
 await assert.rejects(exposed.setPreference('unknown','x',1),/store/i)
 await assert.rejects(exposed.setPreference('aio-data','__proto__',{}),/key/i)
 await assert.rejects(exposed.setPreference('aio-data','x',undefined),/JSON/i)
 frame.url=pathToFileURL(path.resolve('app/index.html')).href+'?lang=../../secret'
 assert.equal((await exposed.bootstrap()).language.name,'french')
})
