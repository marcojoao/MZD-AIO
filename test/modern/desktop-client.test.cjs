'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const vm=require('node:vm')
const fs=require('node:fs')
const {createDesktopClient,startDesktop,mergeDefaults,loadDesktopScripts}=require('../../app/assets/js/desktop-client')
const {createPreferenceService}=require('../../app/desktop/preferences')
function data(){return {app:{name:'MZD',version:'2.8.6'},paths:{desktop:'/Desktop'},preferences:{'aio-data':{options:[20], nested:{keep:true}},'aio-persist':{},'aio-data-obj':{},'aio-last':{},'user-themes':{},casdk:{},MZD_Speedometer:{}},language:{name:'english',messages:{menu:{}},defaults:{},schema:{}}}}
function deferred(){let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
test('cache queues captured bulk and dotted writes, immediate reads, and flush waits for actual persistence',async()=>{
 const gate=deferred(); const writes=[]
 const api={setPreference:async(store,key,value)=>{if(!writes.length)await gate.promise;writes.push({store,key,value})}}
 const client=createDesktopClient(data(),api); const cache=client.stores['aio-data']; const object={options:[1,103],colors:8}
 cache.set(object); object.options.push(99); cache.set('nested.clock',false); cache.set('literal\\.dot',7)
 assert.deepEqual(cache.get('options'),[1,103]);assert.equal(cache.has('nested.clock'),true);assert.equal(cache.get('nested.clock'),false); assert.equal(cache.get('missing','default'),'default')
 let flushed=false;const flush=client.flush().then(()=>{flushed=true});await new Promise(setImmediate);assert.equal(flushed,false)
 gate.resolve();await flush
 assert.deepEqual(writes,[{store:'aio-data',key:'options',value:[1,103]},{store:'aio-data',key:'colors',value:8},{store:'aio-data',key:'nested.clock',value:false},{store:'aio-data',key:'literal\\.dot',value:7}])
 const snapshot=cache.store;snapshot.options.push(99);assert.deepEqual(cache.get('options'),[1,103]);assert.equal(cache.get('literal\\.dot'),7)
 cache.set('colors',2);await cache.flush();assert.equal(writes.at(-1).value,2)
})
test('failed save is observable, flush rejects even when caller ignores set, no later false success',async()=>{
 const client=createDesktopClient(data(),{setPreference:async()=>{throw new Error('disk full')}})
 client.stores['aio-data'].set('options',[1])
 await assert.rejects(client.flush(),/disk full/)
 await assert.rejects(client.stores['aio-data'].set('colors',3),/disk full/)
 await assert.rejects(client.flush(),/disk full/)
})
test('invalid bulk writes are all rejected before mutating cache or issuing IPC',()=>{
 const client=createDesktopClient(data(),{setPreference:()=>{throw Error('must not send')}})
 const cache=client.stores['aio-data']
 for(const key of ['__proto__','constructor.x','x.prototype']) assert.throws(()=>cache.set(key,{}),/key/i)
 assert.throws(()=>cache.set({colors:3,bad:undefined}),/JSON/i)
 assert.equal(cache.get('colors'),undefined)
 assert.equal(Object.prototype.polluted,undefined)
})
test('saved selections replace arrays but missing legacy object fields inherit defaults without mutating either input',()=>{
 const defaults={options:[7],statusbar:{clock:true,date:true},newField:1}
 const saved={options:[20,103],statusbar:{clock:false},unknown:'keep'}
 assert.deepEqual(mergeDefaults(defaults,saved),{options:[20,103],statusbar:{clock:false,date:true},newField:1,unknown:'keep'})
 assert.deepEqual(defaults.options,[7]); assert.equal(saved.statusbar.date,undefined)
})
test('manual startup waits for DOM and bootstrap and initializes exactly once',async()=>{
 const gate=deferred();const calls=[];let loaded
 const document={readyState:'loading',body:{textContent:''},addEventListener:(name,fn)=>{assert.equal(name,'DOMContentLoaded');loaded=fn}}
 const window={document,aio:{bootstrap:()=>gate.promise},angular:{bootstrap:(doc,modules)=>{assert.equal(doc,document);assert.deepEqual(modules,['AIO']);assert.equal(window.settings.get('options')[0],20);calls.push('angular')}}}
 const first=startDesktop(window,()=>calls.push('initialize')); const second=startDesktop(window,()=>calls.push('wrong'))
 assert.equal(first,second);gate.resolve(data());await new Promise(setImmediate);assert.deepEqual(calls,[])
 loaded();await first;assert.deepEqual(calls,['initialize','angular'])
})
test('bootstrap failure displays startup text, creates no stores and initializes no controllers',async()=>{
 const window={document:{readyState:'complete',body:{textContent:''}},aio:{bootstrap:async()=>{throw Error('Corrupt preference store aio-data')}},angular:{bootstrap:()=>assert.fail('controllers must not run')}}
 await startDesktop(window,()=>assert.fail('initializer must not run'))
 assert.match(window.document.body.textContent,/MZD-AIO could not start: Corrupt preference store aio-data/)
 assert.equal(window.settings,undefined)
})
test('dependent scripts finish in order before Angular; failed script shows error without controllers',async()=>{
 const appended=[]; const document={readyState:'complete',body:{textContent:''},createElement:()=>({}),head:{appendChild:script=>appended.push(script)}}
 let initialized=0;const window={document,aio:{bootstrap:async()=>data()},angular:{bootstrap:()=>{initialized++}}}
 const startup=startDesktop(window,()=>loadDesktopScripts(window,['first.js','controller.js']))
 await new Promise(setImmediate);assert.equal(appended.length,1);assert.equal(initialized,0);assert.equal(appended[0].src,'first.js')
 appended[0].onload();await new Promise(setImmediate);assert.equal(appended[1].src,'controller.js');assert.equal(initialized,0)
 appended[1].onload();await startup;assert.equal(initialized,1)
 const failed={...window,document:{...document,body:{textContent:''}}};const result=startDesktop(failed,()=>loadDesktopScripts(failed,['failed.js']))
 await new Promise(setImmediate);appended.at(-1).onerror();await result
 assert.equal(initialized,1);assert.match(failed.document.body.textContent,/MZD-AIO could not start:.*failed.js/)
})

test('actual controller waits for saves, surfaces failures, preserves loaded selections and blocks compiler on persistence failure',async()=>{
 const gate=deferred(); const alerts=[];let compiled=0, controller
 const chain={controller:(name,fn)=>{if(name==='MainCtrl')controller=fn;return chain},config:()=>chain,directive:()=>chain,filter:()=>chain}
 const jquery=()=>new Proxy({}, {get:()=>()=>jquery()})
 const context=vm.createContext({console,msgLangs:[],messagesReady:Promise.resolve(),angular:{module:()=>chain},$:jquery,setTimeout:()=>{},uiEvents:{on:()=>{}},aio:{compile:()=>{compiled++},onProgress:()=>()=>{}},document:{createElement:()=>({textContent:''})},bootbox:{alert:value=>alerts.push(value)},closeHelpDrop:()=>{},updateBgModal:()=>{},getParameterByName:()=>'',buildTweakFile:()=>{compiled++},dialog:{showErrorBox:()=>{}},desktopData:{app:{name:'MZD',version:'2.8.6'},paths:{desktop:'/Desktop'}}})
 vm.runInContext(fs.readFileSync('app/assets/js/desktop-client.js','utf8'),context)
 const browser=context.MZDDesktop
 // Objects entering this VM are cloned as Electron IPC would clone them.
 context.initial=JSON.stringify({...data(),preferences:{...data().preferences,'aio-persist':{copyFolderLocation:'/Desktop'}}});context.api={setPreference:()=>gate.promise}
 vm.runInContext('var client=MZDDesktop.createDesktopClient(JSON.parse(initial),api); var settings=client.stores["aio-data"], persistantData=client.stores["aio-persist"], lastView=client.stores["aio-last"],speedoSave=client.stores.MZD_Speedometer; var lang="english",langObj={}; var app={getName:()=>"MZD",getVersion:()=>"2.8.6"}',context)
 for(const name of ['spdValues.js','audioSourceList.js'])vm.runInContext(fs.readFileSync('app/assets/js/'+name,'utf8'),context)
 vm.runInContext(fs.readFileSync('app/controllers/home.js','utf8'),context)
 const scope={$on:()=>{},$watch:()=>{},$apply:()=>{},$applyAsync:()=>{},$evalAsync:()=>{}};controller(scope,{}, {},{path:()=> '/'},()=>x=>x)
 const saving=scope.saveOps();await new Promise(setImmediate);assert.equal(alerts.length,0,'no success before disk acknowledgement')
 gate.resolve();await saving;assert.equal(alerts.at(-1).message,'Options Saved!')
 scope.loadOps();assert.deepEqual(Array.from(scope.user.options),[20]);assert.equal(scope.user.statusbar.opacity,0)
 // A fresh failing queue prevents compile and reports the persistence error.
 context.api.setPreference=async()=>{throw Error('disk full')}
 await scope.compileTweaks();assert.equal(compiled,0);assert.match(String(alerts.at(-1).message?.textContent||alerts.at(-1).message||alerts.at(-1)),/disk full/)
 await scope.saveOps();assert.match(alerts.at(-1).message,/Could not save options: disk full/)
 await scope.miniSave();assert.match(alerts.at(-1).message,/Could not save options: disk full/)
 assert.equal(alerts.filter(alert=>alert.message==='Options Saved!').length,1)
 assert.ok(browser)
})

test('browser script runs without Node globals and client saves round-trip through real service',async t=>{
 const os=require('node:os'), path=require('node:path'), fsp=require('node:fs/promises')
 const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'client-')); t.after(()=>fsp.rm(directory,{recursive:true,force:true}))
 const service=createPreferenceService({directory,resourceDirectory:path.resolve('app'),app:data().app,paths:data().paths})
 const window={};vm.runInNewContext(fs.readFileSync('app/assets/js/desktop-client.js','utf8'),{window,console,URLSearchParams})
 assert.equal(typeof window.MZDDesktop.startDesktop,'function')
 const client=createDesktopClient(await service.bootstrap(),service)
 client.stores['aio-data'].set({options:[20,103],mainOps:[7],statusbar:{clock:false}});await client.flush()
 const reloaded=createDesktopClient(await service.bootstrap(),service)
 assert.deepEqual(reloaded.stores['aio-data'].get('options'),[20,103])
})
