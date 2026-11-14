'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { read } = require('./compiler-fs')
// Never use an archive library's path-based writer. Every leaf is created via
// the same no-follow stage writer used for all compilation output.
async function unzip (source, destination, io) {
  const yauzl = require('yauzl')
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(read(source), { lazyEntries: true }, (e, z) => e ? reject(e) : resolve(z)))
  let total = 0, count = 0
  await new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error) }
    zip.on('error', fail); zip.on('end', resolve)
    zip.on('entry', entry => {
      const name = entry.fileName, mode = (entry.externalFileAttributes >>> 16) & 0xf000
      if (!name || name.includes('\\') || name.includes('\0') || path.isAbsolute(name) || name.split('/').includes('..') || /^[a-z]:/i.test(name) || mode === 0xa000 || ++count > 30000 || (total += entry.uncompressedSize) > 2 * 1024 ** 3) return fail(Error('Unsafe ZIP entry'))
      const target = path.join(destination, name)
      if (name.endsWith('/')) { try { io.mkdir(target); zip.readEntry() } catch (e) { fail(e) }; return }
      zip.openReadStream(entry, (error, stream) => {
        if (error) return fail(error)
        let fd, written = 0
        try { fd = io.open(target) } catch (e) { stream.destroy(); return fail(e) }
        const close = () => { if (fd !== undefined) { fs.closeSync(fd); fd = undefined } }
        stream.on('error', e => { close(); fail(e) })
        stream.on('data', data => {
          try { io.check(target); written += data.length; if (written > entry.uncompressedSize) throw Error('Invalid ZIP size'); fs.writeFileSync(fd, data) } catch (e) {
            // yauzl 2.x overrides destroy() and ignores its error argument.
            // Reject explicitly; waiting for an error event leaves compile busy forever.
            close(); stream.destroy(); fail(e)
          }
        })
        stream.on('end', () => { close(); if (written !== entry.uncompressedSize) return fail(Error('Invalid ZIP size')); zip.readEntry() })
      })
    })
    zip.readEntry()
  })
}
module.exports = { unzip }
