'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')

test('sandbox scrubs credentials and denies credential reads', () => {
  assert.equal(process.env.GH_TOKEN, undefined)
  assert.equal(process.env.SSH_AUTH_SOCK, undefined)
  assert.throws(() => fs.readFileSync(process.argv[2]), { code: 'EPERM' })
})
test('sandbox denies writes outside scratch but permits scratch', () => {
  assert.throws(() => fs.writeFileSync('/private/tmp/mzd-aio-denied-probe', 'no'), { code: 'EPERM' })
  const file = path.join(process.env.TMPDIR, 'probe')
  fs.writeFileSync(file, 'yes')
  assert.equal(fs.readFileSync(file, 'utf8'), 'yes')
  fs.unlinkSync(file)
})
test('sandbox denies external network', async () => {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 })
    socket.once('connect', () => { socket.destroy(); reject(new Error('External connection escaped sandbox')) })
    socket.once('error', error => {
      try { assert.equal(error.code, 'EPERM'); resolve() } catch (failure) { reject(failure) }
    })
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Expected policy denial, not timeout')) })
  })
})
