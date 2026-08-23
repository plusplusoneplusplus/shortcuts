# coc-native

Rust/N-API native capabilities for the CoC server. The package is a home for any CPU- or filesystem-bound work worth moving out of Node: one binary, one module per capability on both the Rust and the TypeScript side. Today it ships one capability — the file index behind quick-open search (`Ctrl+P`) — but nothing in the loader, the crate layout or the build is scoped to it.

**The file index must agree with its fallbacks.** `RepoTreeService` has three whole-repo walkers — the Rust `file_index::walk`, its JS `walkFiles`, and the `rg --files` path — and they must produce the same set. `.git` is excluded by all three regardless of `includeIgnored`/`showIgnored`, which deliberately differs from `rg --no-ignore`; changing one walker's filtering means changing all three.

**Required, not optional.** A binary that is missing, will not load, or lacks the capability a newer server expects is a hard failure: `loadNativeAddon()` and each `loadNative<X>()` throw `NativeAddonLoadError`, naming the expected triple, every path tried and the fix. Failing at startup beats silently serving a slower, subtly different implementation for the life of the process.

`COC_NATIVE=0` is the sole opt-out — the loaders return `null` for it, and only then does a consumer take its JavaScript path. It is how a machine with no Rust toolchain and no prebuilt binary runs the server on purpose.

The `*Status()` accessors never throw, because `/api/health` reports them and has to be able to describe a failed load rather than become one.

## Layout

- `rust/core/` — `coc-native-core`: the logic layer, `pub mod <capability>` per capability (`file_index`: walker, scorer, index and its top-N search). No N-API dependency, so `cargo test -p coc-native-core` runs it all without Node. All Rust unit tests live here, named `tests/<capability>_*.rs`.
- `rust/napi/` — `coc-native`: a thin `cdylib` wrapper, one `src/<capability>.rs` per capability registering its own classes and functions. Everything that touches the filesystem or scans a large structure returns an `AsyncTask`, so work happens on a libuv worker and the event loop is never blocked. It has no tests: the crate links against Node's symbols, so a test binary would not link.
- `src/loader.ts` — resolves and loads the binary. Deliberately capability-agnostic: it validates only that the module loaded, never which exports it has.
- `src/native-bindings.ts` — **generated, do not edit.** The `#[napi]` type surface as TypeScript, produced by `npm run build:native`.
- `src/<capability>.ts` — one module per capability (`file-index.ts`): aliases of the generated types, a type guard over the loaded module, `loadNative<X>()` and `nativeXStatus()`.
- `scripts/build-native.mjs` — `npm run build:native`. Drives `@napi-rs/cli` to compile the addon *and* emit the type surface, then rewrites the header. The CLI is used for the build only; the loader still resolves binaries from disk rather than through napi-rs's per-platform npm packages.

Adding a capability means a `rust/core/src/<name>/` module, a `rust/napi/src/<name>.rs` registered in `rust/napi/src/lib.rs`, and a `src/<name>.ts` re-exported from `src/index.ts`. The loader does not change.

## Generated types

`src/native-bindings.ts` is derived from the `#[napi]` macros during compilation — the Rust is the single source of truth for the addon's shape, and `file-index.ts` aliases it (`export type NativeFileMatch = Bindings.FileMatch`) rather than restating it.

It is **committed on purpose**: `npm run build` is plain `tsc`, so the TypeScript build must never need cargo. CI regenerates it in the `coc-native` job and fails on a `git diff`, which is what removes the drift risk. After changing any `#[napi]` item, run `npm run build:native -w packages/coc-native` and commit the result.

A `.ts` and not a `.d.ts`: an input `.d.ts` under `src/` is not emitted to `dist/`, which would leave `dist/file-index.d.ts` importing a module that does not exist for consumers. Declarations only, so it emits no runtime code.

Doc comments flow from the Rust, so write the explanation there. Anything the Rust cannot express — why the `indices` are UTF-16 offsets and what depends on that — belongs on the alias in `file-index.ts`.

The proc macro only emits type definitions while the crate actually compiles, so the build script cleans the thin `coc-native` wrapper crate first (the slow `coc-native-core` stays cached) and refuses to write an empty result over the committed file.

## Binary resolution

In order, from `loader.ts`:

1. `COC_NATIVE_PATH` — an explicit path, for tests and unusual packaging.
2. `packages/coc-native/coc-native.<triple>.node` — a locally built binary.
3. `packages/coc-native/prebuilt/<triple>/` — injected by CI/release (gitignored).
4. nothing found — `NativeAddonLoadError`.

`COC_NATIVE=0` short-circuits all of the above and yields `null`. Triples are `linux-<arch>-gnu`, `win32-<arch>-msvc`, `darwin-<arch>`; release CI publishes `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-arm64`, `win32-x64-msvc` (no `darwin-x64` — the macOS app is arm64-only). Resolution is cached, so the same error object is rethrown on every call; `resetNativeAddonCache()` clears it for tests.

`nativeAddonStatus()` reports whether the *binary* loaded; a capability's own status (`nativeFileIndexStatus()`) additionally reports `loaded: false` when the binary loaded but lacks that capability. Both are `{ loaded, binaryPath?, reason? }`, never throw, and are what `/api/health` surfaces — `loaded: false` covers disabled, missing, unloadable and capability-less alike.

N-API binaries are ABI-stable, so one binary per platform works under both Node 24 and Electron — there is no `electron-rebuild` step, unlike better-sqlite3.

## Scorer parity

The Rust scorer (`file_index::score`) is a line-for-line port of `packages/coc/src/server/shared/fuzzy-file-score.ts` and **must** rank identically: the server answers `/search` from whichever one is available, and the SPA falls back to the TypeScript one. `test/parity.test.ts` is the CI gate on that, running random paths and queries through both.

Two deliberate deviations from plain JavaScript semantics, matched on both sides:

- **ASCII-only case folding**, not `toLowerCase()`. Full Unicode folding can change a string's length (`'İ'.toLowerCase()` is two code units), which would misalign the match indices used for highlighting. Non-ASCII characters match case-sensitively.
- **Match positions are UTF-16 offsets** — what a JavaScript string index means — so the client can use them directly.

Changing either scorer means changing both, and the parity test is what tells you that you did not.

## Build / test

- `npm run build -w packages/coc-native` — tsc only. Must run before `coc` compiles, which resolves workspace deps from built `dist`.
- `npm run build:native -w packages/coc-native` — compiles the addon and regenerates `src/native-bindings.ts`. Needs a Rust toolchain; nothing else in the repo does.
- `cargo test --manifest-path packages/coc-native/rust/Cargo.toml -p coc-native-core` — the whole logic layer.
- `npm run test:run -w packages/coc-native` — loader and capability-resolution tests (no binary needed), plus the N-API boundary suite (marshalling, async contract, error propagation, concurrency, lifetime) and parity. The binary-backed suites **fail** when nothing is built; they skip only under `COC_NATIVE=0`, so a botched native build cannot pass for a green run.
- `cargo fmt`/`cargo clippy` run in the `coc-native` CI job. `rust/rustfmt.toml` widens `use_small_heuristics` to match the density of the surrounding TypeScript.
