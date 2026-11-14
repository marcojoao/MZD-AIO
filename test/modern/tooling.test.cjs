'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const root = require('../../package.json')
const app = require('../../app/package.json')

test('pins supported desktop tooling', () => {
  assert.equal(root.devDependencies.electron, '45.3.1')
  assert.equal(root.devDependencies['electron-builder'], '26.18.0')
  assert.equal(root.devDependencies['@playwright/test'], '1.65.0')
  assert.equal(root.scripts.test, 'npm run test:unit')
  for (const name of ['spectron', 'devtron', 'electron-rebuild']) {
    assert.equal(root.devDependencies[name], undefined)
    assert.equal(app.dependencies[name], undefined)
  }
})

test('separates application dependencies and disables implicit installation/publication', () => {
  assert.equal(root.dependencies, undefined)
  for (const name of ['preinstall', 'install', 'postinstall', 'xinstall']) {
    assert.equal(root.scripts[name], undefined)
    assert.equal(app.scripts?.[name], undefined)
  }
  assert.equal(root.engines.node, '22.22.3')
  assert.equal(app.engines.node, '22.22.3')
  assert.equal(root.packageManager, 'npm@10.9.8')
  assert.equal(app.electronVersion, undefined)
  assert.equal(root.build.directories.app, 'app')
  assert.deepEqual(root.build.mac.target, ['dir'])
  assert.deepEqual(root.build.publish, [])
  for (const target of ['mac', 'linux', 'win']) assert.equal(root.build[target].publish, undefined)
  assert.equal(root.scripts['pack:mac:arm64'], 'CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64 --dir --publish never --config.electronDist=node_modules/electron/dist')
  assert.equal(root.build.npmRebuild, false)
  assert.equal(root.scripts['test:smoke'], 'node test/modern/smoke.spec.cjs')
  assert.equal(root.version, app.version)
  for (const name of ['standard', 'mocha', 'chai', 'chai-as-promised', 'dependency-check']) assert.equal(root.devDependencies[name], undefined)
})
