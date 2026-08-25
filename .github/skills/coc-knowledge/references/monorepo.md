# Monorepo Layout, Build, and Release

An npm workspaces monorepo of published Node packages. This file owns the cross-package contract, build/test commands, package management, and repo-wide conventions. For the internals of `packages/coc/` itself see [server-architecture.md](server-architecture.md).

## Products & Shared Packages

| Product | Location | Description |
|---------|----------|-------------|
| **CoC CLI** | `packages/coc/` | CLI + dashboard server for YAML-based AI workflows |
| **CoC Container** | `packages/coccontainer/` | Container-oriented CoC server with messaging integrations and service entry points |
| **CoC Client** | `packages/coc-client/` | Framework-free TypeScript client for CoC REST and realtime APIs (Node/browser) |
| **Deep Wiki** | `packages/deep-wiki/` | CLI that generates wikis for codebases (`deep-wiki seeds\|discover\|generate\|theme\|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **coc-workflow** | `packages/coc-workflow/` | Pure DAG workflow compiler/executor, portable Ralph orchestration contracts, workflow types, validation, scheduling, node executors, result adapter, pipeline YAML compatibility types |
| **forge** | `packages/forge/` | Core AI utilities: re-exports the AI SDK from `coc-agent-sdk`, task queue, runtime policies, process store, git CLI, remote server connectors (`connectors` sub-path: SSH, DevTunnel), utilities, workflow compatibility exports |
| **coc-agent-sdk** | `packages/coc-agent-sdk/` | Provider-agnostic agent SDK: `CopilotSDKService`, `CodexSDKService`, `SDKServiceRegistry`, session lifecycle, streaming state machine, MCP config, model registry |
| **coc-memory** | `packages/coc-memory/` | Memory V2 core: SQLite fact/episode stores, hybrid search, embedding provider abstraction, capture service, safety scanning |
| **coc-native** | `packages/coc-native/` | Rust/N-API native capabilities (see below) |
| **coc-connector** | `packages/coc-connector/` | Messaging connectors behind one `MessagingConnector` contract (see below) |

**Architectural boundary:** shared behavior belongs in Node packages with explicit package contracts. UI-facing dashboard behavior lives under `packages/coc/`; reusable REST clients in `packages/coc-client/`; workflow, memory, SDK, and utility logic in their dedicated packages.

### coc-native

One module per capability lives on the Rust core, N-API, and TypeScript sides. The file index behind quick-open search combines an `ignore`-crate parallel gitignore-aware walk with a fuzzy path scorer ported from `packages/coc/src/server/shared/fuzzy-file-score.ts`.

The Notes index exposes asynchronous initial build, bounded search, full rebuild, and batches of at most 1,024 root-relative incremental upserts/removals over immutable Markdown-content snapshots. Refresh writers serialize per index, build from the last complete snapshot, and atomically swap only on success, so searches during refresh see a complete old or new state. Each root retains its Unicode lowercase cache and symlink policy.

`loadNativeAddon()` covers the binary; `loadNativeFileIndex()` and `loadNativeNotesIndex()` validate their own capability exports. Missing, unloadable, or capability-stale binaries raise `NativeAddonLoadError` with the expected triple, paths tried, and rebuild guidance. `COC_NATIVE=0` lets `RepoTreeService` use its ripgrep/directory-walk path, but it remains a fatal state for the native-only Notes capability. `COC_NATIVE_PATH` overrides resolution. Status accessors never throw and return `{ loaded, binaryPath?, reason? }`.

TS glue (`npm run build`) needs no Rust; only `build:native` does, driving `@napi-rs/cli` to compile the addon and regenerate `src/native-bindings.ts` — the `#[napi]` type surface, committed so `tsc` never needs cargo, aliased by capability modules, and CI-gated by a regenerate-and-diff step. Binaries resolve from a locally built `coc-native.<triple>.node`, then `prebuilt/<triple>/`, and are ABI-stable across Node and Electron.

### coc-connector

No CoC/forge deps. Core interface at the root (`@plusplusoneplusplus/coc-connector`), Teams at `/teams` (Graph API + MCP, used by `coc` and `coccontainer`), WhatsApp at `/whatsapp` (Baileys, lazy-loaded, used by `coccontainer` when `messaging.whatsapp.enabled` is true). Baileys and qrcode-terminal are `optionalDependencies`. Subpath exports avoid the `BotStatus` name collision; physical `teams/` + `whatsapp/` proxy `package.json` dirs let `moduleResolution: node10` consumers resolve the subpaths.

## Package Management & Publishing

Published workspaces (`coc`, `coc-workflow`, `forge`, `coc-agent-sdk`, `coc-memory`, `coc-client`, `deep-wiki`, `coccontainer`, `coc-connector`) go to npm under the `@plusplusoneplusplus` scope with public access, coordinated by **`@changesets/cli`**. `.changeset/config.json`: independent versioning, public access, `main` base branch, `updateInternalDependencies: "patch"`.

`coc` and `deep-wiki` depend on published workspace packages via caret ranges; npm workspaces symlink them in local development. Nothing is bundled or copied into consumers — everything resolves from `node_modules` at runtime.

**Build order:** `coc-agent-sdk` -> `coc-workflow` -> `forge`/`coc`. `coc` also consumes compiled `coc-memory`, `coc-client`, `coc-connector`, and `coc-native` output. Root `build:packages` builds those dependencies before `coc`, then `coccontainer` before `coc-desktop` so both desktop server entry points exist for packaging. `scripts/prebuild.mjs` enforces the same order for direct `packages/forge` and `packages/coc` builds; the `coc` build also cleans `dist` before `tsc`.

**Versioning:** `npm run changeset` (add), `npm run version-packages` (apply, bump versions/changelogs), `npm run publish-packages` (build all, then `changeset publish`). npm publishing is manual.

**Minimum Node.js:** every package requires Node.js >= 24 (`engines.node`); CI runs `24.x`.

## CI Release

`.github/workflows/release.yml` fires on `v*.*.*` tags (stable, draft release) and `v*.*.*-*` pre-release tags (non-draft, marked pre-release); `workflow_dispatch` reruns it for an existing tag. It builds the CoC macOS DMG plus Windows NSIS installers for CoC and CoCContainer and attaches them to a GitHub Release.

A parallel `build-docker` job (not a dependency of `create-release`) builds the root `Dockerfile` for `linux/amd64,linux/arm64` and pushes `ghcr.io/plusplusoneplusplus/coc` — `X.Y.Z`, `X.Y`, `latest` for stable tags, only `X.Y.Z-pre` for pre-releases (`packages: write`). Release jobs require successful native builds, stage the target binaries under `packages/coc-native/prebuilt/`, and never compile Rust inside Docker (arm64 is qemu-emulated). The pushed-image smoke requires both `nativeFileIndex.loaded` and `nativeNotesIndex.loaded`.

The image runs `coc serve --host 127.0.0.1 --port 4000 --data-dir /data/.coc` as uid 1000 (`HOME=/data`, `tini` PID 1, `docker/entrypoint.sh` does optional `COC_INIT_*` first-boot seeding). Loopback bind is policy: no `EXPOSE`; single-box use is `--network host`, managed use is an auth sidecar in the same network namespace (`deploy/tenant/`). Stages: `build` (native `$BUILDPLATFORM`, `.git` excluded so the `COC_BUILD_COMMIT` build-arg feeds `prebuild.mjs`), `deps` (target arch, `npm ci --omit=dev`), slim runtime with git/gh/curl. A new root workspace needs a matching `COPY packages/<x>/package.json` line in **both** install stages.

`ci.yml` has a required `docker-build-smoke` job (amd64 build, health check, loopback-only `/proc/net/tcp` assertion, clean `docker stop`, sidecar-netns reachability, `coc --version`). Contract tests: `packages/coc/test/docker/*.test.ts` and `scripts/docker-workflow.test.mjs`.

## Build & Test

- **Build packages:** `npm run build:packages`; **build all:** `npm run build`; **compile:** `npm run compile` (alias for package build)
- **Test all:** `npm run test`; **per package:** `npm run test:run` in the package directory (Vitest)
- **Lint:** `npm run lint`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..`, then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..`, then `deep-wiki generate <repo>`
- **CoCContainer rebuild loop:** `./scripts/coccontainer-serve-loop.sh --port 8080` installs dependencies, builds and links the package chain, verifies native dependencies such as `better-sqlite3`, then starts `coccontainer serve --no-open`
- **Run CoC as a service:** see [coc-service.md](coc-service.md)

## Native-module ABI (better-sqlite3 / node-pty)

The plain-Node server and the Electron desktop share one hoisted `node_modules`, but better-sqlite3 is a V8-ABI addon: its compiled `.node` matches exactly one runtime's `NODE_MODULE_VERSION` at a time (node-pty is N-API and ABI-stable). `packages/coc-desktop/scripts/ensure-native-abi.mjs` keeps this self-healing, run by coc-desktop's `prestart` hook before every Electron launch. It probes by *exercising* each addon under Electron (`new Database(':memory:')` — better-sqlite3 dlopens lazily, so a bare `require()` proves nothing) and heals only the modules that fail. `scripts/ensure-native-dependency.mjs` (used by `coccontainer-serve-loop.sh`) is the equivalent standalone Node-side check.

- `npm run ensure:native:node` (root) flips the tree back for the plain-Node runtime. The two runtimes cannot share the tree *simultaneously* — the last `ensure:*` run wins.
- Every verified build is stashed per `{module version, ABI, platform, arch}` under `node_modules/.cache/coc-native-abi/`, so flipping runtimes is a sub-second restore after the first compile of each flavor. `rebuild:native` (`--force`, used by `build:desktop`) always recompiles.
- **The Electron pin is tied to better-sqlite3.** Its Electron prebuilts trail Electron by a major or two: 11.x stops at electron-v133 (Electron 35), 12.x reaches electron-v146 (Electron 42). Electron 43 (ABI 148) has no prebuilt at any version and better-sqlite3's C++ does not compile against its V8 15 (`External::Value` needs a tag arg), so raising Electron past the covered range breaks `dev:desktop` and the mac release with a node-gyp error at install/packaging time. Check [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases) for a matching `electron-v<abi>` asset before bumping either version; `packages/coc-desktop/test/native-abi.test.ts` pins the pact.
- Electron resolves through Node's module resolution, not a fixed path — npm nests it under `packages/coc-desktop/node_modules` or hoists it to the root depending on the tree, and both layouts must work.

## Desktop Server Ports & Bundled CLIs

- **CoC desktop:** when Windows DevTunnel hosting is enabled and the configured tunnel has exactly one HTTP binding, that port is the preferred attach/start port; otherwise 4000. Either way it attaches to a healthy CoC server, starts the embedded server on the preferred port when free, and falls back to an ephemeral port only when the preferred one is unusable.
- **CoCContainer desktop:** built from `packages/coc-desktop/electron-builder.container.cjs` with the dedicated `container-main` and `container-server-entry` outputs. Same DevTunnel port rule, otherwise port 5000 with free-port fallback. It shares the CLI's `~/.coccontainer` data directory and uses tunnel identity `<hostname>-coccontainer` so it does not contend with CoC desktop's `<hostname>-coc`.
- **Packaged agent CLIs:** the desktop build prepends bundled Copilot/Codex/Claude CLI directories to the forked server `PATH`. Copilot needs both `@github/copilot/**` (the JS launcher run by system Node) and `@github/copilot-*-*/**` (the platform binary) unpacked; a launcher left inside `app.asar` breaks packaged Copilot even when the native binary is unpacked.

## Cross-Package Conventions

**Repo-scoped data:** all runtime data specific to one repository lives under `~/.coc/repos/<workspaceId>/`, resolved with `getRepoDataPath(dataDir, workspaceId, filename)` from `packages/coc/src/server/`. Do **not** add new top-level directories under `~/.coc/` for per-repo data.

**Canonical origin IDs:** `resolveCanonicalOrigin()` / `resolveCanonicalOriginId()` from `@plusplusoneplusplus/forge/git` derive `gh_<owner>_<repo>` (GitHub), `ado_<org>_<project>` (Azure DevOps), `git_<remoteHash>` (unknown remotes), and `local_<workspaceId>` (no remote).

**Creating work items:** work items are JSON files in `~/.coc/repos/<originId>/work-items/` keyed by canonical origin ID, not `.plan.md` files in `tasks/`. Same-origin workspace directories migrate into the canonical origin directory on first store access. **Always use the REST API** while the server runs — `POST http://localhost:4000/api/workspaces/<workspaceId>/work-items` with `{ title, description, priority, tags, source }` — and never write work-item JSON directly, because the server uses an atomic write-queue.

**Model resolution:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.

**Development notes:** TypeScript targeting Node.js ≥ 24; format-on-save and import organization enabled; cross-platform on Linux, macOS, and Windows.
