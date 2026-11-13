'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { verifyPayloads } = require('../../scripts/verify-payloads.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mzd-payload-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q')
  for (const name of ['app/files/bytes.bin', 'app/opts/space and\nnewline.txt', 'background/image', 'background-images/image', 'castscreenApp/app.apk']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), Buffer.from([0, 10, 13, 255, 42]))
  }
  fs.symlinkSync('bytes.bin', path.join(root, 'app/files/link'))
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture')
  return { root, baseline: git('rev-parse', 'HEAD').trim() }
}

test('accepts identical bytes across all payload roots, binary names and symlinks', t => {
  const { root, baseline } = fixture(t)
  fs.writeFileSync(path.join(root, 'outside.txt'), 'irrelevant')
  assert.deepEqual(verifyPayloads(root, baseline), { baseline, checked: 6, missing: [], changed: [], added: [] })
})
test('detects changed, missing and newly introduced payload files including ignored files', t => {
  const { root, baseline } = fixture(t)
  fs.writeFileSync(path.join(root, 'app/files/bytes.bin'), 'modified')
  fs.unlinkSync(path.join(root, 'background/image'))
  fs.writeFileSync(path.join(root, '.gitignore'), '*.extra\n')
  fs.writeFileSync(path.join(root, 'castscreenApp/new.extra'), 'new')
  const result = verifyPayloads(root, baseline)
  assert.deepEqual(result.changed, ['app/files/bytes.bin'])
  assert.deepEqual(result.missing, ['background/image'])
  assert.deepEqual(result.added, ['castscreenApp/new.extra'])
})
test('does not follow a replacement directory symlink outside the payload tree', t => {
  const { root, baseline } = fixture(t)
  fs.rmSync(path.join(root, 'app/opts'), { recursive: true })
  fs.symlinkSync('/private', path.join(root, 'app/opts'))
  const result = verifyPayloads(root, baseline)
  assert.deepEqual(result.missing, ['app/opts/space and\nnewline.txt'])
  assert.deepEqual(result.added, ['app/opts'])
})
test('detects file-to-symlink substitution even when target contents match', t => {
  const { root, baseline } = fixture(t)
  fs.unlinkSync(path.join(root, 'background/image'))
  fs.symlinkSync('../background-images/image', path.join(root, 'background/image'))
  assert.deepEqual(verifyPayloads(root, baseline).changed, ['background/image'])
})
test('CLI returns nonzero for mutations and unavailable baseline, zero for pristine fixture', t => {
  const { root, baseline } = fixture(t)
  const command = path.resolve(__dirname, '../../scripts/verify-payloads.cjs')
  const run = ref => spawnSync(process.execPath, [command, root, ref], { encoding: 'utf8' })
  assert.equal(run(baseline).status, 0)
  fs.writeFileSync(path.join(root, 'background/image'), 'changed')
  const changed = run(baseline)
  assert.equal(changed.status, 1)
  assert.match(changed.stdout, /background\/image/)
  assert.equal(run('not-a-ref').status, 1)
})
