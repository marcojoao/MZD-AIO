'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { assertArm64, compareInventory, assertCleanEntries, verifyPackage } = require('../../scripts/verify-package.cjs')
test('package architecture rejects x64, non-Mach-O and truncated executables', () => {
  const arm = Buffer.alloc(32); arm.writeUInt32LE(0xfeedfacf); arm.writeUInt32LE(0x100000c, 4)
  assert.doesNotThrow(() => assertArm64(arm))
  const x64 = Buffer.from(arm); x64.writeUInt32LE(0x1000007, 4)
  for (const bytes of [x64, Buffer.alloc(32), arm.subarray(0, 7)]) assert.throws(() => assertArm64(bytes), /arm64/)
})
test('package protected inventory detects changed, missing and extra payload bytes', () => {
  assert.doesNotThrow(() => compareInventory({ a: 'abc' }, { a: 'abc' }))
  for (const actual of [{}, { a: 'bad' }, { a: 'abc', secret: 'extra' }]) assert.throws(() => compareInventory({ a: 'abc' }, actual), /inventory/)
})
test('package rejects evidence, credentials and test-private files', () => {
  assert.doesNotThrow(() => assertCleanEntries(['main.js', 'desktop/hidden-smoke.js', 'node_modules/xml2js/lib/parser.js']))
  for (const name of ['.env', '.git/config', 'evidence/log.json', '.superpowers/private', 'test/fixtures/a', 'preferences/aio-data.json', 'id_rsa', 'home/.npmrc']) assert.throws(() => assertCleanEntries([name]), /contamination/)
})
