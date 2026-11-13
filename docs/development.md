# Desktop development: tooling milestone

## Scope and versions

Use **Node 22.22.3**, **npm 10.9.8**, and Python **3.9+** on macOS.
The root lock pins Electron **45.3.1**, electron-builder **26.18.0**, and
Playwright **1.65.0**. Root dependencies are development/build tools;
`app/package.json` and `app/package-lock.json` own runtime dependencies.
Commit both lockfiles whenever intentionally changing dependencies. Use `npm ci`,
not `npm update` or the removed `xinstall` script, to reproduce an installation.

This milestone establishes tooling, not working application startup. Do **not**
run `npm start`, legacy integration tests, `npm run release`, or packaging yet.
The legacy application still needs security/API migration. In particular, automatic
updates, crash uploads and remote downloads are not yet safe application features.
AngularJS remains unsupported; it is intentionally not replaced here.

## Prepare an isolated execution copy

Review source and lifecycle scripts before executing them. Never use an existing
application installation, mounted drive, or personal preferences as test fixtures.
No physical USB or vehicle operation belongs in this workflow.

The following preparation is run from the reviewed checkout, using an already
installed matching Node/npm. It creates a standalone local clone with its own Git
objects (needed by payload verification), copies the runtime and npm out of the
private home, and removes sample hooks. Nothing executes the application.

```sh
export SOURCE="$PWD"
export SCRATCH="$HOME/.hermes/cache/scratch/mzd-tooling-$(date +%s)"
export REVIEWED_SHA="$(git rev-parse HEAD)"
python3 - <<'PY'
import os, pathlib, shutil, subprocess
s = pathlib.Path(os.environ['SCRATCH'])
s.mkdir(parents=True, exist_ok=False)
(s / 'bin').mkdir()
node = pathlib.Path(shutil.which('node')).resolve()
npm_cli = pathlib.Path(shutil.which('npm')).resolve()
shutil.copy2(node, s / 'bin/node')
shutil.copytree(npm_cli.parent.parent, s / 'npm')
wrapper = s / 'bin/npm'
wrapper.write_text('#!/bin/sh\nexec "' + str(s / 'bin/node') + '" "' +
                   str(s / 'npm/bin/npm-cli.js') + '" "$@"\n')
wrapper.chmod(0o755)
subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', 'clone',
                '--no-hardlinks', '--no-checkout', os.environ['SOURCE'],
                str(s / 'target')], check=True)
subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(s / 'target'),
                'checkout', '--detach', os.environ['REVIEWED_SHA']], check=True)
shutil.rmtree(s / 'target/.git/hooks', ignore_errors=True)
for name in ['home', 'tmp', 'cache']:
    (s / name).mkdir()
for name in ['user.npmrc', 'global.npmrc']:
    (s / name).write_text('')
assert subprocess.check_output([str(s / 'bin/node'), '--version'], text=True).strip() == 'v22.22.3'
assert subprocess.check_output([str(s / 'bin/npm'), '--version'], text=True).strip() == '10.9.8'
PY
```

Dependency fetching is a **separate network-enabled setup step**, with a scrubbed
environment, no user npm configuration and **all lifecycle scripts disabled**.
Only the official npm registry is used. Do not expose tokens or SSH agent sockets.

```sh
for DIR in "$SCRATCH/target" "$SCRATCH/target/app"; do
  (cd "$DIR" && env -i PATH="$SCRATCH/bin:/usr/bin:/bin" \
    HOME="$SCRATCH/home" TMPDIR="$SCRATCH/tmp" \
    npm_config_cache="$SCRATCH/cache/npm" \
    npm_config_userconfig="$SCRATCH/user.npmrc" \
    npm_config_globalconfig="$SCRATCH/global.npmrc" \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm ci --ignore-scripts --no-audit --no-fund \
    --registry=https://registry.npmjs.org) || exit 1
done
```

To verify reproducibility, prepare a **second fresh scratch clone**, copy the npm
cache from the first scratch directory, and run root and app `npm ci --ignore-scripts
--offline --no-audit --no-fund` through the isolation runner below. Neither lockfile
may change. The tooling milestone verified this with no external network permitted.
Do not treat the successful script-disabled install as a successful native build.

## Offline tests and preservation

Use the trusted checkout's runner, not an unreviewed replacement in the target.
It permits reads outside the private home, denies reads of that home except the
scratch subtree, permits writes only under scratch (plus `/dev/null`), and denies
all networking. Environment variables are allowlisted. CPU, file size, process
count, descriptors, wall time and process-group RSS are bounded. Python's parent
watchdog samples RSS, not a kernel-enforced memory limit; descendants deliberately
escaping their process group are outside that watchdog's guarantee. The runner
is for reviewed tests, not a general hostile-code containment boundary. Never run
`launchctl`, installers, sync daemons, or GUI launch commands through it.

```sh
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" \
  node test/modern/isolation-probe.cjs "$SOURCE/package.json"
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" npm test
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" npm run verify:payloads
```

The isolation probe must pass credential/environment, denied-write, and denied-network
checks before project tests. Its private-home read probe uses the source manifest,
not a real secret. `npm test` invokes the complete modern `node:test` unit suite
without a GUI. The separate `test:smoke` command reserves the later hidden-window
Playwright milestone; its specification does not exist yet and is not claimed to pass.
Task 6 can reuse this runner, adding only reviewed loopback/browser allowances if
required. The current profile does not allow even loopback connections.

`verify:payloads` compares working-tree bytes against upstream
`409c724ed860497b2a34f9367cb4a019287846ea` with `git ls-tree -rz`, `git cat-file`
and SHA-256. It checks `app/files`, `app/opts`, `background`, `background-images`,
and `castscreenApp`; missing, changed and added files (even ignored files) fail.
Symlink targets are compared as bytes, and directory symlinks are not followed.
The upstream object must exist locally; missing history fails closed. For a shallow
clone, obtain the reviewed upstream commit during setup, not from inside tests.
Executable permission changes are not byte changes and are not checked here.
Mutation tests create their own temporary Git repositories, never edit real payloads.

## Preferences and asynchronous renderer bootstrap (Task 3)

The main preference service (`app/desktop/preferences.js`) owns exactly seven JSON
stores: `aio-data`, `aio-persist`, `aio-data-obj`, `aio-last`, `user-themes`, `casdk`,
and `MZD_Speedometer`. Main captures the original Electron `userData` directory
before legacy naming changes. Reads prefer `<userData>/preferences/<store>.json`,
falling back to the old `<userData>/<store>.json`. The first save copies that
store's existing object into the new directory without deleting or rewriting the
old file. Filenames and object shapes are unchanged. Missing files are empty;
malformed JSON or unsafe keys fail explicitly, never reset themselves.

The service exports `createPreferenceService(trustedOptions)` with asynchronous
`bootstrap()`, `getPreferences(store)`, and `setPreference(store, key, JSONValue)`.
It serializes reads and writes, validates JSON before persistence, and writes via
an exclusive same-directory temporary file, fsync and atomic rename. The main
process supplies paths and app metadata, not renderer request arguments. Locale
JSON/schema come from shipped `app/lang`; unknown language names fall back to
English without rewriting the saved choice. The existing four language links
are recognized from the validated main frame URL on bootstrap.

Preload exposes only `window.aio.bootstrap`, `.getPreferences`, and
`.setPreference`, using `aio:bootstrap`, `aio:get-preferences`, and
`aio:set-preference` invoke channels. The handler requires the owned webContents,
its main frame, and the exact local index page. It rejects extra arguments and
invalid stores, keys, and JSON values. This does not secure the *remaining*
legacy IPC/native operations; that is Task 4.

`desktop-client.js` has no Node dependencies. After successful bootstrap, its
caches support synchronous `.get`, `.has`, `.store` snapshots and `.size`, with
ordered asynchronous `.set(key, value)` and bulk `.set(object)`. Dotted keys and
escaped literal dots match the old dot-prop convention. `flush()` is a barrier
for all writes queued before it. Cache writes are optimistic, not saved-state
acknowledgements: callers must await `set`/`flush` before reporting success or
compiling. A failed save is shown, remains observable through `flush`, and blocks
later saves until reload; ignored legacy event-handler promises are handled.
No clear/delete capability is exposed. Upgrade cleanup no longer clears saved
selections, last compilation, or unknown legacy fields. Loading old settings
merges missing defaults recursively but replaces arrays, preserving selections.

`index.html` no longer uses Angular auto-bootstrap. The client waits for DOM ready
and bootstrap data, installs globals, then loads the fixed dependent script list
sequentially before calling Angular exactly once. Failure renders startup text
instead of initializing controllers. `MainCtrl` save/mini-save wait for disk;
compilation waits for the shared persistence barrier. Main preferences use the
same service, and main quit waits for its queued writes. Pending renderer writes
not yet sent across IPC still require the Task 4 window-close handshake.

These unit tests run in the same offline scratch runner, without dependencies or
Electron. VM tests fake only Electron transport, Angular/DOM/UI/native boundaries;
they exercise the real preload, handlers, service, client and controller bodies.
The complete application is **not yet launchable under the required security
settings**: remaining renderer `require`, window/dialog/clipboard/filesystem,
legacy IPC and native drivelist use belong to Task 4, and compiler/translator
file operations belong to Task 5. The removed broad `Config` global must not be
restored for translator/speedo-config auxiliary stores; migrate those explicitly.
AngularJS remains an unsupported maintenance dependency.

## Reviewed lifecycle decisions and native limitation

Root's automatic native postinstall and upgrade script were removed. The app has
no lifecycle scripts. Spectron, devtron and obsolete standalone electron-rebuild
were removed. Transitive lifecycle scripts remain disabled: the Windows-only
`electron-winstaller` install script is not needed for this Mac; development
`prepare` scripts are not a reason to execute them. `drivelist`'s
`prebuild-install || node-gyp rebuild` is **not** automatically run: it can fetch
unreviewed prebuilds. Electron is explicitly provisioned only after checking its
archive against the official release's `SHASUMS256.txt`; its installer can then
use the reviewed local cache offline. Do not confuse a skipped/no-op installer
with a validated binary. Check the installed executable with `file`, without
launching it.

Recovery verified the Electron 45.3.1 darwin-arm64 archive's official SHA-256:
`ed40f8473a3c62a7c0463bd42f6724ccb8d5919cfdc64e0d9f65f61bdb3fe4d2`.
The installed executable was identified as Mach-O arm64; it was not launched.

An explicit offline native build was attempted with the builder's bundled
`node-gyp`, target 45.3.1 and arm64. Missing headers first caused the expected
network-policy failure. A bounded retry used official Electron headers fetched
separately and checked against their official checksum manifest, with
`--nodedir=<scratch>/headers/node_headers`. Compilation then failed in the locked
legacy NAN headers against Electron 45's V8 APIs (`v8::External::Value` now requires
a tag, among other incompatibilities). No native module was loaded or drive
enumeration invoked. Keep native setup deferred until the owning drive service is
migrated; do not downgrade Electron or blindly upgrade app APIs to mask this error.
Legacy dependencies also emit deprecation/security warnings; this milestone is not
a clean security audit or a working packaged application.

`npm run pack:mac:arm64` is configured for a directory build and `--publish never`,
with `build.directories.app = app` and no Bintray configuration. It is **not yet
validated** and is expected to require the later app/native migration. Do not
publish, sign, install firmware, or write raw disks as part of development checks.
