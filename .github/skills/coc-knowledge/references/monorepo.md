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
| `deep-wiki/` | Independent wiki-generation CLI; CoC can invoke it as a child process; [pipeline](deep-wiki.md) |
| `coc-client/` | Node/browser REST and realtime client; [clone routing](spa/clone-routing.md) |
| `coc-workflow/` | DAG compiler/executor, scheduling and portable Ralph contracts; [workflow engine](workflow-engine.md) |
| `forge/` | Queue/process stores, Git, policies, connectors and utilities; SDK/workflow re-exports |
| `coc-agent-sdk/` | Providers, sessions, streaming, MCP and models; [SDK](sdk-wrapper.md) |
| `coc-memory/` | Memory stores, search, embeddings, capture and safety; [memory](memory-system.md) |
| `coc-native/` | Rust/N-API capabilities, symbol language server, teams-sdk and desktop-only Windows x64 WebView2 helper; [native contracts](../../../../packages/coc-native/AGENTS.md) |
| `coc-connector/` | Dependency-independent messaging contract; `/teams` and lazy `/whatsapp` exports; [connector contracts](../../../../packages/coc-connector/AGENTS.md) |

### Node package dependencies

Reusable behavior belongs behind package contracts. Workspace dependencies
resolve through npm symlinks during development; published manifests use
caret ranges or `*`. Deep Wiki's publishing build bundles its CLI source and
selected dependencies while externalizing packages such as forge and coc-native;
see `packages/deep-wiki/esbuild.config.mjs`.

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
| `npm run deep-wiki:link` | Link Deep Wiki; build shared dependencies first |
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
-> coc-memory -> coc-connector -> coc -> coccontainer -> deep-wiki -> coc-desktop
```

Forge's prebuild builds native, SDK, workflow and memory before forge itself.
CoC's prebuild builds those plus forge, client and connector, then emits build
metadata; CoC's build cleans `dist` and compiles/copies the SPA.
See `packages/forge/scripts/prebuild.mjs` and `packages/coc/scripts/prebuild.mjs`.
SDK imports native Git output, so native TypeScript emission must precede SDK.
Desktop packaging needs both server packages built.

### Local runtime

After linking, use `coc serve --no-open` or `deep-wiki generate <repo>`.
CoC and CoCContainer rebuild loops live in
`scripts/coc-serve-loop.sh` / `.ps1` and `scripts/coccontainer-serve-loop.sh` / `.ps1`;
they install dependencies and ensure native binaries before serving.
See [Windows service](coc-service.md) for managed startup.

Use Node.js 24 for development/CI. Published workspaces and the private desktop
manifest declare `engines.node >=24`. Electron is pinned exactly in the desktop
manifest.

## Native and Distribution

### Native build boundary

`coc-native`'s `build` is TypeScript-only; `build:native` requires Rust and generates
the committed bindings, N-API addon and symbol-server executable. Windows x64
also builds the `coc-webview2` desktop helper with a statically linked loader; other platforms
do not initialize WebView2.
`ensure:native` recursively checks the native Rust tree, including `teams-sdk`,
for stale binaries, and can provision Rust;
`COC_NATIVE_AUTO_INSTALL_RUST=0` disables provisioning.
Production server persistence/index capabilities require the addon and fail
without it, rather than falling back to JavaScript. Supplied unified patches can
be parsed on a libuv worker with `loadNativeGit().parseGitPatch`; Forge
`parseFullDiffAsync` converts native metadata/chunks to public shapes through
`nativePatchToDiff`. The commit/range/working-tree providers and production `GitRangeService` patches, file lists
and statistics use `diff/local-patch.ts`: Rust plans/executes host Git and processes
patches, while TypeScript executes the shared plan for WSL. Working-tree all scope combines HEAD-to-index and index-to-disk patches with unstaged metadata overriding shared paths; provider operations read fresh state and batch failures propagate. Production commit patch
routes use its git-show plan and native truncation without a route patch cache;
first-parent provider and combined-merge route semantics stay distinct. Commit metadata
uses Forge `loadCommitFiles` with Rust NUL-delimited metadata planning/joins for
host and WSL, preserves Git ordering and absent binary counts, and reads fresh
state without a route metadata cache. Root file lists include initial additions. Native contracts
and migration boundaries belong in the native instructions below.

`packages/coc-native/rust/teams-cli` is a standalone Cargo workspace project providing
the `teams-cli` chat CLI through `teams-sdk`. It shares the native lockfile and CI gates
and always includes MCP and IC3/Trouter; Graph is a default feature.
It is installed separately with `cargo install --locked --path teams-cli` from the
native Rust workspace. Usage and authentication contracts belong in the
[Teams SDK instructions](../../../../packages/coc-native/rust/teams-sdk/AGENTS.md).

The loader accepts `COC_NATIVE_PATH`, local binaries and target-specific prebuilts.
N-API binaries work in Node and Electron. Desktop packaging unpacks native
artifacts and agent runtimes from `app.asar`; bundled Codex/Claude directories
augment the server child's `PATH`. Capability details belong in the
[native instructions](../../../../packages/coc-native/AGENTS.md) and
[language-server reference](language-servers.md).

### Desktop hosts

`packages/coc-desktop/src/server-controller.ts` attaches to a healthy server or
forks one on the preferred port, using an ephemeral port when occupied.
CoC defaults to 4000; CoCContainer defaults to 5000 and shares `~/.coccontainer`
with its CLI. Enabled Windows DevTunnel hosting prefers a configured tunnel's
single HTTP binding. The hosts use separate tunnel identities.
`packages/coc-desktop/electron-builder.container.cjs` selects the container variant.

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
`npm run publish-packages` builds its selected packages and Deep Wiki bundle,
then invokes `changeset publish`; it is not the complete root build chain.
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
Public downloads are CoC macOS DMG and Windows NSIS installers, not the
CoCContainer variant or loose native binaries.

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
