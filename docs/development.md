# Desktop development and unsigned Apple Silicon packaging

## Scope

Use Node **22.22.3**, npm **10.9.8**, Python **3.9+**, macOS and Xcode command-line
build tools. Root locks Electron **45.3.1**, electron-builder **26.18.0** and
Playwright **1.65.0**; app locks native drivelist **12.0.2**. Both app/root versions
remain **2.8.6**, matching the retained UI/payload semantics. The output is named
**MZD-AIO Modernization**, not an official upstream release. It is unsigned and
not notarized. Do not publish, install firmware, execute generated shell scripts,
connect a vehicle, or write physical USB media as part of these checks.

The retained AngularJS screens now use a sandboxed/context-isolated preload and
main-owned services/compiler. Automatic legacy downloads/updating/crash upload are
disabled. Missing remote-only assets fail explicitly. Vehicle compatibility,
Windows/Linux execution, visible rendering and ordinary production inner-sandbox
startup have **not** been validated. See `desktop-services.md` for the IPC,
persistence, native image and compiler contracts.

## 1. Prepare a standalone scratch execution copy

Review the checkout and lifecycle scripts first. Run preparation from that checkout.
Do not execute target code in a personal installation or your working checkout.
The runners intentionally accept only dedicated directories below
`$HOME/.hermes/cache/scratch`; this is derived from HOME, not a machine-specific path.
No ignored orchestration files are needed.

```sh
export SOURCE="$PWD"
export SCRATCH="$HOME/.hermes/cache/scratch/mzd-desktop-$(date +%s)"
export REVIEWED_SHA="$(git rev-parse HEAD)"
python3 - <<'PY'
import os, pathlib, shutil, subprocess
s = pathlib.Path(os.environ['SCRATCH']); s.mkdir(parents=True, exist_ok=False)
(s / 'bin').mkdir()
shutil.copy2(pathlib.Path(shutil.which('node')).resolve(), s / 'bin/node')
npm = pathlib.Path(shutil.which('npm')).resolve().parent.parent
shutil.copytree(npm, s / 'npm')
wrapper = s / 'bin/npm'
wrapper.write_text('#!/bin/sh\nexec "' + str(s / 'bin/node') + '" "' + str(s / 'npm/bin/npm-cli.js') + '" "$@"\n')
wrapper.chmod(0o755)
subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-hardlinks',
                os.environ['SOURCE'], str(s / 'target')], check=True)
subprocess.run(['git', '-C', str(s / 'target'), 'checkout', '--detach', os.environ['REVIEWED_SHA']], check=True)
shutil.rmtree(s / 'target/.git/hooks', ignore_errors=True)
for name in ['home', 'tmp', 'cache', 'downloads', 'headers']:
    (s / name).mkdir()
for name in ['user.npmrc', 'global.npmrc']:
    (s / name).write_text('')
assert subprocess.check_output([str(s / 'bin/node'), '--version'], text=True).strip() == 'v22.22.3'
assert subprocess.check_output([str(s / 'bin/npm'), '--version'], text=True).strip() == '10.9.8'
PY
```

## 2. Separately reviewed network-enabled setup (no lifecycle scripts)

This step intentionally fetches dependencies, not application content. It exposes
no tokens, SSH agent or personal npm configuration. Review lock changes rather
than running `npm update`, `npm audit fix --force`, or old release/install scripts.

```sh
for DIR in "$SCRATCH/target" "$SCRATCH/target/app"; do
  (cd "$DIR" && env -i PATH="$SCRATCH/bin:/usr/bin:/bin" \
    HOME="$SCRATCH/home" TMPDIR="$SCRATCH/tmp" \
    npm_config_cache="$SCRATCH/cache/npm" \
    npm_config_userconfig="$SCRATCH/user.npmrc" \
    npm_config_globalconfig="$SCRATCH/global.npmrc" \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org) || exit 1
done
```

Fetch official binary/header archives and manifests separately; an existing binary
is not evidence of fresh provisioning. The following archive checks must succeed
**before extraction**. No third-party installer/lifecycle script is invoked.

```sh
for FILE in SHASUMS256.txt electron-v45.3.1-darwin-arm64.zip; do
  env -i PATH=/usr/bin:/bin HOME="$SCRATCH/home" TMPDIR="$SCRATCH/tmp" \
    curl --fail --location --proto '=https' \
    "https://github.com/electron/electron/releases/download/v45.3.1/$FILE" \
    -o "$SCRATCH/downloads/$FILE" || exit 1
done
for FILE in SHASUMS256.txt node-v45.3.1-headers.tar.gz; do
  env -i PATH=/usr/bin:/bin HOME="$SCRATCH/home" TMPDIR="$SCRATCH/tmp" \
    curl --fail --location --proto '=https' \
    "https://artifacts.electronjs.org/headers/dist/v45.3.1/$FILE" \
    -o "$SCRATCH/headers/$FILE" || exit 1
done
python3 - <<'PY'
import hashlib, os, pathlib, subprocess
s = pathlib.Path(os.environ['SCRATCH'])
for directory, name in [('downloads', 'electron-v45.3.1-darwin-arm64.zip'),
                        ('headers', 'node-v45.3.1-headers.tar.gz')]:
    root = s / directory
    manifest = {line.split()[1].lstrip('*'): line.split()[0]
                for line in (root / 'SHASUMS256.txt').read_text().splitlines()}
    digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
    assert digest == manifest[name], (name, digest)
    print(name, digest)
dist = s / 'target/node_modules/electron/dist'
assert not dist.exists(), 'Use a fresh script-disabled installation'
subprocess.run(['/usr/bin/ditto', '-x', '-k', str(s / 'downloads/electron-v45.3.1-darwin-arm64.zip'), str(dist)], check=True)
(s / 'target/node_modules/electron/path.txt').write_text('Electron.app/Contents/MacOS/Electron')
subprocess.run(['/usr/bin/tar', '-xzf', str(s / 'headers/node-v45.3.1-headers.tar.gz'), '-C', str(s / 'headers')], check=True)
PY
file "$SCRATCH/target/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
```

Observed official archive SHA-256:
`ed40f8473a3c62a7c0463bd42f6724ccb8d5919cfdc64e0d9f65f61bdb3fe4d2`.
Headers SHA-256:
`d021647f2f9ee483408ac218697d91ef81f39ce782429f93c8db32e17e75f961`.
Always compare with the fetched manifest, not only these documented values.

## 3. Offline native build, tests and package

First probe the mandatory outer sandbox. It denies private-home reads, external
networking and writes outside scratch, scrubs environment/credentials, bounds CPU,
file size, processes, descriptors and wall time, and watches process-group RSS.
macOS lacks an enforced RLIMIT_AS; the RSS watchdog is parent-side. Descendants
escaping their owned process group are outside its guarantee. Both runners kill
and reap their owned group on completion, exceptions and SIGTERM.

```sh
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" \
  node test/modern/isolation-probe.cjs "$SOURCE/package.json"
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" \
  node node_modules/@electron/rebuild/node_modules/node-gyp/bin/node-gyp.js \
  rebuild --directory=app/node_modules/drivelist --target=45.3.1 --arch=arm64 \
  --nodedir="$SCRATCH/headers/node_headers"
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" npm test
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" npm run verify:payloads
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" npm run pack:mac:arm64
python3 "$SOURCE/scripts/run-isolated.py" "$SCRATCH" "$SCRATCH/target" \
  node scripts/verify-package.cjs 'releases/mac-arm64/MZD-AIO Modernization.app'
```

Do not run drivelist's automatic `prebuild-install || node-gyp rebuild`: it can
fetch prebuilds. The explicit native build uses reviewed checksum-verified headers.
`npmRebuild:false` deliberately prevents builder from silently replacing it.
`pack:mac:arm64` uses the local extracted Electron distribution, disables signing
auto-discovery and sets `--publish never`. No signing identity/Keychain access is
required. Payload-specific FileSets preserve even protected `.gitignore` bytes
which electron-builder's normal default filters otherwise drop. Files/opts and
the native binding are ASAR-unpacked; backgrounds/APKs are resources siblings of
app.asar, matching the runtime's resolved paths.

`verify-package.cjs` checks native arm64 executable/binding, plist/app versions,
appId, required ASAR screens/resources, unpacked binding placement, exact protected
payload file inventories/hashes and credential/evidence/test-private names. It
compares against this reviewed source; run `verify:payloads` as well to bind that
source to upstream `409c724ed860497b2a34f9367cb4a019287846ea`. Missing baseline
Git history fails closed. Static checking is **not** the native ABI gate: actual
binding load under packaged Electron is required below.

## 4. Hidden source and actual packaged startup/generation

```sh
python3 "$SOURCE/scripts/run-hidden-isolated.py" "$SCRATCH" "$SCRATCH/target" \
  node test/modern/isolation-probe.cjs "$SOURCE/package.json"
python3 "$SOURCE/scripts/run-hidden-isolated.py" "$SCRATCH" "$SCRATCH/target" npm run test:smoke
python3 "$SOURCE/scripts/run-hidden-isolated.py" "$SCRATCH" "$SCRATCH/target" \
  npm run test:smoke -- 'releases/mac-arm64/MZD-AIO Modernization.app'
```

The self-contained Node test driver invokes the existing main-owned hidden/CDP
harness, rather than maintaining a second Playwright/CDP connection. It requires
actual child exit 0, `HIDDEN_SMOKE_PASS` and a fresh `test-output/hidden-smoke.json`;
a singleton or early-exit zero is not success. It checks initialized Angular,
`#compileButton`, no renderer Node, real renderer/main compilation, native PNG and
native binding load (never drive enumeration), primary/info/joiner/translator
screens, generated ownership manifest/inventory, invalid scalar rejection with old
output preservation and no false success, acknowledged close and collected runtime
exceptions/rejections. Packaged evidence records `app.isPackaged`, ASAR app path,
resources path, Electron version, architecture and native module ABI.

The user authorized launcher-only Chromium **`--no-sandbox` inside the mandatory
outer macOS sandbox**. Production retains `sandbox:true`, contextIsolation:true,
nodeIntegration:false and no disabling startup switch. Do not reuse this exception
outside the isolated test launcher. Production inner-sandbox startup and visual
rendering are unverified. The outer sandbox produces retained Chromium diagnostic
messages (DNS/SystemConfiguration/IOSurface/power notifications); these are not
suppressed or represented as successful visual rendering. Application exceptions
and unhandled rejections must still be empty. No windows are intentionally shown,
no real clipboard/preferences are read, and no physical output is touched.

The reviewed dummy-child regression is runnable separately:
`python3 test/modern/runner-cleanup.py`. It imports only runner code, substitutes a
bounded inert child for the sandbox command and verifies exception/SIGTERM cleanup.
All fixtures are under dedicated scratch. Policy tests mutation-check removal of
the builtin application-root guard using an accessible fixture home; preference
tests inject temp write, sync and rename faults and verify bytes/cleanup/recovery.

## 5. Reproducibility and bundle-preserving ZIP

Prepare a second fresh scratch clone at the same reviewed commit, copy only the
npm cache and verified official archives/headers from setup, and repeat both
`npm ci --ignore-scripts --offline --no-audit --no-fund` inside `run-isolated.py`.
Check both lockfiles remain byte-identical. Extract Electron into an absent dist,
rebuild the native module, run tests/preservation, package, inspect and run actual
packaged smoke again. Do not copy node_modules and call that a clean install.
Create a ZIP without opening the bundle:

```sh
ditto -c -k --sequesterRsrc --keepParent \
  "$SCRATCH/target/releases/mac-arm64/MZD-AIO Modernization.app" \
  "$SCRATCH/MZD-AIO-Modernization-2.8.6-mac-arm64-unsigned.zip"
shasum -a 256 "$SCRATCH/MZD-AIO-Modernization-2.8.6-mac-arm64-unsigned.zip"
```

Keep deliverables under ignored `releases/`, not only prunable scratch; never commit
binaries/evidence or treat local ZIP production as publication. Extract the ZIP to
a fresh scratch directory and compare the entire bundle (including symlink targets,
file bytes and executable permissions) before handoff.

## Dependency and acceptance limitations

Obsolete Standard/Mocha/Chai/dependency-check root tooling and its unused script
entrypoints were removed; `npm test` is the modern Node test suite. Lifecycle
scripts remain disabled. A real npm registry audit after pruning (2026-11-14)
returns **12 root findings: 6 moderate, 5 high, 1 critical**, and **9 app findings:
1 moderate, 3 high, 5 critical**. Root includes electron-builder transitive chains,
lodash/minimatch/minimist and retained legacy build shelljs. App includes appender,
extract-zip, mkdirp/minimist/optimist, lodash, minimatch/brace-expansion and xml2js.
These are unresolved; no blind major/API upgrades or warning suppression were used.
The audit does not cover vendored AngularJS or the permissive inline/eval CSP,
which remain explicit maintenance/security debt. Do not treat the unsigned build
as security-certified, vehicle-ready, notarized or production-release-supported.

The large swap archive remains byte-preserved in the package. Task 5 already
extracted and hashed its actual 1 GiB entry under a separately bounded runner;
Task 6 checks included archive bytes and does not repeat that expansion. Desktop
compilation tests do not execute generated vehicle scripts.
