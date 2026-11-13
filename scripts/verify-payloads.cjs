'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

const BASELINE = '409c724ed860497b2a34f9367cb4a019287846ea'
const ROOTS = ['app/files', 'app/opts', 'background', 'background-images', 'castscreenApp']
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function verifyPayloads(root, baseline = BASELINE) {
  root = path.resolve(root)
  // Resolve refs before passing them to ls-tree. No shell, network, hooks or index writes.
  const git = (args, options = {}) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
    maxBuffer: 512 * 1024 * 1024, ...options
  })
  const commit = git(['rev-parse', '--verify', '--end-of-options', baseline + '^{commit}'], { encoding: 'utf8' }).trim()
  const tree = git(['ls-tree', '-rz', commit, '--', ...ROOTS]).toString('utf8')
  const entries = tree.split('\0').filter(Boolean).map(record => {
    const tab = record.indexOf('\t')
    const [mode, type, oid] = record.slice(0, tab).split(' ')
    if (type !== 'blob') throw new Error('Unsupported payload object: ' + record)
    return { mode, oid, name: record.slice(tab + 1) }
  })
  if (!entries.length) throw new Error('Baseline contains no payload files')
  const blobs = git(['cat-file', '--batch'], { input: entries.map(entry => entry.oid + '\n').join('') })
  let offset = 0
  for (const entry of entries) {
    const end = blobs.indexOf(10, offset)
    const [oid, type, length] = blobs.subarray(offset, end).toString('ascii').split(' ')
    const size = Number(length)
    if (oid !== entry.oid || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) {
      throw new Error('Invalid git cat-file response')
    }
    offset = end + 1
    entry.hash = sha256(blobs.subarray(offset, offset + size))
    offset += size + 1
  }
  const actual = new Map()
  function walk(name) {
    const absolute = path.join(root, name)
    let stat
    try { stat = fs.lstatSync(absolute) } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort()) walk(name + '/' + child)
    } else {
      actual.set(name, stat)
    }
  }
  // Check each component so a replaced app/ directory cannot redirect traversal.
  for (const name of ROOTS) {
    const parent = path.dirname(name)
    if (parent !== '.') {
      try {
        const stat = fs.lstatSync(path.join(root, parent))
        if (!stat.isDirectory()) { actual.set(parent, stat); continue }
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
    }
    walk(name)
  }
  const result = { baseline: commit, checked: entries.length, missing: [], changed: [], added: [] }
  for (const entry of entries) {
    const stat = actual.get(entry.name)
    if (!stat) { result.missing.push(entry.name); continue }
    const symlink = entry.mode === '120000'
    if ((symlink && !stat.isSymbolicLink()) || (!symlink && !stat.isFile())) {
      result.changed.push(entry.name)
    } else {
      const absolute = path.join(root, entry.name)
      const bytes = symlink ? fs.readlinkSync(absolute, { encoding: 'buffer' }) : fs.readFileSync(absolute)
      if (sha256(bytes) !== entry.hash) result.changed.push(entry.name)
    }
    actual.delete(entry.name)
  }
  result.missing.sort()
  result.changed.sort()
  result.added = [...actual.keys()].sort()
  return result
}

if (require.main === module) {
  try {
    const result = verifyPayloads(process.argv[2] || path.resolve(__dirname, '..'), process.argv[3] || BASELINE)
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.missing.length || result.changed.length || result.added.length ? 1 : 0
  } catch (error) {
    console.error('Payload verification failed:', error.message)
    process.exitCode = 1
  }
}
module.exports = { verifyPayloads }
