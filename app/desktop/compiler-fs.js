'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { constants: C } = fs

function parents (name) {
  let current = path.parse(path.resolve(name)).root
  for (const part of path.resolve(name).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const st = fs.lstatSync(current)
    if (st.isSymbolicLink()) throw Error('Unsafe symbolic link: ' + current)
  }
}
function read (name) {
  parents(path.dirname(name))
  const fd = fs.openSync(name, C.O_RDONLY | C.O_NOFOLLOW)
  try { if (!fs.fstatSync(fd).isFile()) throw Error('Not a regular resource: ' + name); return fs.readFileSync(fd) } finally { fs.closeSync(fd) }
}
function inventory (directory) {
  parents(directory)
  const result = []
  function walk (dir, prefix) {
    for (const entry of fs.readdirSync(dir).sort()) {
      const name = path.join(dir, entry), relative = prefix + entry
      const st = fs.lstatSync(name)
      if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) throw Error('Unsafe package entry: ' + relative)
      if (st.isDirectory()) walk(name, relative + '/')
      else result.push(relative)
    }
  }
  walk(directory, '')
  return result
}
function stageWriter (root, beforeCopy = () => {}) {
  const identity = fs.lstatSync(root)
  function target (name) {
    name = path.resolve(name)
    if (name !== root && !name.startsWith(root + path.sep)) throw Error('Write outside compilation stage')
    parents(root)
    const now = fs.lstatSync(root)
    if (now.ino !== identity.ino || now.dev !== identity.dev || !now.isDirectory()) throw Error('Compilation stage replaced')
    return name
  }
  function mkdir (name) {
    name = target(name)
    let current = root
    for (const part of path.relative(root, name).split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      try { fs.mkdirSync(current) } catch (e) { if (e.code !== 'EEXIST') throw e }
      const st = fs.lstatSync(current)
      if (st.isSymbolicLink() || !st.isDirectory()) throw Error('Unsafe output descendant')
    }
  }
  function write (name, bytes) {
    name = target(name); mkdir(path.dirname(name)); parents(path.dirname(name))
    const fd = fs.openSync(name, C.O_WRONLY | C.O_CREAT | C.O_TRUNC | C.O_NOFOLLOW, 0o600)
    try { if (!fs.fstatSync(fd).isFile()) throw Error('Unsafe output file'); fs.writeFileSync(fd, bytes) } finally { fs.closeSync(fd) }
  }
  function copy (source, destination, filter = () => true) {
    beforeCopy(source, destination)
    target(destination); parents(source)
    const st = fs.lstatSync(source)
    if (st.isDirectory()) {
      if (!filter('directory', source, path.basename(source))) return
      mkdir(destination)
      for (const name of fs.readdirSync(source).sort()) copy(path.join(source, name), path.join(destination, name), filter)
    } else {
      if (!st.isFile()) throw Error('Unsafe source file')
      if (filter('file', source, path.basename(source))) write(destination, read(source))
    }
  }
  function remove (name) {
    name = target(name)
    if (name === root) throw Error('Cannot remove stage root')
    parents(path.dirname(name))
    try {
      const st = fs.lstatSync(name)
      if (st.isSymbolicLink()) throw Error('Unsafe removal descendant')
      if (st.isDirectory()) { for (const child of fs.readdirSync(name)) remove(path.join(name, child)); fs.rmdirSync(name) } else fs.unlinkSync(name)
    } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  function open (name) {
    name = target(name); mkdir(path.dirname(name)); parents(path.dirname(name))
    return fs.openSync(name, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600)
  }
  return { mkdir, write, copy, remove, open, check: target }
}
module.exports = { read, inventory, stageWriter, parents }
