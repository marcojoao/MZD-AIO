'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
test('runtime owns only pinned imported native XML and ZIP dependencies', () => {
  assert.deepEqual(require('../../app/package.json').dependencies, { drivelist: '12.0.2', xml2js: '0.6.2', yauzl: '3.4.0' })
})
test('XML parser and builder preserve message shape and own prototype-named tags', async () => {
  const xml = require('../../app/node_modules/xml2js')
  const source = '<root><Node key="en"><Node value="A &amp; B"/></Node><__proto__><polluted>no</polluted></__proto__></root>'
  const parsed = await xml.parseStringPromise(source)
  assert.equal(parsed.root.Node[0].$.key, 'en')
  assert.equal(parsed.root.Node[0].Node[0].$.value, 'A & B')
  assert.equal(Object.hasOwn(parsed.root, '__proto__'), true)
  assert.equal({}.polluted, undefined)
  const ordinary = await xml.parseStringPromise('<root><Node key="en"><Node value="A &amp; B"/></Node></root>')
  const built = new xml.Builder().buildObject(ordinary)
  assert.deepEqual(await xml.parseStringPromise(built), ordinary)
})
