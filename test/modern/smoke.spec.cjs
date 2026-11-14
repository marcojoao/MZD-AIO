'use strict'
// The application owns hidden assertions in main, through the real renderer bridge.
// This driver requires the mandatory outer sandbox, records the actual child exit,
// and refuses zero-exit startup/singleton shortcuts lacking the final evidence.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
test('hidden source or packaged startup and representative compilation', { timeout: 180000 }, async () => {
  assert.equal(process.env.MZD_AIO_OUTER_SANDBOX, '1', 'Run through scripts/run-hidden-isolated.py (probe first)')
  const output = process.env.MZD_AIO_TEST_OUTPUT
  assert.ok(output && path.isAbsolute(output))
  const record = path.join(output, 'hidden-smoke.json')
  fs.rmSync(record, { force: true })
  let executable, args
  if (process.argv[2]) {
    const bundle = path.resolve(process.argv[2])
    const metadata = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }))
    executable = path.join(bundle, 'Contents/MacOS', metadata.CFBundleExecutable); args = []
  } else { executable = require('electron'); args = [path.resolve(__dirname, '../../app')] }
  // Authorized launcher-only workaround; production retains sandbox:true.
  const child = spawn(executable, ['--no-sandbox', ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { logs += bytes; process.stdout.write(bytes) })
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })) })
  fs.writeFileSync(path.join(output, 'smoke-child.json'), JSON.stringify({ executable, args, ...result }, null, 2))
  assert.deepEqual(result, { code: 0, signal: null })
  assert.match(logs, /HIDDEN_SMOKE_PASS/)
  const evidence = JSON.parse(fs.readFileSync(record))
  assert.equal(evidence.closeFlushed, true); assert.deepEqual(evidence.runtimeErrors, [])
  assert.ok(evidence.representative.result.files.includes('tweaks.sh'))
})
