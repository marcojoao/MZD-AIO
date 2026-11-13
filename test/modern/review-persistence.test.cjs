'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os')
const { createExtraMethods } = require('../../app/desktop/extra-methods')
const xml = require('node:module').createRequire(path.resolve('app/main.js'))('xml2js')
const leaf = 'blm_msg-system.xml'
const value = data => data.Node.Node[0].Node[0].Node[0].$.value
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function heldMethods(root, messages) {
  const vm = require('node:vm'), native = require('../../app/desktop/native-adapters'), local = require('node:module').createRequire(path.resolve('app/desktop/extra-methods.js'))
  const started = defer(), gate = defer(), entries = [], module = { exports: {} }
  const defaults = messages && new xml.Builder().buildObject(messages)
  let current = defaults
  const readRegular = async file => messages && file.endsWith(leaf) ? Buffer.from(file.startsWith(root) ? current : defaults) : native.readRegular(file)
  const writeAtomic = async (...args) => { entries.push(args[1]); if (entries.length === 1) { started.resolve(); await gate.promise } await native.writeAtomic(...args); if (messages && args[1] === leaf) current = args[2]; }
  vm.runInNewContext(require('node:fs').readFileSync('app/desktop/extra-methods.js', 'utf8'), { module, JSON, require: name => name === './native-adapters' ? { ...native, readRegular, writeAtomic } : local(name) })
  const methods = module.exports.createExtraMethods({ electron: {}, preferences: {}, userData: root, resources: path.resolve('app') })
  return { run: (name, ...args) => methods[name].run({}, ...args), started, gate, entries, methods }
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-persist-')); t.after(() => fs.rm(root, { recursive: true, force: true }))
  const methods = createExtraMethods({ electron: {}, preferences: {}, userData: root, resources: path.resolve('app') })
  const run = (name, ...args) => methods[name].run({}, ...args)
  const defaults = await run('messages-load'), legacy = structuredClone(defaults)
  legacy.Node.Node[0].Node[0].Node[0].$.value = 'legacy edit'
  const legacyFile = path.join(root, 'background/message_replies/jci/settings/configurations', leaf)
  await fs.mkdir(path.dirname(legacyFile), { recursive: true }); const original = new xml.Builder().buildObject(legacy); await fs.writeFile(legacyFile, original)
  return { root, run, defaults, original, legacyFile }
}
test('I3 current then read-only legacy then default message precedence; reset cannot resurrect legacy', async t => {
  const f = await fixture(t)
  assert.equal(value(await f.run('messages-load')), 'legacy edit')
  const nodes = f.defaults.Node.Node[0].Node[0], messages = nodes.Node.map(x => x.$.value); messages[0] = 'current edit'
  await f.run('messages-save', nodes.$.key, messages)
  assert.equal(value(await f.run('messages-load')), 'current edit')
  assert.equal(await fs.readFile(f.legacyFile, 'utf8'), f.original)
  assert.deepEqual(await f.run('messages-reset'), f.defaults)
  assert.deepEqual(await f.run('messages-load'), f.defaults)
  assert.equal(await fs.readFile(f.legacyFile, 'utf8'), f.original)
})

test("I5 editor writes serialize per target while independent editors proceed", async t => {
  const f = await fixture(t), h = heldMethods(f.root)
  const first = h.run("editor-save", "translator", { version: "old" }); await h.started.promise
  const second = h.run("editor-save", "translator", { version: "new" })
  await h.run("editor-save", "speedo", { independent: true })
  let entries
  try { entries = [...h.entries] } finally { h.gate.resolve(); await Promise.all([first, second]) }
  assert.deepEqual(entries, ["aio-translate-save.json", "speedo-config.json"])
  assert.equal((await h.run("editor-load", "translator")).version, "new")
})

for (const scenario of ["languages", "save-reset", "reset-save"]) test("I5 XML request ordering: " + scenario, async t => {
  const f = await fixture(t), h = heldMethods(f.root, f.defaults)
  const nodes = f.defaults.Node.Node[0].Node
  const save = (i, text) => { const messages = nodes[i].Node.map(x => x.$.value); messages[0] = text; return h.run("messages-save", nodes[i].$.key, messages) }
  const first = scenario === "reset-save" ? h.run("messages-reset") : save(0, "older")
  await h.started.promise
  const second = scenario === "save-reset" ? h.run("messages-reset") : save(scenario === "languages" ? 1 : 0, "newer")
  await new Promise(resolve => setImmediate(resolve))
  const entries = [...h.entries]; h.gate.resolve(); await Promise.all([first, second])
  assert.equal(entries.length, 1, "later XML mutation must not start while prior write is held")
  const result = (await h.run("messages-load")).Node.Node[0].Node
  assert.equal(result[0].Node[0].$.value, scenario === "languages" ? "older" : scenario === "reset-save" ? "newer" : nodes[0].Node[0].$.value)
  if (scenario === "languages") assert.equal(result[1].Node[0].$.value, "newer")
})

test("I5 queued editor failure rejects caller and close drain without poisoning later requests", async t => {
  const f = await fixture(t), h = heldMethods(f.root), handlers = new Map()
  const wc = { mainFrame: { url: "file:///fixture/index.html" } }
  const drain = require("../../app/desktop/scoped-ipc").registerScopedIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, methods: h.methods, scopes: [{ getWebContents: () => wc, indexPath: "/fixture/index.html", capabilities: ["editor-save"] }] })
  const send = value => handlers.get("aio:editor-save")({ sender: wc, senderFrame: wc.mainFrame }, "translator", { value })
  const first = send("failed"); await h.started.promise
  const second = send("recovered")
  const failed = assert.rejects(first, /disk full/), drained = assert.rejects(drain(), /disk full/)
  h.gate.reject(Error("disk full")); await failed; await drained; await second; await drain()
  assert.equal((await h.run("editor-load", "translator")).value, "recovered")
})
