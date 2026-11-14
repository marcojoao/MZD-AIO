'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveOutputDirectory, isEligibleDrive, validateExternalUrl } = require('../../app/desktop/policy')

function fixture (t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mzd-policy-')))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const resources = path.join(root, 'resources')
  const project = path.join(home, 'My Project Exports')
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(resources)
  return { root, home, resources, project, options: { home, resourceRoots: [resources] } }
}

test('output resolves a parent with spaces without creating the output', t => {
  const f = fixture(t)
  assert.equal(resolveOutputDirectory(f.project, f.options), f.project + '/_copy_to_usb')
  assert.deepEqual(fs.readdirSync(f.project), [])
})

test('output permits an existing ordinary directory and preserves unrelated contents', t => {
  const f = fixture(t)
  const output = path.join(f.project, '_copy_to_usb')
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, 'keep.txt'), 'untouched')
  assert.equal(resolveOutputDirectory(f.project, f.options), output)
  assert.equal(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8'), 'untouched')
})

test('output rejects unsafe or ambiguous parents without writes', t => {
  const f = fixture(t)
  const resourceChild = path.join(f.resources, 'nested')
  fs.mkdirSync(resourceChild)
  const file = path.join(f.project, 'keep.txt')
  fs.writeFileSync(file, 'untouched')
  for (const parent of ['/', f.home, f.resources, resourceChild, f.project + '/../My Project Exports',
    'relative/path', '', null, 42, f.project + '/missing', file]) {
    assert.throws(() => resolveOutputDirectory(parent, f.options), /output/i, String(parent))
  }
  assert.deepEqual(fs.readdirSync(f.project), ['keep.txt'])
  assert.equal(fs.readFileSync(file, 'utf8'), 'untouched')
})

test('output canonicalizes ordinary directory aliases but blocks protected aliases', t => {
  const f = fixture(t)
  for (const [name, target, allowed] of [
    ['project-alias', f.project, true], ['home-alias', f.home, false],
    ['resource-alias', f.resources, false], ['root-alias', '/', false]
  ]) {
    const alias = path.join(f.root, name)
    fs.symlinkSync(target, alias)
    if (allowed) assert.equal(resolveOutputDirectory(alias, f.options), f.project + '/_copy_to_usb')
    else assert.throws(() => resolveOutputDirectory(alias, f.options), /output/i)
  }
})

test('output refuses existing and dangling output symlinks without touching their destinations', t => {
  const f = fixture(t)
  const output = path.join(f.project, '_copy_to_usb')
  fs.writeFileSync(path.join(f.resources, 'keep.txt'), 'untouched')
  for (const target of [f.resources, path.join(f.root, 'not-created')]) {
    fs.symlinkSync(target, output)
    assert.throws(() => resolveOutputDirectory(f.project, f.options), /output/i)
    assert.equal(fs.readlinkSync(output), target)
    fs.unlinkSync(output)
  }
  assert.equal(fs.readFileSync(path.join(f.resources, 'keep.txt'), 'utf8'), 'untouched')
  assert.equal(fs.existsSync(path.join(f.root, 'not-created')), false)
})

test('output rejects an existing file target without changing it', t => {
  const f = fixture(t)
  const output = path.join(f.project, '_copy_to_usb')
  fs.writeFileSync(output, 'untouched')
  assert.throws(() => resolveOutputDirectory(f.project, f.options), /output/i)
  assert.equal(fs.readFileSync(output, 'utf8'), 'untouched')
})

test('production output defaults protect application resources for the intended reason (mutation checked)', t => {
  const f = fixture(t)
  const appRoot = path.resolve(__dirname, '../../app')
  const check = resolve => assert.throws(() => resolve(appRoot, { home: f.home }), error => error.cause?.message === 'Protected parent')
  check(resolveOutputDirectory)
  // An accessible home prevents an unrelated EPERM lookup from masking removal.
  const Module = require('node:module')
  const filename = require.resolve('../../app/desktop/policy')
  const mutant = new Module(filename, module); mutant.filename = filename; mutant.paths = module.paths
  mutant._compile(fs.readFileSync(filename, 'utf8').replace("const roots = [path.resolve(__dirname, '..')]", 'const roots = []'), filename)
  assert.throws(() => check(mutant.exports.resolveOutputDirectory), /Missing expected exception/)
})

// Removing strict drivelist status/mountpoint validation must fail these cases.
test('drive eligibility accepts a mounted removable non-system drivelist record', () => {
  assert.equal(isEligibleDrive({ isSystem: false, isRemovable: true, isUSB: true,
    mountpoints: [{ path: '/Volumes/Export Drive', label: 'Export Drive' }] }), true)
})

test('drive eligibility fails closed for internal/system/unknown disks and malformed mountpoints', () => {
  const valid = { isSystem: false, isRemovable: true, mountpoints: [{ path: '/Volumes/Export' }] }
  for (const drive of [null, undefined, {}, { ...valid, isSystem: true },
    { ...valid, isSystem: undefined }, { ...valid, isSystem: 'false' },
    { ...valid, isRemovable: false }, { ...valid, isRemovable: undefined },
    { ...valid, isRemovable: 'true' }, ...[undefined, null, {}, [], [null], [{}],
      [{ path: '' }], [{ path: 'relative' }], [{ path: '/' }], [{ path: '/Volumes/../' }],
      [{ path: '/Volumes/A\0B' }], [{ path: '/Volumes/Export' }, null], Array(1)
    ].map(mountpoints => ({ ...valid, mountpoints }))]) {
    assert.equal(isEligibleDrive(drive), false, JSON.stringify(drive))
  }
})

test('external URL accepts only reviewed HTTPS host and normalizes the returned URL', () => {
  assert.equal(validateExternalUrl('https://GITHUB.COM:443/Trevelopment/MZD-AIO?q=1#readme'),
    'https://github.com/Trevelopment/MZD-AIO?q=1#readme')
})

test('external URL rejects unsafe schemes, credentials, ports and deceptive hosts', () => {
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'http://github.com',
    'https://user:pass@github.com', 'https://user@github.com', 'https://github.com:444/',
    'https://github.com.evil.test', 'https://evilgithub.com', 'https://github.com.',
    'https://github.com@evil.test', 'https://api.github.com', '//github.com',
    'not a url', '', null, 42, { toString: () => 'https://github.com' }]) {
    assert.throws(() => validateExternalUrl(value), /URL/i, String(value))
  }
})
