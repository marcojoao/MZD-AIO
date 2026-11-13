# MZD-AIO desktop modernization

## Intent

The owner already uses MZD-AIO with a Mazda CX-3. The immediate objective is to modernize the old desktop project and make it work again. Vehicle installation compatibility is not a prerequisite for desktop development. Existing vehicle installations must remain untouched.

## Initial evidence

The inspected upstream revision is `409c724ed860497b2a34f9367cb4a019287846ea`. The project declares Electron 6, Node 13, AngularJS, electron-builder 21, native drivelist dependencies, and Spectron integration tests. Root and application manifests duplicate dependencies. The main process uses legacy Electron APIs, enables renderer Node access, uploads crash reports automatically, and contains HTTP download endpoints. Publishing configuration references Bintray. The existing integration test assumes a visible, focused application window.

No dependency installation, application execution, vehicle script execution, or USB write has occurred during discovery.

## Approaches

1. **Incremental desktop modernization, recommended.** Preserve the existing interface and vehicle payloads. Update the runtime, repair compatibility boundaries, replace obsolete tooling, and add meaningful checks. This offers the shortest path to preserving existing behavior without a full rewrite.
2. **Full interface rewrite.** Replace AngularJS and redesign the desktop architecture immediately. This expands migration risk and delays a working build, so it is outside this first milestone.
3. **Freeze an old runtime.** Reproduce the original environment without modernization. This may help diagnosis but does not satisfy the requested outcome.

## Scope and architecture

The first milestone targets the current Mac, including native Apple Silicon packaging. Windows and Linux configuration should remain coherent, but their execution is not claimed without testing on the relevant platform.

Keep the existing screens and selection workflow. Separate privileged desktop operations from renderer code through explicit, validated IPC boundaries. Move privileged renderer calls to a preload bridge as needed to run with context isolation and without renderer Node integration. Block unexpected navigation and new windows. Do not replace AngularJS in this milestone; report its remaining maintenance risk explicitly.

Use a currently supported stable Electron runtime and compatible build tooling, selected from official release information during implementation planning. Pin reproducible dependency resolutions and explicitly declare the supported Node environment. Inspect lifecycle scripts before installation. Remove obsolete Spectron and development tooling where replacement is required.

Disable legacy automatic updating, automatic crash uploads, and unverified remote downloads by default. Required unavailable assets must produce actionable errors instead of silently contacting replacement hosts. Do not guess replacement domains or distribute unverifiable vehicle payloads.

Preserve vehicle scripts and bundled payload bytes. Any discovered vehicle-side issue is documented for a separate review, not silently corrected here.

## Data flow

User selections remain in the existing UI. A narrow preload API forwards validated requests to the main process. The main process performs approved filesystem and image operations. Package compilation writes into an explicitly selected output directory. Tests use scratch directories and fixtures, never mounted USB drives or an existing installation.

The USB chooser must only expose eligible external drives. Tests inject drive listings and never modify physical devices. No raw disk writes, formatting, vehicle connections, or firmware installation are part of this milestone.

## Error handling

Startup errors must be observable in logs and smoke-test results without opening dialogs during automated checks. Invalid selections, missing assets, cancelled dialogs, and invalid output paths must fail clearly without deleting unrelated files. Legacy network features must explain that they are disabled rather than failing with misleading connection errors.

## Verification and acceptance

- A documented clean install completes with a reproducible dependency lock.
- Tests run without launching a visible window or stealing desktop focus.
- A hidden-window startup smoke test loads the application, verifies the expected main UI, and records renderer and preload errors.
- Automated checks exercise preference handling, output-path validation, mocked drive discovery, and representative compilation behavior.
- A representative package is generated only in scratch storage, with its manifest and required output files verified. This is desktop output validation, not evidence of vehicle compatibility.
- Vehicle payload preservation is checked against the upstream revision using exact byte comparisons or hashes.
- An Apple Silicon application package is produced and checked for the expected executable architecture and resources. Unsigned output is identified as unsigned; distribution signing is not implied.
- Results distinguish unit tests, hidden-window execution, package construction, and untested physical hardware behavior.

## Security and execution constraints

Review downloaded code and lifecycle scripts before execution. Run untrusted application tests in an isolated scratch copy with a scrubbed environment, blocked external network access, and constrained filesystem writes. Do not expose GitHub credentials, SSH keys, or existing application preferences to the test process. Dependency downloads are a separate, controlled setup step.

Do not open visible browsers or application windows. Do not publish a GitHub fork, release, pull request, or package without a separate request.

## Explicit exclusions

Firmware updates, new firmware support, vehicle installation, physical USB writes, new tweaks, Android Auto protocol modernization, a complete AngularJS rewrite, and Windows/Linux runtime certification are excluded from this first milestone.

## Review handoff

This specification captures the requested desktop-first scope. Implementation planning starts after the owner approves this written specification. The implementation plan will select exact runtime versions, identify affected modules, define test fixtures, and split the migration into independently verified changes.
