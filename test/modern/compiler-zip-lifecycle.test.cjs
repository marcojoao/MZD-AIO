'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const yauzl = require('../../app/node_modules/yauzl')
const { unzip } = require('../../app/desktop/compiler-zip')
const { stageWriter } = require('../../app/desktop/compiler-fs')
const zipPath = path.resolve(__dirname, '../../app/files/tweaks/config/themes/SmoothRed.zip')
for (const fault of ['none', 'read', 'open', 'stream', 'write', 'close', 'archive-close']) {
  test('real yauzl extraction lifecycle: ' + fault, { timeout: 2000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-lifecycle-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const io = stageWriter(root)
    const fromBuffer = yauzl.fromBuffer, closeSync = fs.closeSync
    let zip, descriptor, closed = false
    const open = io.open
    io.open = file => { descriptor = open(file); return descriptor }
    if (fault === 'write') io.check = () => { throw Error('injected write') }
    if (fault === 'close') fs.closeSync = fd => { closeSync(fd); if (fd === descriptor) throw Error('injected close') }
    yauzl.fromBuffer = (bytes, options, callback) => fromBuffer(bytes, options, (error, actual) => {
      if (error) return callback(error)
      zip = actual
      const close = zip.close.bind(zip)
      zip.close = () => { closed = true; close(); if (fault === 'archive-close') throw Error('injected archive-close') }
      if (fault === 'read') zip.readEntry = () => { throw Error('injected read') }
      const openReadStream = zip.openReadStream.bind(zip)
      zip.openReadStream = (entry, done) => {
        if (fault === 'open') return done(Error('injected open'))
        openReadStream(entry, (e, stream) => {
          done(e, stream)
          if (!e && fault === 'stream') stream.destroy(Error('injected stream'))
        })
      }
      callback(null, zip)
    })
    let timer
    try {
      const result = Promise.race([unzip(zipPath, root, io), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('lifecycle timed out')), 1000) })])
      if (fault === 'none') { await result; assert.ok(fs.readdirSync(root).length > 0) } else await assert.rejects(result, new RegExp('injected ' + fault))
      assert.equal(closed, true, 'archive closed on every outcome')
      assert.equal(zip.isOpen, false)
      if (descriptor !== undefined) assert.throws(() => fs.fstatSync(descriptor), /bad file descriptor|EBADF/)
    } finally { clearTimeout(timer); yauzl.fromBuffer = fromBuffer; fs.closeSync = closeSync; if (zip && zip.isOpen) zip.close() }
  })
}
