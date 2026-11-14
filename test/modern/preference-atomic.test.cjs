'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createPreferenceService } = require('../../app/desktop/preferences')
for (const operation of ['writeFile', 'sync', 'rename']) test('preference atomic ' + operation + ' failure preserves bytes, cleans temp and recovers', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aio-pref-fault-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const service = createPreferenceService({ directory })
  await service.setPreference('aio-persist', 'value', 'old')
  const target = path.join(directory, 'aio-persist.json'), before = await fs.readFile(target)
  const originalOpen = fs.open, originalRename = fs.rename
  let reached = false
  if (operation === 'rename') fs.rename = async (...args) => { reached = true; throw Error('injected rename') }
  else fs.open = async (...args) => {
    const handle = await originalOpen(...args)
    if (String(args[0]).endsWith('.tmp')) handle[operation] = async () => { reached = true; throw Error('injected ' + operation) }
    return handle
  }
  try { await assert.rejects(service.setPreference('aio-persist', 'value', 'new'), new RegExp('injected ' + operation)) } finally { fs.open = originalOpen; fs.rename = originalRename }
  assert.equal(reached, true)
  assert.deepEqual(await fs.readFile(target), before)
  assert.deepEqual(await fs.readdir(directory), ['aio-persist.json'])
  await service.setPreference('aio-persist', 'value', 'recovered')
  assert.equal((await service.getPreferences('aio-persist')).value, 'recovered')
})
