# MZD-AIO Desktop Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible, modern Apple Silicon desktop application that preserves the existing selection interface and vehicle payloads and passes isolated startup and compilation tests.

**Architecture:** Retain the existing AngularJS interface. Move filesystem, preferences, drive discovery, image processing, and compilation into main-process services behind a narrow preload bridge. Keep bundled vehicle payloads byte-identical to upstream and make the desktop offline by default.

**Tech Stack:** Node 22.22.3 development baseline, Electron 45.3.1, electron-builder 26.18.0, Playwright 1.65.0, Node's built-in test runner, existing AngularJS assets.

**Spec:** `docs/superpowers/specs/2026-11-13-desktop-modernization-design.md`

## Global Constraints

- The first milestone targets the current Mac, including native Apple Silicon packaging.
- Keep the existing screens and selection workflow.
- Preserve vehicle scripts and bundled payload bytes.
- Disable legacy automatic updating, automatic crash uploads, and unverified remote downloads by default.
- No raw disk writes, formatting, vehicle connections, or firmware installation are part of this milestone.
- Do not open visible browsers or application windows.
- Do not publish a GitHub fork, release, pull request, or package without a separate request.
- Do not replace AngularJS in this milestone; report its remaining maintenance risk explicitly.
- Tests use scratch directories and fixtures, never mounted USB drives or an existing installation.
- Use context isolation and disable renderer Node integration; do not use @electron/remote as a migration shortcut.

## Evidence and Version Selection

Upstream baseline: `409c724ed860497b2a34f9367cb4a019287846ea`.

The official Electron release feed lists 45.3.2, but npm returned E404 for that version during discovery. Electron 45.3.1 exists in npm, requires Node >=22.12.0, and its official GitHub release includes `electron-v45.3.1-darwin-arm64.zip`. Therefore pin 45.3.1 rather than selecting the unpublished version. Registry lookups confirmed electron-builder 26.18.0, drivelist 12.0.2, and Playwright 1.65.0. These are discovery results, not successful installation or build results.

The old compilation implementation is `app/assets/js/build-tweaks.js`, not `build/target.js`. The latter only copies build configuration. Privileged renderer dependencies begin in `app/assets/js/index.js`; `app/controllers/home.js:857-867` triggers compilation. Existing tests are placeholders or obsolete Spectron window checks.

## File Structure

- `package.json`, `package-lock.json`: development tools, test commands, reproducible root installation, and packaging configuration.
- `app/package.json`, `app/package-lock.json`: application runtime dependencies and reproducible application installation.
- `app/main.js`: application lifecycle, service registration, hidden test mode, and window creation.
- `app/preload.js`: only the explicit `window.aio` API, with no filesystem primitives or arbitrary IPC exposed.
- `app/desktop/policy.js`: output path, external URL, navigation, and drive eligibility policy.
- `app/desktop/preferences.js`: JSON preference storage and legacy preference import.
- `app/desktop/services.js`: validated IPC handlers, native dialogs, image operations, and drive discovery.
- `app/desktop/compiler.js`: desktop compilation entry point and output lifecycle, extracted from the legacy builder without changing bundled inputs.
- `app/assets/js/desktop-client.js`: browser-side cached preferences and asynchronous bridge calls.
- `app/assets/js/index.js`, `events.js`, `build-tweaks.js`, `audioSourceList.js`, `messages-settings.js`, `translator.js`, `speedoConfig.js`, `zoom.js`, `printers.js`, `notifications.js`: migrate each used privileged call without changing unrelated layout.
- `app/controllers/home.js`, `app/index.html`, `app/views/joiner.html`: asynchronous startup and migrated actions.
- `app/menus/*.js`, `app/lib/auto-update/update.js`, `app/lib/printer.js`: modern Electron APIs and disabled obsolete services.
- `scripts/verify-payloads.cjs`, `scripts/verify-package.cjs`: deterministic preservation and packaging checks.
- `test/modern/*.test.cjs`, `test/modern/smoke.spec.cjs`, `test/fixtures/`: meaningful tests and selected fixture inputs.
- `docs/development.md`: exact install, test, build, and limitations instructions.

## Review Focus

1. Output directories containing symlinks, spaces, or an existing unrelated directory must not permit deletion or traversal outside the approved output root. Task 2 tests this.
2. Older saved preferences with missing or malformed fields must not prevent startup or silently change selected tweaks. Task 3 tests this.
3. Cancelling an image or directory chooser must leave preferences and output unchanged. Task 4 tests this.
4. Missing optional assets or a compiler error must not report success or leave a completed-looking package. Task 5 tests this.
5. Offline startup and a second application instance must not trigger network access, visible dialogs, or test hangs. Task 6 tests this.

### Task 1: Establish Reproducible Tooling and Payload Preservation

**Files:** Modify root and app package manifests and lockfiles; create `scripts/verify-payloads.cjs`, `test/modern/tooling.test.cjs`, `docs/development.md`.

**Interfaces:** Consumes upstream git object. Produces `npm run test:unit`, `npm run verify:payloads`, and explicitly pinned tool versions. Application dependencies remain in the app manifest; build and test dependencies remain in the root manifest.

- [ ] **Step 1: Write failing manifest tests.** Use `node:test` and `node:assert/strict`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const root = require('../../package.json')
test('pins supported desktop tooling', () => {
  assert.equal(root.devDependencies.electron, '45.3.1')
  assert.equal(root.devDependencies['electron-builder'], '26.18.0')
  assert.equal(root.devDependencies['@playwright/test'], '1.65.0')
  assert.equal(root.scripts.test, 'npm run test:unit')
  assert.equal(root.devDependencies.spectron, undefined)
})
```

- [ ] **Step 2:** Run `node --test test/modern/tooling.test.cjs`; record the actual failing assertion before changing manifests.
- [ ] **Step 3:** Pin the versions above, replace the `npm test` GUI launch, remove obsolete Spectron/devtron/rebuild tooling, and remove Bintray publication configuration. Set an explicit `directories.app: 'app'`, `mac.target: ['dir']`, and an arm64 packaging command with publishing disabled. Audit both lifecycle scripts before installation. Replace obsolete app dependencies as their owning service is migrated rather than blindly updating APIs.

```json
{
  "scripts": {
    "test": "npm run test:unit",
    "test:unit": "node --test test/modern/*.test.cjs",
    "test:smoke": "playwright test test/modern/smoke.spec.cjs --workers=1",
    "verify:payloads": "node scripts/verify-payloads.cjs",
    "pack:mac:arm64": "electron-builder --mac --arm64 --dir --publish never"
  }
}
```

- [ ] **Step 4:** Implement preservation verification using `git ls-tree -rz` and `git cat-file` against the baseline, and SHA-256 of working files under `app/files`, `app/opts`, `background`, `background-images`, and `castscreenApp`. Fail on missing, changed, or newly introduced payload files. Test the verifier with an isolated modified fixture, not the real payload tree.
- [ ] **Step 5:** Fetch reviewed dependencies in a controlled setup step. Run installation with scripts initially disabled, then explicitly perform only reviewed Electron download/native rebuild steps. Produce lockfiles, demonstrate a second clean `npm ci` in scratch, run the tests and preservation check, and commit only source and lockfiles. Never commit `node_modules` or downloaded binaries.

### Task 2: Implement Filesystem and Navigation Policy

**Files:** Create `app/desktop/policy.js`, `test/modern/policy.test.cjs`; modify window policy wiring in `app/main.js` later in Task 4.

**Interfaces:** Exports `resolveOutputDirectory(parent: string): string`, `isEligibleDrive(drive: object): boolean`, and `validateExternalUrl(value: string): string`. The output resolver only returns a child named `_copy_to_usb`; it rejects root, home, application resources, and symbolic-link output targets. External URLs are limited to explicitly reviewed HTTPS hosts and reject embedded credentials.

- [ ] **Step 1:** Write failing tests covering output traversal, symlink escape, a normal parent with spaces, internal/system disks, missing mountpoints, valid removable disks, `javascript:` URLs, `file:` URLs, and credential-bearing HTTPS URLs.

```js
assert.throws(() => resolveOutputDirectory('/'), /output/i)
assert.equal(isEligibleDrive({ isSystem: true, mountpoints: [{ path: '/Volumes/X' }] }), false)
assert.throws(() => validateExternalUrl('javascript:alert(1)'), /URL/i)
assert.throws(() => validateExternalUrl('https://user:pass@github.com'), /URL/i)
```

- [ ] **Step 2:** Run `node --test test/modern/policy.test.cjs` and confirm missing-module failure.
- [ ] **Step 3:** Implement with `node:path`, `fs.realpathSync`, `fs.lstatSync`, explicit mountpoint validation, and `URL`. Check existing output symlinks before any deletion. Do not expose arbitrary shell commands, recursive deletion, or drive-format operations.

```js
function validateExternalUrl (value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password ||
      !new Set(['github.com']).has(url.hostname)) {
    throw new Error('External URL is not allowed')
  }
  return url.href
}
```

- [ ] **Step 4:** Run the policy suite and test no writes occur on rejected paths. Commit policy and tests.

### Task 3: Move Preferences and Bootstrap Data Out of Renderer Node

**Files:** Create `app/desktop/preferences.js`, `app/assets/js/desktop-client.js`, `test/modern/preferences.test.cjs`; modify `app/preload.js`, `app/assets/js/index.js`, `app/controllers/home.js`, `app/index.html`.

**Interfaces:** Main service exposes `bootstrap(): Promise<{app: {name, version}, paths: object, preferences: object, language: object}>`, `getPreferences(store: string): Promise<object>`, and `setPreference(store: string, key: string, value: JSONValue): Promise<void>`. Allowed store names are `aio-data`, `aio-persist`, `aio-data-obj`, `aio-last`, `user-themes`, `casdk`, and `MZD_Speedometer`. Unknown stores and prototype-polluting keys are rejected. Legacy files are imported without deleting originals.

- [ ] **Step 1:** Write failing preference round-trip, missing-file default, corrupt-JSON error, unsupported-store, and prototype-key tests. Use fresh scratch directories.

```js
await assert.rejects(service.setPreference('unknown', 'lang', 'english'), /store/i)
await assert.rejects(service.setPreference('aio-data', '__proto__', {}), /key/i)
await service.setPreference('aio-persist', 'lang', 'english')
assert.equal((await service.getPreferences('aio-persist')).lang, 'english')
```

- [ ] **Step 2:** Run the suite and record the missing implementation failure.
- [ ] **Step 3:** Implement validated JSON stores with atomic writes and clear corruption errors. Preserve existing store filenames and data shapes. Supply app name/version/paths and localized JSON through bootstrap, replacing dynamic renderer `require()` calls.
- [ ] **Step 4:** Implement the browser cache only after successful bootstrap. Retain existing `.get`, `.has`, and `.set` caller semantics where practical, but queue writes and expose `flush(): Promise<void>` so tests and compilation can await persistence. Start Angular with `angular.bootstrap(document, ['AIO'])` only after cached data and globals are initialized; remove automatic `ng-app` bootstrap to avoid double initialization.

```js
window.aio.bootstrap().then(data => {
  initializeDesktopClient(data)
  angular.bootstrap(document, ['AIO'])
}).catch(error => {
  document.body.textContent = `MZD-AIO could not start: ${error.message}`
})
```

- [ ] **Step 5:** Test a missing old preference field preserves defaults and selected tweak arrays survive round-trip. Test corrupt data yields a visible startup error instead of partial initialization. Run all unit tests and commit.

### Task 4: Migrate Native Desktop Operations and Disable Legacy Network Services

**Files:** Create `app/desktop/services.js`, `test/modern/services.test.cjs`; modify `app/main.js`, `app/preload.js`, `app/menus/*.js`, `app/lib/printer.js`, `app/lib/auto-update/update.js`, `app/assets/js/index.js`, `events.js`, `zoom.js`, `printers.js`, `notifications.js`, `translator.js`, `speedoConfig.js`, `messages-settings.js`, and `app/views/joiner.html` as used.

**Interfaces:** Bridge exports `chooseOutputDirectory()`, `chooseImage(kind)`, `resizeImage({kind, source})`, `listDrives()`, `setFullscreen(enabled)`, `print()`, `openExternal(url)`, and `onProgress(callback): unsubscribe`. Dialog results are `null` when cancelled. Images use a fixed kind enum of `background`, `offscreen`, and `album`; destination filenames are chosen by the main service, not the renderer. IPC handlers validate the calling frame and payload.

- [ ] **Step 1:** Write failing tests using injected Electron adapters: cancelled dialog returns null without writes, invalid image kind rejects, system drives are filtered, untrusted frames reject, and HTTP downloads fail with a clear disabled-feature message.

```js
assert.equal(await service.chooseImage('background'), null)
assert.deepEqual(writes, [])
await assert.rejects(service.resizeImage({ kind: 'unknown', source: '/x' }), /kind/i)
await assert.rejects(service.openExternal('http://trevelopment.win/colors'), /URL/i)
```

- [ ] **Step 2:** Run the tests before implementing the adapters.
- [ ] **Step 3:** Replace removed Electron dialog callback signatures with awaited results. Replace remote window operations with main-process handlers. Replace filesystem/XML/image exports in renderer code with specific service calls. Use modern `nativeImage` in the main process. Pin drivelist 12.0.2 if its reviewed native build works; otherwise document the real failure and propose a separate read-only drive adapter without shell interpolation.
- [ ] **Step 4:** Replace the legacy preload with explicitly named contextBridge functions. Do not expose raw `ipcRenderer`, generic channel invocation, `fs`, `process`, `require`, or arbitrary filesystem paths.

```js
contextBridge.exposeInMainWorld('aio', {
  bootstrap: () => ipcRenderer.invoke('aio:bootstrap'),
  chooseOutputDirectory: () => ipcRenderer.invoke('aio:choose-output'),
  listDrives: () => ipcRenderer.invoke('aio:list-drives')
})
```

Extend this object only with the interfaces defined in Tasks 3-5.

- [ ] **Step 5:** Configure `nodeIntegration: false`, `contextIsolation: true`, and a fixed preload path for every local application window. Deny unexpected navigation and all new-window creation. Remove remote-script insertion, automatic remote announcements, translation-service scripts, automatic crash uploads, legacy updater initialization, and HTTP asset downloads. Keep their UI actions as clear disabled notices where removing them would confuse users.
- [ ] **Step 6:** Test local route navigation still works, foreign navigation rejects, no unrestricted Electron imports remain in active renderer scripts, and cancelled dialogs preserve state. Commit.

### Task 5: Extract and Exercise Compilation With Safe Output Boundaries

**Files:** Create `app/desktop/compiler.js`, `test/modern/compiler.test.cjs`, `test/fixtures/compile-options.json`; modify `app/assets/js/build-tweaks.js`, `app/controllers/home.js`, `app/assets/js/audioSourceList.js`, and `app/desktop/services.js`.

**Interfaces:** `compile({options: object, outputParent: string}, onProgress: (event: {stage: string, message: string}) => void): Promise<{outputDirectory: string, files: string[]}>`. Inputs are serializable selections from the existing controller. Only the service chooses application resource paths. Progress events are text, not arbitrary HTML. Compilation never executes generated shell scripts.

- [ ] **Step 1:** Capture a minimal selection fixture from existing controller defaults, choosing the main-menu loop option by its real identifier from `app/lang/english.aio.json`. Test required `tweaks.sh` and configuration outputs, deterministic script content excluding timestamps, repeat compilation, missing input resources, output symlinks, injected copy failure, and concurrent compilation rejection. Do not invent a numeric option identifier.

```js
const result = await compiler.compile({ options: fixture, outputParent: scratch }, () => {})
assert.equal(result.outputDirectory, path.join(scratch, '_copy_to_usb'))
assert.ok(result.files.includes('tweaks.sh'))
assert.match(await fs.readFile(path.join(result.outputDirectory, 'tweaks.sh'), 'utf8'), /MZD/)
```

- [ ] **Step 2:** Run failing compiler tests and retain actual output.
- [ ] **Step 3:** Move existing selection and concatenation logic out of DOM functions into the compiler. Replace dialogs, DOM logs, global app objects, and implicit paths with explicit inputs and progress callbacks. Replace legacy appender/copy-dir/crlf/mkdirp/rimraf uses with reviewed Node filesystem operations or small compatibility functions owned by the compiler. Preserve file ordering and line-ending behavior. The old browser builder becomes a thin bridge client.
- [ ] **Step 4:** Write into a sibling staging directory. Publish `_copy_to_usb` only after all asynchronous operations finish. Reject concurrent compiles. On failure remove only staging files and retain the previous successful output. Use the validated output resolver before cleanup or replacement.

```js
const result = await window.aio.compile({ options: $scope.user, outputParent: $scope.user.copydir })
$scope.$applyAsync(() => { $scope.compileResult = result })
```

- [ ] **Step 5:** Test mandatory missing assets prevent success, optional unavailable downloads give actionable messages, failed compilation retains previous output, and two consecutive compiles do not retain stale selection state. Verify the existing interface receives completion only after file writes finish. Run `npm run verify:payloads` and commit.

### Task 6: Verify Hidden Startup, Package Construction, and Reproducibility

**Files:** Create `test/modern/smoke.spec.cjs`, `scripts/verify-package.cjs`, isolated test-runner configuration; modify `app/main.js`, `package.json`, and `docs/development.md`.

**Interfaces:** `MZD_AIO_TEST=1` enables hidden windows, isolated user data, no tray, no focus, and no modal errors. This mode does not bypass IPC validation or substitute fake compiler results. An explicit test output path lives inside scratch. `npm run test:smoke` and `npm run pack:mac:arm64` are the final entry points.

- [ ] **Step 1:** Write the failing Playwright Electron test using `show: false` in the real app. Assert main page contains `#compileButton`, Angular injector is initialized, and no preload/renderer errors occur. Test preferences, fixture compilation through the real UI bridge, and the joiner route. Check privileged globals are absent.

```js
const { _electron: electron, test, expect } = require('@playwright/test')
test('loads isolated desktop without renderer Node', async () => {
  const application = await electron.launch({
    args: ['app'],
    env: { ...process.env, MZD_AIO_TEST: '1' }
  })
  try {
    const page = await application.firstWindow()
    await expect(page.locator('#compileButton')).toHaveCount(1)
    expect(await page.evaluate(() => typeof require)).toBe('undefined')
    expect(await page.evaluate(() => typeof window.aio.compile)).toBe('function')
    expect(await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(window => !window.isVisible()))).toBe(true)
  } finally {
    await application.close()
  }
})
```

- [ ] **Step 2:** Build the sandbox runner in scratch following the macos-sandboxed-execution skill: scrubbed environment, read denial for user credentials, writes only to scratch, external networking denied, resource limits, and an RSS watchdog. Prove external connection, outside-scratch write, and credential read are denied before running project code. Pass only approved PATH/HOME/TMPDIR and test variables. Playwright receives the scrubbed process environment, not the user's real credentials.
- [ ] **Step 3:** Run isolated unit and hidden-window suites. Add a request guard that fails on any nonlocal URL. Launch a second hidden instance and assert it exits promptly without focusing the first. Ensure test mode never calls `show`, `focus`, `showErrorBox`, or tray creation. Record actual exit codes and errors; repair observed failures rather than weakening assertions.
- [ ] **Step 4:** Package with `CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:mac:arm64`. Verify `Contents/MacOS` executable architecture using `file`, app metadata using `plutil`, and application archive contents using the installed ASAR tool. Assert the payloads and required image resources are included. Launch the packaged executable in the same hidden test mode and rerun the main smoke assertions.
- [ ] **Step 5:** Repeat clean installation from lockfiles in a new scratch copy and rerun unit tests, hidden startup, representative compilation, and preservation checks. Record dependency audit findings, remaining AngularJS risk, unsigned packaging status, and untested vehicle/Windows/Linux behavior in `docs/development.md`.
- [ ] **Step 6:** Run `git diff --check`, inspect all changed paths for accidental payload edits, commit, and request a fresh whole-branch review. Fix reviewer findings and rerun affected checks. Final handoff includes actual package path, commands and exit codes, remaining limitations, and the exact vehicle payload preservation result.

## Self-Review

The six tasks cover toolchain reproducibility, security boundaries, preferences, native desktop operations, compilation, hidden-window execution, native package inspection, and byte-preserved payloads. Every Review Focus condition is assigned to a test-owning task. Runtime versions are grounded in npm and official release assets. No desktop build or vehicle validation is claimed by this plan. The compiler migration is the largest risk because its current implementation spans 1,613 lines and depends on renderer globals; preserve its behavior incrementally and stop for a design update if preserving a workflow requires changing bundled vehicle scripts.
