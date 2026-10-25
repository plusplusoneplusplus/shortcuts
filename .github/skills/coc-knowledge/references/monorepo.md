# Monorepo Layout, Build, and Release

This npm workspaces repository separates reusable Node packages from the CoC
server/dashboard and desktop hosts. Paths below are repository-relative.
See [server architecture](server-architecture.md) for CoC internals.

## Package Boundaries

### Products and libraries

| Workspace under `packages/` | Responsibility / navigation |
|-----------------------------|-----------------------------|
| `coc/` | CLI, HTTP server, dashboard and runtime composition; [server](server-architecture.md), [SPA](spa/shell.md) |
| `coccontainer/` | Messaging-integrated server and native agent/message stores |
| `coc-desktop/` | Private Electron host embedding CoC/CoCContainer servers |
| `coc-client/` | Node/browser REST and realtime client; [clone routing](spa/clone-routing.md) |
| `coc-workflow/` | DAG compiler/executor, scheduling and portable Ralph contracts; [workflow engine](workflow-engine.md) |
| `forge/` | Queue/process stores, Git, policies, connectors and utilities; SDK/workflow re-exports |
| `coc-agent-sdk/` | Providers, sessions, streaming, MCP and models; [SDK](sdk-wrapper.md) |
| `coc-memory/` | Memory stores, search, embeddings, capture and safety; [memory](memory-system.md) |
| `coc-native/` | Rust/N-API capabilities, standalone auth-sdk/teams-sdk, symbol language server and desktop-only Windows x64 WebView2 helper; [native contracts](../../../../packages/coc-native/AGENTS.md) |
| `coc-connector/` | CoC/forge-independent messaging contract with native Teams Azure CLI auth; `/teams` and lazy `/whatsapp` exports; [connector contracts](../../../../packages/coc-connector/AGENTS.md) |

### Node package dependencies

Reusable behavior belongs behind package contracts. Workspace dependencies
resolve through npm symlinks during development; published manifests use
caret ranges or `*`.

## Development

### Commands

Run from the repository root unless noted:

| Command | Scope |
|---------|-------|
| `npm run build` | All workspace builds; `build:packages` and `compile` select the same chain |
| `npm run test` | Root `test:packages` chain; `test:all` aliases it |
| `npm run test:run -w packages/coc -- test/server/<test>.test.ts` | Targeted non-watch CoC tests; other workspaces also expose `test:run` |
| `npm run lint` | Selected workspaces listed in root `package.json` |
| `npm run ensure:native` | Ensure native addon and symbol-server binaries |
| `npm run coc:link` | Build/link the local CoC CLI dependency chain |
| `npm run dev:desktop` | Build/start Electron; build container dependencies first |

Package `test` scripts run Vitest watch mode; `test:run` is non-watch.
The root test chain excludes `coc-connector` and `coccontainer`; test them explicitly
with `npm run test:run -w packages/<name>`. Native integration tests require binaries.
Root lint/coverage covers selected packages; `package.json` is authoritative.

CI audits production, full npm, SkillOpt and Rust dependency graphs.
`scripts/ci-npm-audit.sh` retries npm advisory endpoint failures and permits only
reviewed development advisories without patched releases; production audits
cannot use its allowlist. Regression tests live in `scripts/ci-npm-audit.test.mjs`.

### Dependency order

Root `build:packages` runs:

```text
coc-native -> coc-agent-sdk -> coc-workflow -> forge -> coc-client
-> coc-memory -> coc-connector -> coc -> coccontainer -> coc-desktop
```

Forge's prebuild builds native, SDK, workflow and memory before forge itself.
CoC's prebuild builds those plus forge, client and connector, then emits build
metadata; CoC's build cleans `dist` and compiles/copies the SPA.
See `packages/forge/scripts/prebuild.mjs` and `packages/coc/scripts/prebuild.mjs`.
SDK imports native Git output, so native TypeScript emission must precede SDK.
Desktop packaging needs both server packages built.

### Local runtime

After linking, use `coc serve --no-open`.
CoC and CoCContainer rebuild loops live in
`scripts/coc-serve-loop.sh` / `.ps1` and `scripts/coccontainer-serve-loop.sh` / `.ps1`;
they install dependencies and ensure native binaries before serving.
See [Windows service](coc-service.md) for managed startup.

Use Node.js 24 for development/CI. Published workspaces and the private desktop
manifest declare `engines.node >=24`. Electron is pinned exactly in the desktop
manifest.

## Native and Distribution

### Native build boundary

Core `watch` owns shared canonical-root watchers, workspace subscriptions,
filtering, native recovery and bounded, deduplicated `WatchBatch` events with a
`rescan` flag. The N-API wrapper delivers batches through a bounded, unreferenced
wakeup; TypeScript owns folder layout. Core watch tests receive batches on
channels, while consumer tests inject delivery without filesystem timing.
See the [native batching contract](../../../../packages/coc-native/AGENTS.md#filesystem-watch-batching).

Core `git::patch_store` provides scoped bounded snapshots and shared in-flight processing. Host revisions key resolved object IDs; working-tree snapshots fingerprint fresh Git batches. Host admission binds execution options to ticket cancellation; host and supplied reads share snapshot finalization with per-read truncation and final generation checks. Single-use requests capture generations before I/O/dispatch. Individual cancellation and refresh/disposal stop direct host Git children; live waiters retry cancelled owners' failed computation. Forge `LocalPatchOptions.signal` cancels one request and its WSL transport, preserving the caller's abort reason. Unsent WSL validity polling observes revocation; tickets, listeners and timers retire on every outcome.

`coc-native`'s `build` is TypeScript-only; `build:native` requires Rust and generates
the committed bindings, N-API addon and symbol-server executable. Windows x64
also builds the `coc-webview2` desktop helper with a statically linked loader; other platforms
do not initialize WebView2.
Native builds retain Cargo artifacts and napi-rs's per-crate declaration cache.
Bindings are written only when their contents change. Native build journal handling
and recovery follow the [native contracts](../../../../packages/coc-native/AGENTS.md).
`ensure:native` recursively checks the native Rust tree, including `teams-sdk`,
for stale binaries, and can provision Rust;
`COC_NATIVE_AUTO_INSTALL_RUST=0` disables provisioning.
Production server persistence/index capabilities require the addon and fail
without it, rather than falling back to JavaScript. Supplied unified patches can
be parsed on a libuv worker with `loadNativeGit().parseGitPatch`; Forge
`parseFullDiffAsync` converts native metadata/chunks to public shapes through
`nativePatchToDiff`. PR snapshot fallback metadata uses this async adapter,
including decoded rename paths and empty-file existence; snapshot content transport
and its cache remain separate. Forge `diff-utils` owns wire conversion and
`createPatchDiffProvider`, the five-operation facade shared by local and supplied
remote factories. Each operation reads its loader freshly; per-file loaders retain
literal Git path/context semantics or supplied-hunk selection. Forge's `DiffContent`
and `DiffSummary` alias generated native DTOs. Patch parsing, summaries, truncation
and caches belong to Rust.

Core commit DTOs generate the public `GitCommitFile`/`GitCommitFiles` N-API
objects directly. Host and supplied metadata workers return the same DTOs;
typed Rust statuses generate literal TypeScript unions and absent counts stay omitted.
Forge `GitChangeStatus` aliases the native commit-file status.

REST commit history uses Forge `git/git-history.ts`: host `gitHistory` and supplied
WSL `prepareGitHistory`/`processGitHistory` share Rust command planning and NUL-record
parsing. Routes convert the shared DTO to their author/parent wire shape. The CLI
plan omits decoration and unpushed computation and preserves Git grep/hash selection.
WSL `GitLogService` sets `includeDetails` to retain relative dates and decoration.
Native Git's exported type and runtime capability guard derive from one name tuple.

### Supplied remote diff providers

Forge PR/iteration factories require `RemoteDiffContext` (workspaceId, host, provider-qualified repository) separately from transport routing aliases. `diff/remote-patch.ts` shares scope opening and supplied-read lifetimes with CoC PR routes. Providers retain one lazy Rust store; routes dispose request-owned stores. Continuations capture generations before authenticated I/O, including per-file processing. Refresh/dispose and caller cancellation reject delayed output; every outcome retires tickets/listeners. Rust fingerprints fresh bytes and owns snapshots/truncation. Explicit WSL scopes require distro/Linux-root identity before I/O.

### Production patch consumers

ADO patch construction uses Rust `buildRemoteGitPatch` with explicit existence and
supplied content; authenticated Forge transport reads rename bases at their original
paths and requires successful content reads. Empty existing files stay modified.
CoC `repos/pr-patch.ts` supplies combined/per-file hunks and list statistics through
request-owned Rust remote stores, capturing continuations before authenticated patch
I/O and retiring/disposal on every outcome. Scope includes selected workspace/root,
provider host/repository and PR; ADO uses the effective configured organization.
Transport and scope share one config snapshot. Rootless selections use stateless
Rust processing without inventing a checkout. Quoted paths and exact bytes survive
the HTTP adapter; native-load failures are visible. PR full-context patches use Forge
`loadComparisonPatch` and Rust direct base/head
planning/processing for host and WSL. Core `revision_patch_args` validates and selects
commit/show/range/comparison argv for host execution and worker `prepareGitRevisionPatch`;
Forge passes the same mode/endpoints through either transport. TypeScript retains missing-commit fetch/retry
and provider-hunk fallback. PR list refreshes fetch current provider bytes and convert Rust
summaries directly to diffStats; enriched rows live only in the existing list-response
cache. Combined and per-file hunk routes read current authenticated provider bytes
through the selected clone, including full-context fallback. The commit/range/working-tree
providers and production `GitRangeService` patches, file lists and statistics use
`diff/local-patch.ts`. Range detection derives file rows and uncapped totals from one
Rust snapshot before applying the display cap. Commit, branch-range and working-tree
per-file routes pass display limits into Rust and share `git/git-response.ts` wire
conversion; untruncated responses omit truncation metadata. Host commit/range/comparison patches
come from a per-root Rust `GitPatchStore` keyed by resolved object IDs; the benchmark
shares its range files and summaries.

CoC PR submission injects Forge `pullRequestGit` separately from `gh`/`az`.
Host operations use Rust; WSL uses `runGitViaWsl` with argv `env` overrides.
Default branch: symbolic origin HEAD, remote HEAD (15s, no prompt), then `main`.
Fetch/push: 600s, no prompt. Worktree paths retain WSL identity; provider CLIs
use the caller's checkout. Forge `discoverGitRepoRoot` handles host/WSL discovery
from files or directories.

Full-text working-tree snapshots read object IDs through Forge `readGitBlob`, with
raw bytes, an inclusive size cap and `GitBlobTooLargeError`. Host execution uses
native `gitReadBlob`; WSL uses the streaming byte transport in Forge. Both stop
on overflow and preserve index-only blobs. Binary detection stays in CoC.
Native range capabilities resolve refs and ahead counts. Rust plans/executes host Git and processes
patches, while TypeScript executes the shared plan for WSL. Working-tree all scope combines HEAD-to-index and index-to-disk patches with unstaged metadata overriding shared paths; provider operations read fresh state and batch failures propagate. WorkingTreeService per-file patches and CoC working-tree patch routes also use
this backend with full context; routes apply native truncation and expose native-load
failures as HTTP 500 while retaining empty patches for ordinary Git errors. Full-text
snapshot loaders remain separate. GitLogService commit/pending/staged patches share
the host/WSL backend; commits compare the first parent or empty tree, Rust composes
optional staged/unstaged headings, and ordinary Git failures return empty strings.
Production commit patch
routes use its git-show plan and native truncation without a route patch cache;
first-parent provider and combined-merge route semantics stay distinct. CoC
`createLocalPatchRoute` passes per-request signals through commit, branch-range and
working-tree patch reads; aborted requests or unfinished response close cancel host/WSL
work without disposing shared stores. GET-body close is not cancellation. Listeners
retire on every outcome and abandoned results/errors are not delivered. Range metadata
orchestration checks cancellation between reads and preserves abort reasons.
Commit metadata
uses Forge `loadCommitMetadata` for GitLogService file details and `loadCommitFiles`
for route rows. Rust plans/joins NUL-delimited metadata and ordered parent output
for host and WSL, preserves Git ordering and absent binary counts, and reads fresh
state without a route metadata cache. Root file lists include initial additions. Native contracts
and migration boundaries belong in the native instructions below.

`rust/auth-sdk` shares the native Cargo workspace/lockfile and release/audit gates.
It is independent of Node; its Microsoft module provides immutable source-pinned
OAuth/Azure CLI providers and explicit PKCE/device sign-in. The addon exposes
`MicrosoftTokenProvider` and `MicrosoftOAuthSignIn` through `src/auth.ts`.
`exchange_refresh_token` shares the Microsoft transport/parser and
accepts caller-owned refresh secrets without account metadata or storage access;
native OAuth acquisition retains discovery, identity checks and locked persistence.
`exchangeMicrosoftRefreshToken(options, refreshToken, signal?)` exposes it through
an isolated one-shot native handle, with generated DTOs, bounded cancellation and
safe SDK-code/status/terminal-rejection diagnostics. It returns endpoint expiry
seconds and optional reported scope/rotation, without ID tokens.
The generic non-Teams Node refresher owns its timer, scope policy and Copilot cache.
Kusto, ADO and Teams Azure CLI authentication use native providers. Forge's ADO
resolver shares a source-pinned provider per host data directory across PR and
Azure Boards callers, with native caching/renewal and host shutdown disposal.
ADO identity lookup uses the current bearer token and organization; bearer tokens
are not persisted by TypeScript. The Teams connector owns one lazy provider per
connection/resource and delegates every credential read to the SDK; Graph/IC3
retain resource authorization and MCP-account matching. Native credential acquisition
and each hybrid Graph writer/reader startup acquisition share a thirty-second budget; outbound writes keep
their ten-second total deadline. Standalone Graph startup,
polling and writes share a provider. Teams MCP OAuth uses the connector's
host/resource-scoped `TeamsOAuthCredential`: Rust owns browser sign-in, verified
identity, OS refresh credentials and demand renewal. TypeScript stores only the
verified account descriptor and configuration binding under the host data directory.
CoC and container production callers do not import or refresh Copilot's OAuth cache.

`auth_sdk::github` owns read-only Copilot config/OS and GitHub CLI acquisition;
`src/github-auth.ts` exposes isolated one-shot cancellation without caching or
refresh. Copilot RPC, environment/custom resolvers and service authorization
stay in TypeScript. See the native instructions for exact-key and platform contracts.
Shared types, storage and lifecycle remain
vendor-neutral. Protocol/security contracts belong in the
[crate documentation](../../../../packages/coc-native/rust/auth-sdk/README.md).

`rust/auth-cli` is the standalone Cargo `auth-cli` binary over auth-sdk, installed
with `cargo install --locked --path auth-cli` from the native workspace. Its
vendor dispatcher supports Microsoft `login` through Azure CLI and resource-only
`token` (`get-access-token` alias) that pins the selected CLI account into the SDK.
Direct browser/device OAuth and source-specific token commands accept explicit
configuration. Output is JSON Lines with masked secrets;
`--show-secrets` reveals full output with a warning. It shares Rust CI/audit gates,
does not migrate consumers, and is not bundled into Node or desktop installers.
See [CLI usage](../../../../packages/coc-native/rust/auth-cli/README.md).

`packages/coc-native/rust/teams-cli` is a standalone Cargo workspace project providing
the `teams-cli` chat CLI through `teams-sdk`. It shares the native lockfile and CI gates
and always includes MCP and IC3/Trouter; Graph is a default feature.
It is installed separately with `cargo install --locked --path teams-cli` from the
native Rust workspace. Usage and authentication contracts belong in the
[Teams SDK instructions](../../../../packages/coc-native/rust/teams-sdk/AGENTS.md).
The addon's `src/teams.ts` exposes native Azure CLI-backed IC3 reads; see the
[Teams boundary contract](../../../../packages/coc-native/AGENTS.md#teams-capability).

The loader accepts `COC_NATIVE_PATH`, local binaries and target-specific prebuilts.
N-API binaries work in Node and Electron. Desktop packaging unpacks native
artifacts and agent runtimes from `app.asar`; bundled Codex/Claude directories
augment the server child's `PATH`. Capability details belong in the
[native instructions](../../../../packages/coc-native/AGENTS.md) and
[language-server reference](language-servers.md).

### Desktop hosts

`packages/coc-desktop/src/server-controller.ts` attaches to a healthy server or
forks one on the preferred port, using an ephemeral port when occupied.
A forked server has 120s (`DEFAULT_START_TIMEOUT_MS`) to report `listening`;
child errors/exits fail earlier, and failures kill the child.
`test/server-controller.test.ts` covers that window with fake timers. Windows CI
also runs `test/e2e/desktop-startup.e2e.test.ts` (opt-in via
`COC_DESKTOP_STARTUP_SMOKE=1`): the source-built app launches in a sandboxed
home/log/user-data dir, `COC_DESKTOP_TEST_SERVER_START_DELAY_MS` (read only by
`server-entry` via `startup-delay.ts`; unset → no delay) holds the real server
back 45s, and the test requires the seeded server identity, the rendered SPA
and a clean process-tree kill. Failed runs upload the sandbox.
CoC defaults to 4000; CoCContainer defaults to 5000 and shares `~/.coccontainer`
with its CLI. Enabled Windows DevTunnel hosting prefers a configured tunnel's
single HTTP binding. The hosts use separate tunnel identities.
`packages/coc-desktop/electron-builder.container.cjs` selects the container variant.

`coc-desktop/src/update-install.ts` provides Electron-free installer downloads for
CoC macOS arm64 and Windows x64. It requires the selected installer's exact
`.sha256` release asset, streams bytes to a private temp directory with progress
callbacks, and verifies SHA-256 before returning an installer path. Fetch and
filesystem seams support plain Node tests. Failure or abort removes the attempt's
directory; successful downloads expose caller-owned cleanup for deferred installs.
`update-install-mac.ts` rejects translocated, disk-image and unwritable bundle
locations. It mounts the DMG readonly, stages beside the destination, and detaches
before returning a detached helper launch plan. The helper waits for the old PID,
swaps bundles with rollback, clears quarantine when present, and relaunches.
Successful installation removes staging/downloads; helper failures retain an
`install-error.txt` diagnostic and reopen the restored app. Failed detach preserves
the mount directory for safety. `update-install-win.ts` launches a detached,
hidden PowerShell helper that waits for the old PID before starting NSIS, avoiding
NSIS process termination during shutdown. It uses `/S --force-run` and a final,
unquoted `/D=` argument for the current executable's directory. Installer failures
retain `install-error.txt` and reopen CoC; success removes downloads. Encoded
PowerShell commands carry quoted path literals.

`update-coordinator.ts` owns the user-requested download/restart lifecycle through
injected UI and installer hooks. One process-wide instance coalesces clicks,
reports determinate or indeterminate progress, retains verified bytes for Later
or cancelled restarts, and discards a retained release before replacing it. It
checks restart confirmation before installation and transfers file ownership to
the helper before quitting. Failures report their reason and offer the existing
`pickDownloadUrl` browser path. `dispose()`, called from `before-quit` alongside
browser disposal, aborts a download, removes deferred bytes and suppresses
further dialogs/installs; bytes being handed to a helper stay. The hooks accept an owned-server check, helper
launch and normal quit drain. `update-restart.ts` implements the restart check:
it queries the owned server's unfiltered `GET /api/queue` with a ten-second
timeout, counts `running` across all workspaces, and requests confirmation only
for a nonempty list. Attached or absent servers bypass the check. Invalid or
unavailable queue data rejects restart; cancellation retains verified bytes.
`main.ts` shares one coordinator across windows and connects platform helpers,
normal quit, window progress bars and the native menu. `update-ui.ts` supplies
injected native release, Restart/Later, running-count confirmation and failure
dialogs.

Release and retained-download dialogs offer an independent system-browser
download through `shell.openExternal`, also available after automatic-update failures.
`pickDownloadUrl` resolves the selected channel's release asset by platform and
architecture, excluding container installers, with the same release page as fallback;
manual downloads require no checksum or updater availability. `update-ui.ts` validates
HTTP(S) URLs with `validateBrowserUrl` and displays browser-opening failures.

Only Update starts the automatic download; Skip, Later and channel selection retain
their check semantics. Native dialogs own keyboard access, theme and layout.
Downloading disables the menu action and displays progress. A retained download exposes Restart to update
and bypasses release fetching when reopened, including offline.
`update-recovery.ts` writes `<userData>/pending-update.json` (release, download
directory, macOS staging) before helper launch and removes it if launch fails.
Packaged launches inspect it before the auto check: `install-error.txt` shows the
reason with browser fallback; a removed download directory is success; a present
directory younger than one hour is still installing and left untouched. Recovery
removes macOS staging only when `image` is empty and `previous.app` is absent.

URL hosts expose optional `BrowserHostedView.cdp(method, params)`. Electron's
`ElectronBrowserCdp` lazily attaches to the adopted guest debugger and detaches
its own attachment on close and retains the debugger emitter for destruction-safe
listener cleanup. Pending calls reject on destruction, crash, detach
or a 60-second timeout and retire timers/listeners. WebView2 forwards owner-qualified
requests to Rust `CallDevToolsProtocolMethod`, returning correlated JSON and rejecting
on tab/helper close or crash. Native navigation reserves loading before dispatch and
publishes state before acknowledgement; matching completion or committed
same-document source changes settle readiness. Correlated native popup events register
hosted handles in the root tab's owner/workspace; popup state stays independent. Close/crash retires
popup handles and requests, root close/crash retires descendants, and helper disposal
removes owner listeners. CDP timeouts retire individual requests. File previews
omit CDP; the primitive has no renderer IPC surface by itself.

`BrowserHostManager.executeControl` resolves owner-qualified URL tabs and popouts
through an exact-source SPA main frame's workspace/session binding. Typed preload
commands expose no arbitrary CDP. `withControlPage` checks the selected view's identity;
its `BrowserControlQueue` retains one page across navigation and serializes whole
input sequences. Turn abort, close, crash or 60 seconds including queue time reject
callers. Cancellation keeps outstanding CDP serialized, releases dispatched presses
and retains late snapshot counters. Every driven view receives owner-qualified,
factory-stable turn activity, including remembered selections across SPA windows.
Native popouts use trusted, viewport-reserving chrome: Electron's separate sandboxed
toolbar admits exact-source Stop IPC; WebView2 uses native controls. Stop routes to
the source conversation. Visibility is keyed by routing owner and concrete clone
reference; token-qualified completion cannot erase or restore another turn.

`browser-control-page.ts` shares snapshots, trusted input, waits, markdown reads,
eval and cropped inline JPEG capture across engines. macOS replacement uses CDP's
`selectAll` editing command; native dropdowns use bounded trusted typeahead with
exact-value verification, while list boxes use Home/arrow input. Dropdown options
without searchable labels fail explicitly. Its monotonic counter seeds
self-contained DOM/ARIA maps covering same-origin frames and open shadows.
Navigation and inaccessible frame documents expire refs. Targets scroll and translate
frame bounds before input; screenshots account for pixel ratio. Large snapshots stage
complete JSON in the page and transfer 64000-character chunks, retaining complete
baselines and ref counters. Read pages and eval JSON are bounded before CDP.
WebView2 caps native CDP replies at 900000 bytes; transport rejects/drains oversized
individual replies and rejects oversized writes without killing unrelated views.
Live fixtures exercise large results, cross-window turns and native-popup Stop
through the parser/tool/WebSocket/SPA/preload/main/CDP chain. Desktop CI builds server/SPA
artifacts and runs the workflow on Linux/macOS and Windows WebView2; feature admission
uses default-off `browserControl.enabled` ([tools](llm-tools.md)).
Linux native-frame assertions require a window manager on the isolated display;
framed control windows are mapped before measuring decoration extents. Relay
fixtures dispose browser views while the owner window remains alive, close active
HTTP connections, and report success only after server shutdown.

### Container image

The root `Dockerfile` ships the CoC server, distinct from the `coccontainer`
workspace. It runs as uid 1000 with `HOME=/data`, data at `/data/.coc`, and `tini`
as PID 1. The server binds `127.0.0.1:4000`: no `EXPOSE` or published CoC port.
Use host networking or an authenticated same-network-namespace sidecar
(`deploy/tenant/`). `docker/entrypoint.sh` owns optional first-boot seeding.

Build/dependency stages separate host-platform JavaScript compilation from
target-platform production dependencies. Release CI stages Linux native prebuilts;
the image does not compile Rust. New workspaces need manifest `COPY` entries
in both install stages. `BUILD_COMMIT` feeds `COC_BUILD_COMMIT` when `.git` is absent.
Docker contracts live in `packages/coc/test/docker/`.

## Versioning and Release

### npm and runtime contracts

All workspaces except private `coc-desktop` have public npm configuration under
`@plusplusoneplusplus`. Changesets uses independent versions, `main` as base, and
patch updates to internal dependencies (`.changeset/config.json`).
`npm run changeset` adds a changeset; `npm run version-packages` applies it.
`npm run publish-packages` builds its selected packages, then invokes `changeset publish`; it is not the complete root build chain.
npm publication is manual, separate from installer/image release CI.

Root and consuming manifests pin Copilot SDK `1.0.9`; the root override pins
Copilot CLI `1.0.78`, with matching platform packages in `package-lock.json`.
SDK child processes set `COPILOT_AUTO_UPDATE=false`.
CoC build metadata uses the root package version and Git commit, with
`COC_BUILD_COMMIT` overriding commit discovery; the CoC package version is distinct.

### GitHub release workflow

`.github/workflows/release.yml` handles stable/prerelease version tags and manual
dispatch for an existing tag. It copies tag semver into the desktop manifest for
packaging. Stable releases are drafts; prereleases are published as prereleases.
Public downloads are CoC macOS DMG and Windows NSIS installers with mandatory
`<installer>.sha256` sidecars computed from the installer bytes in the release
job. The job first replaces spaces in installer names with dots (GitHub's upload
naming), so sidecars name the exact asset the updater downloads; they use
standard SHA-256 output with asset basenames. CoCContainer
installers and loose native binaries are excluded.

Release CI audits dependencies and builds/tests native artifacts for Linux,
macOS and Windows on x64/ARM64; installers stage their matching target.
The parallel Docker job publishes `ghcr.io/plusplusoneplusplus/coc` for
Linux amd64/arm64: stable tags get version, major.minor and `latest`; prereleases
get the full prerelease version. GitHub release creation depends on installer
jobs, not Docker. Image smoke checks require both native file and Notes indexes.
CI lives in `.github/workflows/ci.yml`.

## Workspace and Origin Boundaries

### Storage versus execution

Multi-workspace support is required. Workspace-specific data uses
`~/.coc/repos/<workspaceId>/` and
`getRepoDataPath(dataDir, workspaceId, filename)`, re-exported by
`packages/coc/src/server/paths.ts`. Do not add top-level per-repo directories.
Same-origin clones share work items and PR state under `repos/<originId>/`;
the concrete workspace still selects checkout, queue and execution.
See [server storage](server-architecture.md#storage-layout) and
[work items](spa/work-items.md).

### Canonical identity and mutations

`packages/forge/src/git/origin-id.ts` supplies synchronous, browser-safe origin
IDs: `gh_<owner>_<repo>`, `ado_<org>_<project>`, `git_<remoteHash>`, and
`local_<workspaceId>`. Server and SPA share this resolver.
`computeRemoteHash()` in `packages/forge/src/git/remote.ts` has separate,
protocol-sensitive semantics; do not substitute it for canonical identity.

Work-item storage mutations use `/api/origins/:originId/work-items` and the
server's command/write-queue boundary, never direct JSON writes.
Execution supplies a concrete workspace. Route ownership is in
`packages/coc/src/server/routes/work-item-routes.ts`; cross-server client routing
belongs in [clone routing](spa/clone-routing.md).
