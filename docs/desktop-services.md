# Desktop service / IPC handoff (Task 4A)

This is a pure boundary, not application startup or completed Task 4. Task 4B owns
Electron adapters, native drive replacement, preload, windows, menus and browser
migration. No Electron or native dependency is imported by these modules.
Independent interface approval belongs to the controller's review gate.

## Main-owned configuration

`require('./desktop/services')` exports `createDesktopServices(trustedAdapters)`,
`registerServiceIpc(options)` and deeply frozen `SERVICE_INTERFACE`.

Construct one service **per owned window**. Do not share chooser grants across
windows. `trustedAdapters` is main configuration, never renderer input:

```js
{
  imageParent, // absolute, existing, main-owned writable staging parent
  policyOptions, // optional trusted { home, resourceRoots }; policy.js semantics
  dialogs: {
    chooseOutputDirectory: async () => absolutePathOrNull,
    chooseImage: async kind => absoluteFilePathOrNull
  },
  images: {
    resizeToPng: async ({ source, width, height }) => nonemptyBuffer
  },
  files: {
    writePng: async ({ directory, filename, data }) => undefined
  },
  drives: { list: async () => nativeDriveRecords },
  window: {
    setFullscreen: async enabled => undefined,
    print: async () => undefined
  },
  external: { open: async validatedHttpsUrl => undefined }
}
```

Dialogs return **null** for cancellation, not undefined, arrays or Electron dialog
response objects. Adapters normalize modern Electron responses. A choice does not
create directories, change preferences or set the compilation output. Output
selection resolves through reviewed `resolveOutputDirectory` and returns the
canonical `<chosenParent>/_copy_to_usb` path only.

Image output is always `<imageParent>/_copy_to_usb/<fixed filename>`, not the
renderer-selected compilation destination. Policy validates/revalidates this
parent and existing output target. Main must provision a dedicated safe writable
staging parent outside payload/resources and outside the home directory itself.
4B/5 must update compiler/preview consumers to use returned `destination`; do not
silently assume the old `<userData>/background/<filename>` layout. The names are
preserved: `background.png`, `OffScreenBackground.png`, `no_artwork_icon.png`.

`resizeToPng` must decode the selected file, reject empty/invalid native images,
call the equivalent of legacy `nativeImage.resize({width, height}).toPNG()`, and
return a PNG Buffer. Both dimensions are supplied; no new crop/cover/contain step
is introduced. Background/offscreen are 800x480; album is 146x146. The pure service
checks nonempty Buffer shape, not PNG decoding; unit fixtures are inert bytes.

`writePng` is a **trusted narrow writer**, not arbitrary filesystem IPC. It must
create/use the validated staging directory without following replaced symlinks,
atomically replace the fixed file without following its old leaf, await success,
and propagate errors. Service checks existing symlink/non-file leaves and
rechecks output policy after async decoding; these checks are not an OS-level
reservation or a proof against hostile concurrent local filesystem changes.
Likewise the source is canonicalized and file identity/size/mtime are rechecked
before native decoding; the real reader must address concurrent replacement if
that is in the threat model. No race-free native reader/writer is claimed in 4A.

## Service methods and transport

All methods return Promises. They either resolve as below or reject with an Error;
there is no success-shaped failure, fallback host or unsolicited service event.
Native failures propagate. Electron invoke exposes a rejected Promise (do not
rely on preserving Error `cause`/custom fields across Electron).

| Method | Invoke channel | Exact positional arguments | Result |
|---|---|---|---|
| `chooseOutputDirectory()` | `aio:choose-output-directory` | none | canonical output path or null |
| `chooseImage(kind)` | `aio:choose-image` | `kind` | opaque one-use source token or null |
| `resizeImage({kind, source})` | `aio:resize-image` | one exact two-key request | `{kind, destination, width, height}` |
| `listDrives()` | `aio:list-drives` | none | eligible serializable records |
| `setFullscreen(enabled)` | `aio:set-fullscreen` | boolean | undefined |
| `print()` | `aio:print` | none | undefined |
| `openExternal(url)` | `aio:open-external` | URL string | undefined |
| `downloadLegacy()` | `aio:download-legacy` | none | always rejects disabled-feature Error |
| `updateLegacy()` | `aio:update-legacy` | none | always rejects disabled-feature Error |

`SERVICE_INTERFACE` maps each method to `{channel, args: [argumentNames...]}`.
Preload must expose named methods, not a generic invoke/channel or dispatch API.
Do not expose adapter objects, Node require/process, filesystem paths as read
capabilities, shell, formatting, vehicle operations or the raw Electron transport.

Image kinds are exactly `background`, `offscreen`, `album`. Token authorization
is service-instance-local and kind-bound. A successful newer choice revokes the
older token for that kind; cancellation preserves the previous token. Valid
attempts consume tokens before decoding/writing (also on native failure); wrong
kind or unauthorized attempts do not consume valid grants. A caller never submits
a source pathname to acquire file-read permission. Returned destination paths
are display/compiler results, not new arbitrary-read grants.

Drives are filtered with reviewed `isEligibleDrive`: `isSystem === false`,
`isRemovable === true`, nonempty safe absolute mountpoints. Return shape:
`{device: string, description: string, isSystem: false, isRemovable: true,
mountpoints: [{path: string}]}`. Missing textual metadata becomes empty strings;
unknown native fields and capabilities are stripped. Enumeration remains a
trusted 4B adapter; this list grants no raw-disk operation. External URLs use
`validateExternalUrl` (reviewed HTTPS github.com only, no credentials/custom port).

## Owned-window IPC registration

Call once for all owners, after constructing per-window services:

```js
registerServiceIpc({
  ipcMain,
  service: primaryService,
  getWebContents: () => mainWindow && mainWindow.webContents,
  indexPath: absolutePrimaryIndexPath,
  capabilities: Object.keys(SERVICE_INTERFACE), // explicit main decision
  additionalScopes: [{
    service: translatorService,
    getWebContents: () => translatorWindow && translatorWindow.webContents,
    indexPath: absoluteTranslatorPagePath,
    capabilities: ['print'] // example only; actual grants need 4B review
  }]
})
```

`additionalScopes` defaults to `[]`; every scope must explicitly supply a unique
list of valid method names. Empty lists grant nothing. Channels are registered
once for the union of capabilities, routing to the matching owned window service.
Each invocation first requires exact webContents identity, its exact mainFrame
object, `file:` with no host, and the exact configured local file path. Query and
fragment handling is unchanged from the preference seam. A secondary page is not
trusted merely because it is a local file or because it navigates to the primary
page. It cannot use a method granted only to the primary owner. Exact argument
counts precede service payload validation; adapters are never called on rejection.
Use distinct owners in scopes, with a stable getter that returns the current
window or null, never one derived from the IPC sender. Scope configuration must
not be mutated from untrusted input.

`ipc-sender.js` exports `createSenderGuard({getWebContents, indexPath})`, returning
`guard(event): URL` or throwing. `preferences-ipc.js` now uses this identical seam;
its registration signature, channels and strict primary-index boundary remain
unchanged. Secondary service capabilities do **not** grant preferences access.

## Remaining migration obligations

- 4B: real dialogs/native image/writer/window/printing/external/drives adapters;
  no unchecked native imports or rebuilds in this pure task. Verify actual native
  resize output, cancellation and failure UX in hidden-window tests.
- Wire context-isolated preload/browser calls, disable Node integration, remove
  old unsafe IPC routes and automatic update/download/crash-upload paths. These
  new disabled channels alone do not remove legacy routes still in app/main.js.
- Main-issued built-in image selection, joined-background/no-resize, theme-folder
  imports, clipboard, child-window navigation and menu actions need separately
  scoped typed endpoints if retained. Never restore generic Node/IPC access.
- Renderer-close preference flush/cache refresh, translator/speedo storage,
  compiler file access and all startup/runtime verification remain 4B/5 work.
- Keep vehicle/bundled payload bytes intact. AngularJS remains unsupported.

## Task 4B runtime integration

`main.js` now composes the reviewed services with `native-adapters.js`. All
windows are main-owned, use the fixed `preload.js`, `nodeIntegration:false`,
`contextIsolation:true`, `sandbox:true`, and deny child windows/webviews and
navigation away from their exact owned file. Native menu zoom roles replace
renderer Menu/remote access. Automatic legacy services are not initialized;
non-local subresource requests are denied. No renderer compiler is loaded.

The primary `index.html` owns the preference protocol and all reviewed
`SERVICE_INTERFACE` capabilities. The independent `info.html` receives only
`secondary-bootstrap`; `joiner.html` receives only `secondary-bootstrap`,
`joined-image`, `save-joined-image`, and `background-rotator`. A secondary page
cannot acquire preference access by navigating to index.html. Scoped handlers
validate owner, exact main frame/file, capability, and positional argument count
before calling native adapters. Renderer subscriptions strip Electron events and
return exact unsubscribe functions.

Additional preload-to-`aio:` channel mapping (arguments in parentheses):

| Preload method | Channel suffix |
|---|---|
| resetWindow() / openScreen(screen) | reset-window / open-screen |
| secondaryBootstrap() | secondary-bootstrap |
| selectBuiltinImage(name) | builtin-image |
| chooseJoinedImage() / saveJoinedImage(pngDataUrl) | joined-image / save-joined-image |
| setBackgroundRotator(images, seconds) | background-rotator |
| chooseTheme() / revealFolder(name) | choose-theme / reveal-folder |
| readClipboardText() / writeClipboardText(text) | clipboard-read / clipboard-write |
| loadEditor(name) / saveEditor(name, value) | editor-load / editor-save |
| importEditor(name) / exportEditor(name, value) | editor-import / editor-export |
| loadMessages() / saveMessages(language, messages) / resetMessages() | messages-load / messages-save / messages-reset |
| compile() | compile (explicit Task 5 rejection, no generated output) |
| acknowledgeFlush(token, errorOrNull) | flush-ack |

Names are fixed enums, never paths: editor `translator|speedo`, screen
`info|joiner`, built-in image `background|offscreen|album|transparent`, and reveal
folder `output|defaults|downloads|apk`. Theme selection yields an opaque token and
label, not a general path capability. PNG data is decoded by nativeImage; joined
images retain their dimensions. New persistence/staging is outside bundled
payloads. Main emits `aio:image-staged` for primary preview updates and
`aio:preferences-changed` for native output/rotator changes; browser caches flush
queued writes before refresh. Close/quit requests wait for a token-bound renderer
flush acknowledgement and the visits write before destruction; timeout or failure
leaves the window open rather than reporting saved state.

### Hidden isolated test gate

`MZD_AIO_TEST=1` requires explicit isolated `MZD_AIO_TEST_USER_DATA` and
`MZD_AIO_TEST_OUTPUT`. It never shows windows, menus/tray or native choosers, reads
real preferences, enumerates drives, prints or launches external applications.
Chooser cancellation is the only test dialog result; native decode/staging and
native binding load are real, while enumeration/printing/external effects reject.
Main-owned test CDP captures uncaught exceptions and unhandled rejections before
page load. The smoke deliberately injects distinguishable diagnostics to prove
that collection works, then removes only those injected markers.

Use `scripts/run-hidden-isolated.py SCRATCH WORKDIR COMMAND [ARGS...]` only with
a reviewed dedicated copy below Hermes scratch. Before Electron, run that runner
with `node test/modern/isolation-probe.cjs PRIVATE_CHECKOUT/package.json` and
require EPERM for private read, outside write and external connect plus successful
scratch writes. Its mandatory outer macOS deny-default profile scrubs credentials,
permits scratch-only writes, denies private home reads/external network, and has
narrow process-specific Electron mach/AppKit/font allowances. CPU/file/process/time
limits and a process-group RSS watchdog bound execution and cleanup.

The user approved **test-only** `--no-sandbox` injection by this runner for the
scratch Electron executable, because Chromium cannot reinitialize an inner
sandbox inside this outer macOS sandbox. Ordinary app startup/build configuration
contains no disabling switch and retains sandbox:true. This smoke does **not**
validate production Chromium inner-sandbox enforcement or visual rendering.
The final success requires exit 0 **and** `HIDDEN_SMOKE_PASS` plus the generated
`hidden-smoke.json`, not exit 0 alone.

### Explicit later gates

Task 5 must extract the preserved legacy `build-tweaks.js` into main-owned compiler
operations, consume staged images/theme grants, rotator metadata and edited XML,
restore compile-only file replacement/deletion/appender/copy/unzip/line-ending/log
steps, and verify generated package correctness. No Node restoration is allowed.
Task 6 owns packaged resource layout/native provisioning and final packaging gates.
AngularJS and existing permissive inline/eval CSP remain maintenance/security debt;
this integration is not a claim of complete application or vehicle readiness.
