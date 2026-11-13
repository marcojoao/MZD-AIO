'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm')
const source = file => fs.readFileSync(file, 'utf8')
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function controls(file) {
  return [...source(file).matchAll(/<(?:a|button)\b[^>]*>/g)].filter(x => /onclick=/.test(x[0])).map(x => {
    const attrs = Object.fromEntries([...x[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(x => [x[1], x[2]]))
    return { getAttribute: key => attrs[key], setAttribute: (key, value) => { attrs[key] = value }, removeAttribute: key => { delete attrs[key] } }
  })
}
function eventContext(elements, aio = {}) {
  const context = { window: {}, aio: { onMenuAction() {}, onProgress() {}, onImageStaged() {}, ...aio }, document: { documentElement: {}, querySelectorAll: () => elements }, MutationObserver: class { observe() {} }, bootbox: { alert() { throw Error('Unexpected disabled notice') } } }
  vm.createContext(context); vm.runInContext(source('app/assets/js/events.js'), context); return context
}
test('I1 retained background joiner control normalizes to actual named API', async () => {
  const elements = controls('app/opts/bgoptions.htm'), calls = []
  const button = elements.find(x => x.getAttribute('onclick').includes('open-joiner-window')); assert.ok(button)
  const context = eventContext(elements, { openScreen: async name => calls.push(name) })
  await vm.runInContext(button.getAttribute('onclick'), context)
  assert.deepEqual(calls, ['joiner'])
})

function messageController(aio) {
  const response = defer(), alerts = [], visibility = [], scope = { user: { replyMsgLang: 'en' }, replyMsgs: ['edited'], $evalAsync() { this.digests = (this.digests || 0) + 1 } }
  const c = { aio: { loadMessages: () => response.promise, ...aio }, bootbox: { alert: error => alerts.push(error) }, $scope: scope, $: () => ({ show() {}, fadeOut: () => visibility.push('hidden') }) }
  vm.createContext(c); vm.runInContext(source('app/assets/js/messages-settings.js'), c)
  const controller = source('app/controllers/home.js'); vm.runInContext(controller.slice(controller.indexOf('      $scope.replyLangs ='), controller.indexOf('      $scope.checkDuplicatePos =')), c)
  return { c, scope, response, alerts, visibility }
}
const messageData = () => ({ Node: { Node: [{ Node: [{ $: { key: 'en' }, Node: [{ $: { value: 'default' } }] }] }] } })
test('I2 delayed message response populates real controller binding and schedules Angular digest', async () => {
  const f = messageController(), original = f.scope.replyLangs
  assert.equal(original.length, 0)
  f.response.resolve(messageData()); await f.response.promise; await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(Array.from(f.scope.replyLangs), ['en'])
  assert.equal(f.scope.replyLangs, original); assert.ok(f.scope.digests > 0)
})

test("M1 immutable message controls never hide the editor synchronously", () => {
  const elements = controls("app/opts/11options.htm"), save = elements.find(x => x.getAttribute("ng-click") === "savePresetMsgs()"), reset = elements.find(x => x.getAttribute("onclick").includes("resetMsgLang"))
  eventContext(elements)
  assert.equal(save.getAttribute("onclick"), undefined)
  assert.equal(reset.getAttribute("onclick"), "resetMsgLang()")
})
for (const action of ["save", "reset"]) test("M1 " + action + " awaits persistence and displays rejection without hiding", async () => {
  const pending = defer(), f = messageController({ saveMessages: () => pending.promise, resetMessages: () => pending.promise })
  f.response.resolve(messageData()); await new Promise(resolve => setImmediate(resolve))
  const invoke = () => action === "save" ? f.scope.savePresetMsgs() : f.c.resetMsgLang()
  const result = invoke()
  assert.equal(typeof result?.then, "function", "caller must return awaitable completion")
  assert.deepEqual(f.visibility, [])
  pending.reject(Error("disk full")); await result
  assert.deepEqual(f.visibility, []); assert.match(JSON.stringify(f.alerts), /disk full/)
  f.c.aio.saveMessages = async () => {}; f.c.aio.resetMessages = async () => messageData()
  await invoke(); assert.deepEqual(f.visibility, ["hidden"])
})
