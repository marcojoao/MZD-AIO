'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs')
for (const file of ['translator.js', 'speedoConfig.js']) test(file + ' autosave indicator awaits persistence and reports rejection', async () => {
  let change, resolve, reject, shown = 0
  const alerts = [], nodes = new Map()
  let saving = new Promise((yes, no) => { resolve = yes; reject = no })
  class Editor { constructor() {} on(name, fn) { if (name === 'change') change = fn } validate() { return [] } getValue() { return { fixture: true } } }
  Editor.plugins = { sceditor: {} }
  const jquery = selector => ({ show() { if (selector === '#autosave') shown++; return this }, fadeOut() { return this } })
  vm.runInNewContext(fs.readFileSync('app/assets/js/' + file, 'utf8'), {
    aio: { loadEditor: async () => null, saveEditor: () => saving }, JSONEditor: Editor,
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { style: {}, addEventListener() {} }); return nodes.get(id) } },
    langObj: { translatorWindow: Array.from({ length: 15 }, () => ({ label: 'fixture' })) }, lang: 'english', desktopData: { language: { messages: {} } }, translateSchema: {}, $: jquery, bootbox: { alert: x => alerts.push(x) }
  })
  await new Promise(setImmediate)
  for (let i = 0; i < 3; i++) await change()
  const pending = change()
  assert.equal(shown, 0, 'must not show saved before acknowledgement')
  resolve(); await pending; assert.equal(shown, 1)
  saving = Promise.reject(Error('fixture disk full')); saving.catch(() => {})
  for (let i = 0; i < 4; i++) await change()
  assert.equal(shown, 1); assert.match(alerts.at(-1), /disk full/)
})
