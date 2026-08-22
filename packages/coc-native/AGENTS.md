# coc-native

Rust/N-API file index behind CoC's quick-open search (`Ctrl+P`). Keeps a repo's whole path list in server memory and answers fuzzy searches from it, so no `rg` subprocess runs per open and no multi-megabyte path list crosses the network.

**Optional by construction.** Every consumer must handle the addon being absent — `loadNativeFileIndex()` returns `null` on a platform with no prebuilt binary, and `RepoTreeService` falls back to its ripgrep/directory-walk path.

## Layout

- `rust/core/` — `coc-native-core`: the walker, the scorer, the index and its top-N search. No N-API dependency, so `cargo test -p coc-native-core` runs the whole logic layer without Node. All Rust unit tests live here.
- `rust/napi/` — `coc-native`: a thin `cdylib` wrapper. Every filesystem or scan operation returns an `AsyncTask`, so work happens on a libuv worker and the event loop is never blocked. It has no tests: the crate links against Node's symbols, so a test binary would not link.
- `src/` — TypeScript glue: the binary loader, its resolution order, and the exported types. `npm run build` (tsc) emits `dist/` and requires no Rust toolchain.
- `scripts/build-native.mjs` — `npm run build:native`. Runs `cargo build --release` and copies the cdylib to `coc-native.<triple>.node`. Deliberately not `@napi-rs/cli`: the loader resolves binaries from disk rather than per-platform npm packages, so the CLI would only add a dependency.

## Binary resolution

In order, from `loader.ts`:

1. `COC_NATIVE_FILE_INDEX_PATH` — an explicit path, for tests and unusual packaging.
2. `packages/coc-native/coc-native.<triple>.node` — a locally built binary.
3. `packages/coc-native/prebuilt/<triple>/` — injected by CI/release (gitignored).
4. `null` — the JavaScript fallback takes over.

`COC_NATIVE_FILE_INDEX=0` forces the fallback. Triples are `linux-<arch>-gnu`, `win32-<arch>-msvc`, `darwin-<arch>`. Resolution is cached; `resetNativeFileIndexCache()` clears it for tests.

N-API binaries are ABI-stable, so one binary per platform works under both Node 24 and Electron — there is no `electron-rebuild` step, unlike better-sqlite3.

## Scorer parity

The Rust scorer is a line-for-line port of `packages/coc/src/server/shared/fuzzy-file-score.ts` and **must** rank identically: the server answers `/search` from whichever one is available, and the SPA falls back to the TypeScript one. `test/parity.test.ts` is the CI gate on that, running random paths and queries through both.

Two deliberate deviations from plain JavaScript semantics, matched on both sides:

- **ASCII-only case folding**, not `toLowerCase()`. Full Unicode folding can change a string's length (`'İ'.toLowerCase()` is two code units), which would misalign the match indices used for highlighting. Non-ASCII characters match case-sensitively.
- **Match positions are UTF-16 offsets** — what a JavaScript string index means — so the client can use them directly.

Changing either scorer means changing both, and the parity test is what tells you that you did not.

## Build / test

- `npm run build -w packages/coc-native` — tsc only. Must run before `coc` compiles, which resolves workspace deps from built `dist`.
- `npm run build:native -w packages/coc-native` — compiles the addon. Needs a Rust toolchain; nothing else in the repo does.
- `cargo test --manifest-path packages/coc-native/rust/Cargo.toml -p coc-native-core` — walker, scorer and top-N tests.
- `npm run test:run -w packages/coc-native` — the N-API boundary suite (marshalling, async contract, error propagation, concurrency, lifetime) plus parity. Skips with a loud warning when no binary is built, so it stays meaningful without a toolchain.
- `cargo fmt`/`cargo clippy` run in the `coc-native` CI job. `rust/rustfmt.toml` widens `use_small_heuristics` to match the density of the surrounding TypeScript.
