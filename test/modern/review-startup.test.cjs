'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module'), { EventEmitter } = require('node:events')
function boot({ owned, hidden = false }) {
  const effects = [], app = new EventEmitter(), local = createRequire(path.resolve('app/main.js'))
  Object.assign(app, { requestSingleInstanceLock() { effects.push('lock'); return owned }, getPath() { return '/never-used' }, quit() { effects.push('quit') }, whenReady() { effects.push('ready'); return { then() { return { catch() {} } } } }, setPath() {}, dock: { hide() {} } })
  const c = { require: name => name === 'electron' ? { app, BrowserWindow: class { constructor() { effects.push('window') } } } : name === 'node:fs/promises' ? { mkdir() { effects.push('write') } } : local(name), __dirname: path.resolve('app'), console: { log() {}, error() {} }, process: { env: hidden ? { MZD_AIO_TEST: '1', MZD_AIO_TEST_USER_DATA: '/isolated', MZD_AIO_TEST_OUTPUT: '/output' } : {}, on() {} } }
  vm.createContext(c); vm.runInContext(fs.readFileSync('app/main.js', 'utf8'), c)
  return { c, effects, app }
}
test('I4 losing production instance quits before readiness, preference writes or windows', () => {
  const f = boot({ owned: false }); assert.deepEqual(f.effects, ['lock', 'quit'])
  assert.equal(f.app.listenerCount('second-instance'), 0)
})
test('I4 owned production instance restores and focuses only an existing window; hidden never does', () => {
  for (const hidden of [false, true]) {
    const f = boot({ owned: true, hidden }), calls = []
    assert.deepEqual(f.effects, hidden ? ['ready'] : ['lock', 'ready'])
    f.app.emit('second-instance')
    f.c.fixtureWindow = { isMinimized: () => true, restore: () => calls.push('restore'), focus: () => calls.push('focus') }
    vm.runInContext('primary = fixtureWindow', f.c); f.app.emit('second-instance')
    assert.deepEqual(calls, hidden ? [] : ['restore', 'focus'])
  }
})
