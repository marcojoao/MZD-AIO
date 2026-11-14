'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { read } = require('./compiler-fs')
// Never use an archive library's path-based writer. Every leaf is created via
// the same no-follow stage writer used for all compilation output.
async function unzip (source, destination, io) {
  const yauzl = require('yauzl')
  // fromBuffer owns no OS descriptor and forces autoClose:false in yauzl 3.4.
  const zip = await new Promise((resolve, reject) => yauzl.fromBuffer(read(source), { lazyEntries: true }, (e, z) => e ? reject(e) : resolve(z)))
  let total = 0, count = 0
  await new Promise((resolve, reject) => {
    let settled = false, active, fd
    const closeFile = () => { if (fd !== undefined) { const owned = fd; fd = undefined; fs.closeSync(owned) } }
    const finish = error => {
      if (settled) return
      settled = true
      // Settle explicitly, not via destroy(error) event timing. Preserve the
      // original read/write failure if cleanup also fails.
      try { if (active) active.destroy() } catch (e) { error = error || e }
      try { closeFile() } catch (e) { error = error || e }
      try { zip.close() } catch (e) { error = error || e }
      if (error) reject(error); else resolve()
    }
    const next = () => { if (!settled) { try { zip.readEntry() } catch (e) { finish(e) } } }
    zip.on('error', finish); zip.on('end', () => finish())
    zip.on('entry', entry => {
      if (settled) return
      const name = entry.fileName, mode = (entry.externalFileAttributes >>> 16) & 0xf000
      if (!name || name.includes('\\') || name.includes('\0') || path.isAbsolute(name) || name.split('/').includes('..') || /^[a-z]:/i.test(name) || mode === 0xa000 || ++count > 30000 || (total += entry.uncompressedSize) > 2 * 1024 ** 3) return finish(Error('Unsafe ZIP entry'))
      const target = path.join(destination, name)
      if (name.endsWith('/')) { try { io.mkdir(target); next() } catch (e) { finish(e) }; return }
      try {
        zip.openReadStream(entry, (error, stream) => {
          if (error) return finish(error)
          if (settled) { stream.destroy(); return }
          active = stream
          stream.on('error', finish)
          let written = 0
          try { fd = io.open(target) } catch (e) { return finish(e) }
          stream.on('data', data => {
            if (settled) return
            try { io.check(target); written += data.length; if (written > entry.uncompressedSize) throw Error('Invalid ZIP size'); fs.writeFileSync(fd, data) } catch (e) { finish(e) }
          })
          stream.on('end', () => {
            if (settled) return
            try {
              closeFile(); active = undefined
              if (written !== entry.uncompressedSize) throw Error('Invalid ZIP size')
              next()
            } catch (e) { finish(e) }
          })
        })
      } catch (e) { finish(e) }
    })
    next()
  })
}
module.exports = { unzip }
