'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
function assertArm64 (bytes) {
  assert.ok(bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x100000c, 'Expected native arm64 Mach-O')
}
function compareInventory (expected, actual) {
  assert.deepEqual(Object.entries(actual).sort(), Object.entries(expected).sort(), 'Protected payload inventory mismatch')
}
function assertCleanEntries (entries) {
  for (const name of entries) assert.ok(!/(^|\/)(\.git|\.superpowers|evidence|test|tests|preferences|test-user-data|test-output|\.env(?:\..*)?|\.npmrc|id_rsa|id_ed25519)(\/|$)/.test(name), 'Package contamination: ' + name)
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function diskInventory (root) {
  const result = {}
  function walk (dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), relative = prefix + name, stat = fs.lstatSync(file)
      assert.ok(!stat.isSymbolicLink(), 'Unexpected resource symlink: ' + file)
      if (stat.isDirectory()) walk(file, relative + '/')
      else { assert.ok(stat.isFile()); result[relative] = sha(fs.readFileSync(file)) }
    }
  }
  walk(root); return result
}
async function verifyPackage (bundle, source = path.resolve(__dirname, '..')) {
  bundle = path.resolve(bundle)
  const { listPackage, extractFile, statFile, uncache } = await import('@electron/asar')
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }))
  const config = JSON.parse(fs.readFileSync(path.join(source, 'package.json')))
  assert.equal(plist.CFBundleIdentifier, config.build.appId)
  assert.equal(plist.CFBundleShortVersionString, config.version)
  assert.match(plist.CFBundleName, /Modernization/)
  const executable = path.join(bundle, 'Contents/MacOS', plist.CFBundleExecutable)
  assertArm64(fs.readFileSync(executable))
  const resources = path.join(bundle, 'Contents/Resources'), archive = path.join(resources, 'app.asar')
  // Each invocation inspects current bytes, never a prior archive header cache.
  uncache(archive)
  const entries = listPackage(archive).map(name => name.replace(/^\//, ''))
  assertCleanEntries(entries)
  const metadata = JSON.parse(extractFile(archive, 'package.json'))
  assert.equal(metadata.version, config.version); assert.equal(metadata.main, 'main.js')
  for (const name of ['main.js', 'preload.js', 'index.html', 'views/joiner.html', 'views/info.html', 'desktop/compiler.js', 'lang/english.aio.json']) assert.ok(entries.includes(name), 'Missing app resource ' + name)
  const native = 'node_modules/drivelist/build/Release/drivelist.node'
  assert.equal(JSON.parse(extractFile(archive, 'node_modules/drivelist/package.json')).version, '12.0.2')
  assert.equal(statFile(archive, native).unpacked, true)
  const binding = path.join(resources, 'app.asar.unpacked', native)
  assertArm64(fs.readFileSync(binding))
  // Requiring the binding under packaged Electron is the ABI gate, not this static check.
  const payloads = {}
  for (const name of ['files', 'opts']) {
    const expected = diskInventory(path.join(source, 'app', name)), actual = {}
    for (const entry of entries.filter(e => e.startsWith(name + '/') && !statFile(archive, e).files)) actual[entry.slice(name.length + 1)] = sha(extractFile(archive, entry))
    compareInventory(expected, actual); payloads['app/' + name] = actual
  }
  for (const name of ['background', 'background-images', 'castscreenApp']) {
    const actual = diskInventory(path.join(resources, name)); assertCleanEntries(Object.keys(actual))
    compareInventory(diskInventory(path.join(source, name)), actual); payloads[name] = actual
  }
  const result = { bundle, executable, architecture: 'arm64', version: metadata.version, executableSha256: sha(fs.readFileSync(executable)), archiveSha256: sha(fs.readFileSync(archive)), nativeBinding: binding, nativeSha256: sha(fs.readFileSync(binding)), abi: 'Requires packaged hidden smoke native load', archiveEntries: entries.length, payloads }
  return result
}
module.exports = { assertArm64, compareInventory, assertCleanEntries, diskInventory, verifyPackage }
if (require.main === module) verifyPackage(process.argv[2]).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1 })
