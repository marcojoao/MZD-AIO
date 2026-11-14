'use strict'
// Synthetic, tiny static-verifier fixture. Never used as packaging/runtime proof.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { verifyPackage } = require('../../scripts/verify-package.cjs')
test('complete ASAR verifier rejects resource, native, metadata and contamination mutations', async t => {
  const { createPackageWithOptions } = await import('@electron/asar')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aio-package-fixture-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source'), app = path.join(root, 'input')
  const bundle = path.join(root, 'fixture.app'), resources = path.join(bundle, 'Contents/Resources')
  const put = (name, bytes) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, bytes) }
  const arm = Buffer.alloc(32); arm.writeUInt32LE(0xfeedfacf); arm.writeUInt32LE(0x100000c, 4)
  put(path.join(source, 'package.json'), JSON.stringify({ version: '2.8.6', build: { appId: 'test.modernization' } }))
  const metadata = { CFBundleIdentifier: 'test.modernization', CFBundleShortVersionString: '2.8.6', CFBundleName: 'MZD-AIO Modernization', CFBundleExecutable: 'fixture' }
  const plist = path.join(bundle, 'Contents/Info.plist')
  put(plist, JSON.stringify(metadata)); put(path.join(bundle, 'Contents/MacOS/fixture'), arm)
  for (const name of ['background', 'background-images', 'castscreenApp']) {
    put(path.join(source, name, 'payload'), 'protected'); put(path.join(resources, name, 'payload'), 'protected')
  }
  for (const name of ['files', 'opts']) { put(path.join(source, 'app', name, 'payload'), 'protected'); put(path.join(app, name, 'payload'), 'protected') }
  for (const name of ['main.js', 'preload.js', 'index.html', 'views/joiner.html', 'views/info.html', 'desktop/compiler.js', 'lang/english.aio.json']) put(path.join(app, name), 'fixture')
  put(path.join(app, 'package.json'), JSON.stringify({ version: '2.8.6', main: 'main.js' }))
  put(path.join(app, 'node_modules/drivelist/package.json'), JSON.stringify({ version: '12.0.2' }))
  const native = 'node_modules/drivelist/build/Release/drivelist.node'
  put(path.join(app, native), arm)
  const pack = async () => {
    const stream = await createPackageWithOptions(app, path.join(resources, 'app.asar'), { unpack: '*.node' })
    await require('node:stream/promises').finished(stream)
  }
  await pack(); assert.equal((await verifyPackage(bundle, source)).architecture, 'arm64')
  // Physical bundle policy must reject contamination outside logical ASAR too.
  for (const name of ['.env', 'test-user-data/preferences.json', 'app.asar.unpacked/evidence/private.json', 'app.asar.unpacked/neutral.bin']) {
    await t.test('reject physical ' + name, async () => {
      const file = path.join(resources, name)
      put(file, 'fixture-not-private')
      try { await assert.rejects(verifyPackage(bundle, source), /contamination|Unreferenced unpacked/) } finally {
        fs.unlinkSync(file)
        if (name.startsWith('test-user-data/')) fs.rmdirSync(path.join(resources, 'test-user-data'))
        if (name.includes('/evidence/')) fs.rmdirSync(path.join(resources, 'app.asar.unpacked/evidence'))
      }
    })
  }
  // Preserve real framework aliases but never recurse into directory links.
  const framework = path.join(bundle, 'Contents/Frameworks/Fixture.framework')
  put(path.join(framework, 'Versions/A/Fixture'), arm)
  fs.symlinkSync('A', path.join(framework, 'Versions/Current'))
  fs.symlinkSync('Versions/Current/Fixture', path.join(framework, 'Fixture'))
  assert.equal((await verifyPackage(bundle, source)).architecture, 'arm64')
  const external = path.join(root, 'external'), link = path.join(resources, 'outside')
  put(path.join(external, '.env'), 'do-not-read')
  fs.symlinkSync(external, link)
  const readdir = fs.readdirSync
  let externalReads = 0
  fs.readdirSync = (directory, ...args) => {
    if (String(directory) === link || String(directory).startsWith(external)) externalReads++
    return readdir(directory, ...args)
  }
  try { await assert.rejects(verifyPackage(bundle, source), /Unsafe bundle symlink/) } finally { fs.readdirSync = readdir }
  assert.equal(externalReads, 0, 'must not enumerate external directory link')
  fs.unlinkSync(link)
  fs.symlinkSync('../../../../external', link)
  await assert.rejects(verifyPackage(bundle, source), /Unsafe bundle symlink/)
  fs.unlinkSync(link)
  // A neutral undeclared link is not exempt from unpacked correspondence.
  fs.symlinkSync('../app.asar', path.join(resources, 'app.asar.unpacked/alias'))
  await assert.rejects(verifyPackage(bundle, source), /Unreferenced unpacked/)
  fs.unlinkSync(path.join(resources, 'app.asar.unpacked/alias'))
  const protectedFile = path.join(resources, 'background/payload')
  put(protectedFile, 'changed'); await assert.rejects(verifyPackage(bundle, source), /inventory/); put(protectedFile, 'protected')
  put(plist, JSON.stringify({ ...metadata, CFBundleShortVersionString: 'wrong' })); await assert.rejects(verifyPackage(bundle, source)); put(plist, JSON.stringify(metadata))
  const binding = path.join(resources, 'app.asar.unpacked', native)
  fs.unlinkSync(binding); await assert.rejects(verifyPackage(bundle, source), /Missing declared unpacked/); put(binding, arm)
  fs.unlinkSync(binding); fs.symlinkSync('../../../../../../MacOS/fixture', binding)
  await assert.rejects(verifyPackage(bundle, source), /Unsafe unpacked/); fs.unlinkSync(binding); put(binding, arm)
  put(binding, Buffer.alloc(32)); await assert.rejects(verifyPackage(bundle, source), /arm64/); put(binding, arm)
  fs.unlinkSync(path.join(app, 'views/joiner.html')); await pack(); await assert.rejects(verifyPackage(bundle, source), /Missing app resource/)
  put(path.join(app, 'views/joiner.html'), 'fixture'); put(path.join(app, '.env'), 'fixture-not-a-secret'); await pack()
  await assert.rejects(verifyPackage(bundle, source), /contamination/)
})
