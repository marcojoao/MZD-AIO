'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { read, inventory } = require('./compiler-fs')
const sentinel = '.mzd-aio-owned.json'
function hashFile (name) {
  const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    if (!fs.fstatSync(fd).isFile()) throw Error('Unsafe manifest file')
    const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}
function manifest (dir) {
  const files = inventory(dir).filter(x => x !== sentinel)
  const directories = []
  function walk (directory, prefix) { for (const name of fs.readdirSync(directory).sort()) { if (fs.lstatSync(path.join(directory, name)).isDirectory()) { const rel = prefix + name; directories.push(rel); walk(path.join(directory, name), rel + '/') } } }
  walk(dir, '')
  return { format: 'mzd-aio-generated-v1', directories, files: Object.fromEntries(files.map(name => [name, hashFile(path.join(dir, name))])) }
}
function verifyOwned (dir) {
  if (!fs.existsSync(dir)) return false
  try {
    const saved = JSON.parse(read(path.join(dir, sentinel)))
    if (JSON.stringify(saved) !== JSON.stringify(manifest(dir))) throw Error('Changed package')
  } catch (cause) { throw Error('Refusing unowned or modified _copy_to_usb output; choose an empty parent or move the old directory first.', { cause }) }
  return true
}
module.exports = { manifest, verifyOwned, sentinel }
