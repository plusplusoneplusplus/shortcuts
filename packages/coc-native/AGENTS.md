# coc-native

Rust/N-API native capabilities for the CoC server. The package is a home for CPU- or filesystem-bound work worth moving out of Node: one binary, one module per capability on both the Rust and TypeScript sides. It ships the file index behind quick-open search (`Ctrl+P`), the repo content search behind the Explorer's Search view, the bounded content index for Notes search, and the `git` runner every git-backed feature goes through.

**The whole-repo file set comes from Rust alone.** `RepoTreeService` answers whole-repo listings and `/search` from `repo_index::walk` — there is no second walker to keep in step. Its own `walkFiles` still serves *per-directory* listings, and `.git` is excluded by both regardless of `includeIgnored`/`showIgnored`.

**Required, not optional, with no opt-out.** A binary that is missing, will not load, or lacks the capability a newer server expects is a hard failure: `loadNativeAddon()` and each `loadNative<X>()` throw `NativeAddonLoadError`, naming the expected triple, every path tried and the fix. Failing at first use beats silently serving a slower, subtly different implementation for the life of the process. No environment variable turns the addon off; `COC_NATIVE_PATH` only says *which* binary to load.

The `*Status()` accessors never throw, because `/api/health` reports them and has to be able to describe a failed load rather than become one.

## Layout

- `rust/core/` — `coc-native-core`: the logic layer, `pub mod <capability>` per capability. `git` runs `git -C <repo> <args>` with the timeout and buffer caps Node's `execFile` used to enforce. `repo_index` contains the gitignore-aware walker, scorer, immutable file-list snapshot, fuzzy matcher, and atomic refresh state. `content_search` searches file *contents* across the same walk, on ripgrep's `grep-searcher`/`grep-regex`; it holds no state at all, so every query is a fresh parallel walk bounded only by its caps. `notes_index` contains immutable Markdown-content snapshots, JavaScript-compatible lowercase caches, bounded search, full rebuilds, and bounded root-relative incremental upserts/removals under a root-specific symlink policy. Refresh writers serialize per index, build against the last complete snapshot, and atomically swap only after success. No N-API dependency, so `cargo test -p coc-native-core` runs it all without Node. All Rust unit tests live here under `tests/`.
- `rust/napi/` — `coc-native`: a thin `cdylib` wrapper, one `src/<capability>.rs` per capability registering its own classes and functions (`file_index.rs` keeps the shipped JS names — `FileIndex`, `buildFileIndex` — while wrapping core's `repo_index`). Everything that touches the filesystem or scans a large structure returns an `AsyncTask`, so work happens on a libuv worker and the event loop is never blocked. It has no tests: the crate links against Node's symbols, so a test binary would not link.
- `src/loader.ts` — resolves and loads the binary. Deliberately capability-agnostic: it validates only that the module loaded, never which exports it has.
- `src/native-bindings.ts` — **generated, do not edit.** The `#[napi]` type surface as TypeScript, produced by `npm run build:native`.
- `src/<capability>.ts` — one module per capability (`file-index.ts`, `content-search.ts`, `notes-index.ts`): aliases of the generated types, a type guard over the loaded module, `loadNative<X>()` and `nativeXStatus()`.
- `scripts/build-native.mjs` — `npm run build:native`. Drives `@napi-rs/cli` to compile the addon *and* emit the type surface, then rewrites the header. The CLI is used for the build only; the loader still resolves binaries from disk rather than through napi-rs's per-platform npm packages.

Adding a capability means a `rust/core/src/<name>/` module, a `rust/napi/src/<name>.rs` registered in `rust/napi/src/lib.rs`, and a `src/<name>.ts` re-exported from `src/index.ts`. The loader does not change.

## Generated types

`src/native-bindings.ts` is derived from the `#[napi]` macros during compilation — the Rust is the single source of truth for the addon's shape. Capability modules alias those generated declarations (`NativeFileMatch = Bindings.FileMatch`, `NativeNotesSearchResponse = Bindings.NotesSearchResponse`) rather than restating them.

It is **committed on purpose**: `npm run build` is plain `tsc`, so the TypeScript build must never need cargo. CI regenerates it in the `coc-native` job and fails on a `git diff`, which is what removes the drift risk. After changing any `#[napi]` item, run `npm run build:native -w packages/coc-native` and commit the result.

A `.ts` and not a `.d.ts`: an input `.d.ts` under `src/` is not emitted to `dist/`, which would leave capability declarations importing a module that does not exist for consumers. Declarations only, so it emits no runtime code.

Doc comments flow from the Rust, so write the explanation there. Anything the Rust cannot express — why the `indices` are UTF-16 offsets and what depends on that — belongs on the alias in `file-index.ts`, and on `NativeContentMatch` in `content-search.ts` for the same reason.

The proc macro only emits type definitions while the crate actually compiles, so the build script cleans the thin `coc-native` wrapper crate first (the slow `coc-native-core` stays cached) and refuses to write an empty result over the committed file.

## Binary resolution

In order, from `loader.ts`:

1. `COC_NATIVE_PATH` — an explicit path, for tests and unusual packaging.
2. `packages/coc-native/coc-native.<triple>.node` — a locally built binary.
3. `packages/coc-native/prebuilt/<triple>/` — injected by CI/release (gitignored).
4. nothing found — `NativeAddonLoadError`.

Triples are `linux-<arch>-gnu`, `win32-<arch>-msvc`, `darwin-<arch>`; release CI publishes `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-arm64`, `win32-x64-msvc` (no `darwin-x64` — the macOS app is arm64-only). Resolution is cached, so the same error object is rethrown on every call; `resetNativeAddonCache()` clears it for tests.

`nativeAddonStatus()` reports whether the *binary* loaded; capability status accessors (`nativeFileIndexStatus()`, `nativeContentSearchStatus()`, `nativeNotesIndexStatus()`) additionally report `loaded: false` when the binary loaded but lacks their export. They return `{ loaded, binaryPath?, reason? }`, never throw, and cover missing, unloadable and capability-less states.

N-API binaries are ABI-stable, so one binary per platform works under both Node 24 and Electron — there is no `electron-rebuild` step, unlike better-sqlite3.

## Scorer parity

The Rust scorer (`repo_index::score`) is a line-for-line port of `packages/coc/src/server/shared/fuzzy-file-score.ts`. Nothing ranks with the TypeScript one any more — it is kept as the readable reference for what the Rust scorer must do, and `test/parity.test.ts` is the CI gate holding the two together over random paths and queries.

Two deliberate deviations from plain JavaScript semantics, matched on both sides:

- **ASCII-only case folding**, not `toLowerCase()`. Full Unicode folding can change a string's length (`'İ'.toLowerCase()` is two code units), which would misalign the match indices used for highlighting. Non-ASCII characters match case-sensitively.
- **Match positions are UTF-16 offsets** — what a JavaScript string index means — so the client can use them directly.

Changing either scorer means changing both, and the parity test is what tells you that you did not.

## Content search

`content_search::search` answers one query with one fresh parallel walk. There is no index to keep warm, nothing incremental, and no cancellation — the caps below are the entire bound on what a single query can cost, which is why they are conservative and why the server clamps rather than honours a larger request.

- **500** matches total, **20** per file, files over **1 MiB** skipped, **1** line of context each side.
- `truncated` is one flag for all three caps plus the size skip: a caller can do nothing different about any of them beyond telling the user the list is partial.
- Binary files are skipped by the searcher's own NUL detection, not by extension.

The walk comes from `repo_index::walk::walk_builder`, shared with the path walk on purpose: "the files this repo has" has to mean one thing across the tree, quick-open and content search, or the Explorer shows a file that search cannot find. `showIgnored` and the `.git` exclusion therefore behave identically in all three.

`startColumn`/`endColumn` are UTF-16 offsets into the returned `text`, built by decoding the line in three pieces around the match, so they stay exact even for a line holding bytes that are not UTF-8. A very long line is truncated, but never before `endColumn` — the columns are always valid indices into the text that ships.

`SearchError` splits by cause because the server maps it: a bad regex or a bad `path` crosses the N-API boundary as `InvalidArg` (a 400), anything else as a generic failure (a 500).

## Git

`git::run_git` is why git no longer costs a Node child-process spawn per call: the work happens on a libuv worker, and a `Task` marshals the result back. Every non-WSL `execGitAsync` call already lands here, and the git services are porting onto it service by service.

- **Reads will use `gix`, mutations shell out.** Status, log, refs and range resolution move onto gitoxide as each service ports; create/delete/rename/checkout/merge/rebase/cherry-pick/stash run the `git` CLI from Rust, because they are what git itself defines rather than what a library reimplements.
- **Network and credential operations always shell out** — `push`, `pull`, `fetch`, `clone` — so credential helpers, SSH agents and 2FA keep working exactly as they do for a human at a terminal. Never through a Rust git library.
- **`gix`, not `git2`**: the addon stays pure Rust across all four release triples, with no C build dependency.
- **WSL stays in TypeScript.** `forge/src/git/exec.ts` checks `resolveWorkspaceExecutionContext()` first and sends a repo inside a WSL distro through `wsl.exe` itself. Rust runs git on the native host and never learns that WSL exists, so there is one place — not two — where WSL path translation happens.
- **The error text is a contract.** Failures cross the boundary as `git <args> failed: <stderr>`, because routes and the UI show that string to users verbatim. A non-zero exit, a timeout and a buffer overflow all render the same way, matching what `execFile` handed back.
- Defaults match the helper this replaced: a 30 s timeout, a 50 MiB cap on each captured stream, and exactly one trailing line ending stripped from stdout — one, because a `git show` body can legitimately end in a blank line.
- No shell is involved, so arguments holding spaces need no quoting and cannot be re-split.
- **A capability guard checks every export, not one marker.** `src/git.ts` lists the git functions and requires all of them, so a binary from before a later slice fails at load with the rebuild instruction rather than at the first call with `undefined is not a function`. Add each new `#[napi]` git function to that list.
- **Paths stay repository-relative across the boundary.** `gitStatusEntries` returns git's own spelling of a path; `path.join` and `path.basename` build the absolute path and the repository name in `working-tree-service.ts`, because their Windows separator handling is what shaped every path the Git tab has ever shown. Rust never joins a path for the UI.
- **One parser, two callers.** `git::status::parse_porcelain` is the only porcelain parser in the codebase. A repo inside WSL runs `git status` through `wsl.exe` in TypeScript and then hands the text to `parseGitStatusPorcelain`, so the two paths cannot drift.
- Porcelain v1 C-quotes any path holding a space or a non-ASCII byte, and nothing unquotes it — carried over verbatim from the TypeScript parser, because unquoting would change what the Git tab renders.

## Build / test

- `npm run build -w packages/coc-native` — tsc only. Must run before `coc` compiles, which resolves workspace deps from built `dist`.
- `npm run build:native -w packages/coc-native` — compiles the addon and regenerates `src/native-bindings.ts`. Needs a Rust toolchain; nothing else in the repo does.
- `cargo test --manifest-path packages/coc-native/rust/Cargo.toml -p coc-native-core` — the whole logic layer. The `git_exec` and `git_status` suites drive real temporary repositories, so `git` has to be on PATH.
- `npm run test:run -w packages/coc-native` — loader and capability-resolution tests (no binary needed), plus the N-API boundary suites (marshalling, async build/refresh/search contracts, snapshot consistency, error propagation, concurrency, lifetime) and parity. The binary-backed suites **fail** when nothing is built — there is no skip path — so a botched native build cannot pass for a green run.
- `cargo fmt`/`cargo clippy` run in the `coc-native` CI job. `rust/rustfmt.toml` widens `use_small_heuristics` to match the density of the surrounding TypeScript.
