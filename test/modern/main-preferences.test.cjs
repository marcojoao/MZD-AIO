'use strict'
const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os')
const {createRequire}=require('node:module')
test('main composes real preference migration before startup, preserves legacy bytes and registers only preference bridge channels',async t=>{
 const root=await fsp.mkdtemp(path.join(os.tmpdir(),'main-prefs-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}))
 const original='{ "lang": "french", "visits": 3, "untouched": "keep" }\n';await fsp.writeFile(path.join(root,'aio-persist.json'),original)
 const handlers=new Map(),errors=[],events=new Map();let uploads=0,quits=0
 const app={getPath:()=>root,getAppPath:()=>path.resolve('app'),setPath:()=>{},setName:()=>{},getName:()=> 'MZD',requestSingleInstanceLock:()=>true,setAppUserModelId:()=>{},on:(name,fn)=>events.set(name,fn),whenReady:()=>new Promise(()=>{}),quit:()=>{quits++}}
 const local=createRequire(path.resolve('app/main.js'))
 const electron={app,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},nativeImage:{createFromPath:()=>({})},dialog:{showErrorBox:(...args)=>errors.push(args)},crashReporter:{start:()=>{uploads++}}}
 const fakeRequire=name=>{
  if(['./desktop/preferences','./assets/js/desktop-client','./desktop/preferences-ipc','./package.json'].includes(name))return local(name)
  if(name==='electron')return electron
  if(name==='path'||name==='fs')return require(name)
  if(name==='electron-is-dev')return false
  if(name==='lodash')return {merge:Object.assign}
  if(name==='electron-store')return class {constructor(){this.store={}} get(key,fallback){return this.store[key]??fallback}has(key){return key in this.store}set(key,value){this.store[key]=value}}
  if(name==='./config.json')throw Error('No optional config')
  return ()=>{}
 }
 vm.runInNewContext(fs.readFileSync('app/main.js','utf8'),{require:fakeRequire,__dirname:path.resolve('app'),global:{},console:{log:()=>{},warn:()=>{},info:()=>{},debug:()=>{},error:error=>errors.push(error)},process:{on:()=>{},env:{},platform:'darwin',execPath:'/fixture/node'}})
 // Await real asynchronous filesystem bootstrap, not an assumed synchronous handler registration.
 for(let attempt=0;attempt<100&&handlers.size!==3;attempt++)await new Promise(resolve=>setTimeout(resolve,5))
 assert.deepEqual([...handlers.keys()].sort(),['aio:bootstrap','aio:get-preferences','aio:set-preference'])
 assert.equal(uploads,0);assert.deepEqual(errors,[])
 for(let attempt=0;attempt<100;attempt++){
  try {const saved=JSON.parse(await fsp.readFile(path.join(root,'preferences/aio-persist.json'),'utf8'));if(saved['AIO-Ver'])break}catch(error){if(error.code!=='ENOENT')throw error}
  await new Promise(resolve=>setTimeout(resolve,5))
 }
 const saved=JSON.parse(await fsp.readFile(path.join(root,'preferences/aio-persist.json'),'utf8'))
 assert.equal(saved.lang,'french');assert.equal(saved.untouched,'keep');assert.equal(saved['AIO-Ver'],'2.8.6')
 assert.equal(await fsp.readFile(path.join(root,'aio-persist.json'),'utf8'),original)
 let prevented=false
 const quitting=events.get('before-quit')({preventDefault:()=>{prevented=true}})
 assert.equal(prevented,true,'quit must wait for asynchronous writes')
 assert.equal(quits,0)
 await quitting
 assert.equal(quits,1)
 assert.equal(JSON.parse(await fsp.readFile(path.join(root,'preferences/aio-persist.json'),'utf8')).visits,4)
})
