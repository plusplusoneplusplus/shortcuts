# coc-native

Rust/N-API capabilities for the CoC server. One binary. One module per capability on both sides. A missing, unloadable, or too-old binary is a hard `NativeAddonLoadError` naming the expected triple, every path tried, and the fix. No environment variable disables the addon. `COC_NATIVE_PATH` only selects which binary. `*Status()` accessors never throw.

## Layout

- `rust/core/` — `coc-native-core`. N-API types are behind the `napi` feature. Unit tests live in `tests/`.
- `rust/napi/` — thin `cdylib`, one `src/<capability>.rs`. Filesystem work returns an `AsyncTask` on libuv. Auth and Teams run on Tokio.
- `rust/lsp/` — `coc-symbols-lsp`, stdio, no Node. CoC uses the same `/ws/language-server` transport as clangd.
- `rust/auth-sdk/`, `rust/auth-cli/`, `rust/teams-sdk/`, `rust/teams-cli/`, `rust/webview2/`, `rust/wkwebview/`.
- `src/loader.ts` checks that the module loaded, not which exports it has. `src/<capability>.ts` is the type guard and `loadNative<X>()`. `src/native-bindings.ts` is generated. Do not edit it.
- Adding a capability means `rust/core/src/<name>/`, `rust/napi/src/<name>.rs` registered in `lib.rs`, and `src/<name>.ts` re-exported from `src/index.ts`.

## Generated types

`native-bindings.ts` is committed so `npm run build` stays plain `tsc`. CI regenerates it and fails on drift. It is `.ts`, not `.d.ts`, so consumers receive the declarations. After any `#[napi]` change, run `npm run build:native -w packages/coc-native` and commit the result. Doc comments belong on the Rust. UTF-16 index notes that Rust cannot express belong on the TypeScript alias.

## Binary resolution

1. `COC_NATIVE_PATH` or `COC_SYMBOLS_LSP_PATH` or `COC_WEBVIEW2_PATH` / `COC_WKWEBVIEW_PATH`.
2. The locally built triple-qualified binary.
3. `prebuilt/<triple>/`.
4. Addon and WebView helpers throw. `symbolsLspStatus()` reports `loaded: false` until `loadSymbolsLspBinary()`.

Inside `app.asar`, candidates are rewritten to `app.asar.unpacked`. Resolution is cached. `resetNativeAddonCache()` clears it for tests. N-API binaries are ABI-stable across Node 24 and Electron. Release triples: `linux-x64-gnu`, `linux-arm64-gnu`, `darwin-arm64`, `darwin-x64`, `win32-x64-msvc`, `win32-arm64-msvc`.

### Desktop WebView2

Windows x64 helper. COM is STA on the main thread, which owns every window and controller. Stdin only queues commands. CDP is a desktop-main transport, never a renderer API. Method names are `Domain.command`.

- Commands and ordinary replies cap at 1 MiB. A correlated pending annotation reply may be 28 MB. Capture is a PNG data URL, 16 Mi pixels, 20 MiB. CDP requests retire at 60s and on close, crash, or shutdown without stopping other views.
- Navigation history emits `visited` only from successful completion or a committed same-document source change. Titles emit only after that. Popups keep the root tab's history. Favicons are at most 64 KiB and never on popups or errors.
- An approved `navigate` authorizes that exact HTTP(S) origin for the active view's control lease, up to 256 origins. Return navigations keep the POST body. New views start empty.
- Downloads stay in the native operation. No URL replay. Pending approval expires in 60s. Caps: 8 pending, 20 total. `download-decide` accepts only a main-owned absolute Windows path. Approved downloads survive tab close on a hidden controller. Browser-process failure cancels all of them.
- ClickOnce is an isolated `--clickonce` mode. It accepts one bounded HTTPS URL and never a local executable path. Acceptance does not prove an app opened.
- Hosted pages get no host objects. Navigation is HTTP(S), plus `about:blank` inside auth popups. SSO uses the OS primary account and does not change organization policy.
- `build:native` includes this helper only on Windows x64.

Real contracts need Windows x64, a built addon, `COC_DESKTOP_E2E=1`, and `packages/coc-desktop` `test/e2e/browser-engines.e2e.test.ts`. Missing runtime is a failure, not a skip.

### Desktop WKWebView

macOS 14+ helper, same stdio JSON-line protocol, 1 MiB frames, 28 MB only for a correlated annotation reply. The main thread runs AppKit as an accessory. The profile directory is held with an advisory lock. `build:native` builds it only on darwin arm64/x64. Navigation bookkeeping reuses `webview2/src/history.rs`.

## Authentication capability

`rust/auth-sdk/` is Node-free. Shared secrets, DTOs, clocks, storage, and errors are vendor-neutral. `auth_sdk::microsoft` owns Microsoft OAuth and Azure CLI. Scope policy and cache ownership stay with the caller.

- Refresh exchange accepts caller-owned secrets and returns secret-wrapped fields. Responses expose access token, type, `expiresIn`, optional scope, and a rotated refresh token. Never ID tokens. Errors keep safe codes, HTTP status, and allowlisted `rejection` values. No provider payload.
- Each Node request owns cancellation and a 100..900,000 ms deadline (default 30s). Completion rechecks cancellation before publishing tokens.
- OAuth verifies ID-token signature, issuer, audience, tenant, object id, and nonce. It uses PKCE and state. The loopback callback is `http://127.0.0.1:<port>/` and the exact root path. Scopes require `openid`, `profile`, and `offline_access`.
- Access tokens stay in memory. Only SDK-owned refresh credentials enter the OS store. Windows blobs are UTF-8 within Credential Manager's 2,560-byte limit. `selection: 'active-account'` pins identity on first use and fails later changes with `AccountMismatch`. No silent account fallback.
- `never` allows one successful noninteractive acquisition. Forced renewal under `never` rejects. Azure CLI token requests pass only `--subscription`. Tenant is enforced on the response, not with `--tenant`.
- Claude acquisition coordinates in Rust, persists compact JSON, and uses `/usr/bin/security` with the CLI reader's `apple-tool:` partition. Writes send one bounded hex command on stdin. Callers that share credentials share one private coordination directory.
- Kusto, ADO, and Teams Azure CLI credentials renew on demand. Teams MCP production callers use the connector's native OAuth owner and do not import Copilot's cache.
- `auth-cli` is opt-in and independent of Node. JSON Lines masks secrets to eight leading and trailing characters. Sixteen characters or fewer, and URL queries, are fully masked. `--show-secrets` is explicit. Install: `cargo install --locked --path auth-cli` from `rust/`.

### GitHub authentication

`auth_sdk::github` imports the selected CLI credential. It does not log in, refresh, expire, persist, or exchange a service token. The host supplies an absolute config path. Lookup order is `authTokens[host:login:github].token`, `authTokens[host:login].token`, then `copilotTokens[host:login]`. Only an absent or empty file token allows OS lookup. Linux is file-only. Nonempty tokens do not fall across sources. Deadline is 10s. Stream cap is 16 KiB. Cancelling one request cannot dispose another. Copilot RPC and service authorization stay in TypeScript.

## Teams capability

`src/teams.ts` is a one-shot Node wrapper. Tokens stay native. `connect()` failure requires a new session. `beginRead()` cancellation is independent of other reads. The Node API exposes IC3 discovery and history only. History verifies the exact native thread type and publishes `chatKind`. It preserves numeric `rootMessageId`. Callers select reply routing from that evidence, not from chat-id patterns. `readThread` includes the root on the first page. Protocol contracts: [`teams-sdk/AGENTS.md`](rust/teams-sdk/AGENTS.md).

## Repo files

Rust is the only whole-repo walker. `RepoFiles` is one root's index owner. `dispose()` rejects later calls. Listings and walks exclude `.git` from indexes. Flat listings may still show it. Names sort with `feruca` CLDR root collation. Ignore rules match Git for directories and ripgrep for file walks.

- `read_blob` accepts UTF-8 text through 10 MiB inclusive. Binary reads and content replacement stay at 1 MiB.
- `deleteEntry` refuses the workspace root, `.git`, symlinked ancestors, and unsupported reparse points. It unlinks planned entries and does not force-remove a directory. Partial deletion is reported and not rolled back. Every mutation refreshes indexes before settling. The CoC route also requires a physical workspace and live default-on `features.explorerDelete`.
- Replace uses `regress` over UTF-16 code units so JavaScript `RegExp` semantics hold. Do not swap in the `regex` crate. Parity: `test/repo-files-replace-parity.test.ts`.
- `resolve_in_root` is lexical. On Windows a drive prefix replaces the root, so same-drive `C:x` is rejected. Drive letters compare case-insensitively. Directory names compare case-sensitively.
- Quick-open ranking is basename tier, descending fuzzy score, scored-target length, full-path length, then snapshot index. ASCII-only case folding. Match indexes are UTF-16. Change `repo_index::score` and `packages/coc/test/support/fuzzy-file-score.ts` together.

## Symbol index

Bump `INDEX_SCHEMA_VERSION` on any extraction or table change, not only DDL. Sync keys are size, mtime, and hash, so a rules change otherwise leaves stale rows forever. `open` drops every table on `user_version` mismatch. Search orders `KIND_PRIORITY` before path: macro, class, type, method, function, prototype. `kind` is free-form text. Reference queries use the filtered occurrence table, not every identifier. A file's definition and occurrence rows are replaced together. Unreadable files keep their previous rows.

## Content search

One fresh parallel walk. Caps: 500 matches, 20 per file, files over 1 MiB skipped, 1 line of context. `truncated` covers all of those. Binary files are skipped by NUL detection. `startColumn` and `endColumn` are UTF-16 offsets into the returned `text` and stay valid when the line is truncated. A bad regex or path is `InvalidArg` (HTTP 400). There is no cancellation.

## Dangerous command guard

A hardcoded disallow list. `matched: false` is not a safety claim. Commands split on `;`, `&&`, `||`, `|`, and newlines. Quoting is not parsed. Each rule needs a lookalike test that must not match. `tryMatchDangerousCommand()` returns `null` when the capability is missing, and callers treat null as "run it". `loadNativeDangerousCommandGuard()` still throws.

## Git

Reads use `gix` (`=0.87.0`). Mutations, `git status`, unified diffs, and network operations (`push`, `pull`, `fetch`, `clone`) shell out to `git` from Rust. Credential helpers and SSH keep working. No Node `git` spawn remains on request paths. WSL routing stays in Forge. Rust executes host Git only.

- Failures cross the boundary as `git <args> failed: <stderr>`. Default timeout is 30s. Each stream caps at 50 MiB. Exactly one trailing newline is stripped.
- Network operations and unbounded work pass `timeout: 0`. Merge, rebase, `am`, `format-patch`, push, pull, and fetch use 600s.
- `GitCommandOptions::env` layers on the inherited environment. Never replace it. `GIT_TERMINAL_PROMPT=0` on network commands.
- Paths stay repository-relative. The UI joins them in TypeScript.
- `src/git.ts` guards every export. Add each new `#[napi]` function to that tuple.
- One porcelain parser. WSL runs git in TypeScript and hands the text to `parseGitStatusPorcelain` / `parseGitBranchStatus`. Do not unquote C-quoted paths.
- `resolved_git_dir` returns `git_dir()`, never `common_dir()`, so worktree rebase state stays visible.
- `discover_workdir` stats the path first. A missing path, a non-repo, and a bare repo are `null`. The addon takes an absolute path. `path.resolve` stays in Node.
- `upstream_config` reads raw branch config and must not go through `find_upstream`. It has to work for a never-fetched upstream.
- `safe.directory` uses `run_git_global` because `run_git` prepends `-C`. Append with `--add`. Never replace the list. What the entry says stays in TypeScript.
- Patch stores are scoped by workspace, root, execution, and source. Refresh and disposal revoke generations and kill the direct Git child. Authentication stays in TypeScript. `git diff --no-index` exits 1 when files differ. That success code is set in Rust, not by a JavaScript caller.
- Commit-log decoration (`%D`) reads every ref and is the expensive part. Do not port a one-child `git log` onto `git::log` without counting that cost. Do not cache `gix::Repository`: config is snapshotted at open.

## Notes filesystem

No JavaScript fallback. Root resolution and `localeCompare` sorting stay in Node. `notesTree` returns raw readdir order and `.order.json`.

- Selected roots use `resolve_safe_notes_path`: lexical containment, then canonicalize the existing prefix. A dangling symlink is rejected. The default-root allow-list is computed in Node and passed in.
- `resolveSafeNotesPath` is the shared export. Do not keep a TypeScript copy.
- Error text is `[notes-fs:<code>] ` plus the reason. Status codes are the HTTP contract.
- A conflict is `{ status: 'conflict', currentMtime, currentContent }`, compared after `Math.round`. A missing file is not a conflict.
- Writes are atomic via a containment-checked `.tmp` rename. A successful write updates the live Rust search index in process. Index failure does not fail the save. A directory rename that exceeds the bound falls back to full `refresh()`.
- The capability guard in `src/notes-fs.ts` lists every export.

## Filesystem watch batching

`rust/core/src/watch/` is the subscription state machine. One native watcher per canonical root. The last unsubscribe closes it. Filters use extensions, ignored prefixes, and cached nested Git ignore rules. `.git` is excluded. Paths are root-relative and forward-slashed.

Batches dedupe and sort, at most 4,096 paths and 1 MiB of path bytes. Ingress overflow at 1,024 events becomes a rescan. Backend errors, root changes, and structural directory events clear partial paths and require a full reload. Windows UNC roots poll once a second. A 100 ms health check discovers missing roots.

`NativeWatchService` delivers through one unreferenced TSFN. Active-id gates drop callbacks after disposal. Server consumers share `shared/native-watch-service.ts`. Equal workspace ids on different local servers stay isolated. Tests inject batches. Real filesystem watches live in core.

## Build / test

- `npm run build -w packages/coc-native` — `tsc` only. Required before `coc` compiles.
- `npm run build:native -w packages/coc-native` — addon, bindings, symbols LSP, and the platform webview helper.
- `npm run ensure:native` — rebuilds when `rust/` is newer. Not part of `build`.
- `cargo test --manifest-path packages/coc-native/rust/Cargo.toml -p coc-native-core`
- `cargo test --manifest-path packages/coc-native/rust/Cargo.toml -p coc-symbols-lsp`
- `npm run test:run -w packages/coc-native` — binary-backed suites fail when the addon is not built. There is no skip.
