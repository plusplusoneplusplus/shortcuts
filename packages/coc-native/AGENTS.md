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

`git::run_git` is why git no longer costs a Node child-process spawn per call: the work happens on a libuv worker, and a `Task` marshals the result back. Every non-WSL `execGitAsync` call already lands here, and the git services are porting onto it service by service. It takes an argv array, an optional timeout and buffer cap, and environment overrides layered on the inherited environment.

- **Reads use `gix`, mutations shell out.** `git::log` reads commit history, `git::range` resolves base refs, merge bases and ahead counts, `git::branch` reads HEAD, upstream tracking and the branch list, and `git::remote` reads remote URLs — all through gitoxide, spawning nothing. The diff-backed reads and `git status` still shell out, and more follow as each service ports. create/delete/rename/checkout/merge/rebase/cherry-pick/stash run the `git` CLI from Rust, because they are what git itself defines rather than what a library reimplements.
- **Network and credential operations always shell out** — `push`, `pull`, `fetch`, `clone` — so credential helpers, SSH agents and 2FA keep working exactly as they do for a human at a terminal. Never through a Rust git library.
- **`gix`, not `git2`**: the addon stays pure Rust across all four release triples, with no C build dependency. Pinned to `=0.87.0` — 0.87.1 depends on a `gix-worktree-stream` that was never published, so it cannot be resolved at all.
- **WSL stays in TypeScript.** `forge/src/git/exec.ts` checks `resolveWorkspaceExecutionContext()` first and sends a repo inside a WSL distro through `wsl.exe` itself. Rust runs git on the native host and never learns that WSL exists, so there is one place — not two — where WSL path translation happens.
- **The error text is a contract.** Failures cross the boundary as `git <args> failed: <stderr>`, because routes and the UI show that string to users verbatim. A non-zero exit, a timeout and a buffer overflow all render the same way, matching what `execFile` handed back.
- Defaults match the helper this replaced: a 30 s timeout, a 50 MiB cap on each captured stream, and exactly one trailing line ending stripped from stdout — one, because a `git show` body can legitimately end in a blank line.
- No shell is involved, so arguments holding spaces need no quoting and cannot be re-split.
- **A capability guard checks every export, not one marker.** `src/git.ts` lists the git functions and requires all of them, so a binary from before a later slice fails at load with the rebuild instruction rather than at the first call with `undefined is not a function`. Add each new `#[napi]` git function to that list.
- **Paths stay repository-relative across the boundary.** `gitStatusEntries` returns git's own spelling of a path; `path.join` and `path.basename` build the absolute path and the repository name in `working-tree-service.ts`, because their Windows separator handling is what shaped every path the Git tab has ever shown. Rust never joins a path for the UI.
- **One parser, two callers.** `git::status::parse_porcelain` is the only porcelain parser in the codebase. A repo inside WSL runs `git status` through `wsl.exe` in TypeScript and then hands the text to `parseGitStatusPorcelain`, so the two paths cannot drift.
- Porcelain v1 C-quotes any path holding a space or a non-ASCII byte, and nothing unquotes it — carried over verbatim from the TypeScript parser, because unquoting would change what the Git tab renders.

### Reading history

`git::log` replaces the three child processes a single page of commits used to cost — `git log`, `git rev-parse --abbrev-ref @{upstream}`, and a second `git log` for the unpushed set — with one opened repository.

- **`--pretty=format:` is gone, so its placeholders are reimplemented.** `%aI` delegates to `gix`; `%ar` is a literal port of git's `show_date_relative`, rounding steps included; `%D` is built from the ref database. Each is easy to get *nearly* right, which is why `rust/core/tests/git_log.rs` is a differential suite: it asks the real `git log` for the same page and compares field by field. Extend that suite rather than asserting fixed strings.
- **Decoration order is reverse ref-name order.** git prepends each ref as `for_each_ref` yields it, so it prints `origin/main` before `origin/HEAD`, and a remote branch before the local branch of the same name. `HEAD` is added last and therefore prints first, as `HEAD -> <branch>`.
- **`%h` is what costs the time.** Every hash needs the shortest unambiguous prefix, and `gix`'s object-database lookup for that is several times slower than git's. It is ~80% of the time a page takes: a 500-commit page measures 12 ms without it and 36 ms with. The lookup serialises internally, so a `rayon` fan-out over the page measures within noise — that was tried and removed. Skipping the per-object check and trusting git's auto length is not safe either: at this repo's object count, 9-hex collisions genuinely exist, which is why git auto-sizes and then extends.
- The net effect is that native wins at the page sizes the UI uses and loses on very large ones. Measured on a 2-core box against this repo: 2.1x at 1 commit, 1.4x at 50, parity at 200, 0.6x at 500.
- **The page size is not an allocation size.** Callers spell "everything" as a huge number; reserving for it aborts the process.
- Repository paths are resolved by discovery, so a path inside a working tree finds the tree that contains it — the same thing `git -C` does.

### Commit ranges

`git::range` answers "what is on this branch that is not on its base". `detectCommitRange` cost seven child processes for one answer; four of them were ref reads and walks, so they are `gix` now and only the three `diff` runs still spawn.

- **The split is refs versus diffs.** Default-branch detection, `@{upstream}`, merge-base and the ahead count are `gix`. `--numstat`, `--name-status` and `--shortstat` shell out from Rust, because their line counts follow git's own diff drivers, `.gitattributes` and binary detection — a reimplementation that is close but not identical would render as wrong numbers in a review UI.
- **Base-mode fallback is reported, not silent.** Asking for `upstream` on a branch with no upstream resolves to the default branch *and* sets `baseModeFallback`, so the range view's toggle cannot claim to show unpushed commits while showing everything since `main`.
- **Sorting stays in Node.** The file list comes back in git's order; `GitRangeService` sorts it with `localeCompare`, which puts `docs/x.md` before `README.md` where a byte comparison does the opposite. Rust must not sort it "for" the caller.
- **`from_remote` on the default branch exists for the caller's cache.** `GitRangeService` memoises the three remote-derived answers and deliberately not the local `main`/`master` fallbacks — a local fallback means the remote refs have not arrived yet.
- **The `{old => new}` reader is a ported bug, pinned on purpose.** The TypeScript regex's second alternative matches from position 0 whenever the first cannot, so `src/{old.ts => new.ts}` yields `new.ts}` — which then misses the status map and shows as `modified`. Renames under a shared directory have always rendered that way. `rust/core/tests/git_range.rs` pins it; changing it changes what the range view shows and belongs in its own change.
- **One parser, two callers**, as with status: the WSL path runs the two `diff` commands through `wsl.exe` in TypeScript and hands the text to `parseGitRangeChangedFiles` / `parseGitDiffShortstat`.

### Branches

`git::branch` answers what the Git tab asks on every render: which branch is checked out, what it tracks, how far the two have drifted, and what the branch list holds. `getBranchStatus` cost five child processes and a paginated branch list cost two plus a shell pipeline; both are one opened repository now. On this repo (183 local branches, 2-core arm64): branch status 17.8 ms → 1.0 ms, a 100-branch page 13.1 ms → 3.7 ms.

- **`repository_status` is the one read here that still spawns.** Its answer includes whether the working tree is dirty, and deciding that means the index refresh and `.gitignore` walk git already does — `gix` would be reimplementing `git status`, not replacing a `rev-parse`. Everything else in the module is `gix`.
- **The branch list is sorted by full refname bytes**, which is what git's own `refname` ordering does, and is done explicitly rather than by trusting the ref iterator — so a loose ref and a packed ref land in the same place. This is not the `localeCompare` exception the range file list is: git sorts refs by bytes, so Rust does too.
- **`origin/HEAD` is dropped by name, and that is a behaviour fix.** git's `%(refname:short)` shortens `refs/remotes/origin/HEAD` to `origin`, so the TypeScript's "drop any line containing HEAD" filter never caught it and the branch list carried a phantom row called `origin` — one the branch *count* (which read `git branch -r --list`, where the line does say `HEAD`) always excluded. Rust shortens by stripping `refs/remotes/`, so the name still says `HEAD` and page and total finally agree.
- **Search matches the branch name only.** The old Unix path piped the whole formatted line through `grep -i`, so a commit subject or a relative date could match while the count — name-only, like Windows' `findstr` half — did not. One rule now, on every platform.
- **A `limit` of zero is the count-only question.** `getLocalBranchCount` and its remote twin ask for the total with no rows rather than describing every branch to throw the descriptions away.
- **One parser, two callers**, again: the WSL path runs `git status --porcelain=v2 --branch` through `wsl.exe` and hands the text to `parseGitBranchStatus`.
- **An upstream is only an upstream if its ref exists.** `rev-parse --abbrev-ref <branch>@{upstream}` exits non-zero for a branch configured to track a ref that was never fetched, and the caller read that as "no tracking branch". `find_upstream` checks the ref before reporting it, or a never-fetched upstream would start showing up with zero drift.

### Remotes

`git::remote` answers "where does this repository point" — `git remote get-url <name>` and the primary-remote lookup behind `detectRemoteUrl`. Both are configuration reads with no history walk behind them, so `gix` answers them out of the repository it opens and spawns nothing. That matters because `detectRemoteUrl` runs on workspace discovery, on every batch git-info refresh, and on every patch transfer. On this repo (2-core arm64): 2.63 ms → 0.45 ms with an `origin` configured (**5.9x**), and 6.13 ms → 0.14 ms without one (**43.6x**), where the CLI path needed three children to reach the same answer.

- **The configured bytes win over the parsed URL.** `gix` lowercases a host when it renders a parsed URL back to a string, so `https://Org.visualstudio.com/…` would come back reshaped. The hashes would not notice — `computeRemoteHash` and `resolveCanonicalOrigin` lowercase first — but the repo sidebar's grouping key is built from this string with its casing intact, so a clone re-read after the move would group apart from one read before it. `configured_url` therefore parses the raw `remote.<name>.url` value and hands the raw bytes back whenever they resolve to the same URL the remote did.
- **When they disagree, the resolved URL wins.** A `url.<base>.insteadOf` rewrite, or a remote carrying more than one URL, makes the raw value the wrong answer — `git remote get-url` expands rewrites and uses the *first* of several URLs, while a config lookup resolves to the last. The comparison catches both, and the resolved URL gets rendered instead.
- **The fallback only runs when `origin` is absent.** A configured `origin` with an empty URL answers the question with "none"; it does not send the lookup on to a second remote. That is the nesting the TypeScript had, and callers depend on it.
- **`git remote get-url`'s two failures are one answer.** A missing remote and a remote with no URL both exited non-zero, and the caller turned both into a single absent value — so `remote_url` returns `Ok(None)` for either. Only a path that is not a repository is an error.
- **Round-trip fidelity is what `rust/core/tests/git_remote.rs` is for.** Every URL form is asserted twice: against the literal that was configured, and differentially against what the real `git remote get-url` prints. Add a form there rather than trusting the parser.

### Global configuration, and `safe.directory`

`git::config` reads and appends to the user's **global** config. One caller needs it: Git for Windows refuses to open a repository reached over the WSL UNC share unless its path is listed in `safe.directory`, so forge checks the list and appends to it before the first command against such a repo. Both calls used to bypass the git runner entirely, going straight to Node's `execFile`. On this repo (2-core arm64) the read costs 1.79 ms as a Node child and 0.97 ms through the addon (**1.8x**); the sync twin that still spawns costs 1.69 ms with the event loop stopped for every one of them.

- **`run_git_global` exists because `run_git` prepends `-C <repo_root>`.** A `--global` read has no repository to be pointed at, and naming one would change which files git consults — a repository-local `safe.directory` is not the entry Git for Windows checks before it agrees to open the repository in the first place. The two runners share everything else: timeout, buffer cap, and the `git <args> failed: <stderr>` text.
- **Deciding *what* the entry says stays in TypeScript.** `resolveGitSafeDirectory` is built entirely out of WSL UNC path parsing, which is the one thing this crate is deliberately kept ignorant of. Only the two child processes moved. The dedupe cache and the in-flight map stayed in `forge/src/git/safe-directory.ts` too — the whole path is a no-op off win32, so the addon is never even loaded there.
- **`--add`, never a set.** `safe.directory` is the list of every repository the user has already approved; replacing it would revoke the rest. git appends unconditionally, which is exactly why the caller reads the list first.
- **An unset key is an error, and the caller reads it as "not configured".** `--get-all` exits 1 both for a key with no values and for a global config file that does not exist yet, and the two are indistinguishable from outside. Values are trimmed and blank lines dropped in Rust, because membership is decided by exact string equality — a stray `\r` from a Windows-written config would answer "not configured" forever and append a duplicate on every start.
- **The values are shell-hostile and never see a shell.** A real entry is `%(prefix)///wsl$/Ubuntu-24.04/home/me/repo`; the `$` and the `%(…)` sigil cross to git verbatim through argv.
- **`rust/core/tests/git_config.rs` points `GIT_CONFIG_GLOBAL` at a temp file through per-command environment overrides**, not through the process environment, so the suite never touches the developer's real `~/.gitconfig` and stays safe to run in parallel. Do the same for anything added there.

### Mutations, and the environment they run in

Everything `BranchService` writes — create, delete, rename, checkout, merge, rebase, cherry-pick, `am`, stash, push, pull, fetch — runs through `git::run_git` from Rust. There is no second runner: the service builds an argv array, and `execGit` spawns it. What went away is the string-building, the hand-rolled `quoteShellArg`, the `/bin/sh` and `cmd.exe` that ran each command, and the `execSync` calls that blocked the event loop while git worked. Measured on this repo (2-core arm64): a `rev-parse` that cost 2.91 ms as a blocking `execSync` costs 1.54 ms through the addon, and a 1 ms timer keeps firing throughout — 30 sequential `execSync` calls let **0** timer ticks through in 90 ms; 30 `getRepoState` calls let 45 through in 47 ms.

- **`GitCommandOptions::env` layers, it does not replace.** Callers set `GIT_TERMINAL_PROMPT=0` so a push fails instead of blocking a request thread on a prompt nobody can answer, and `GIT_EDITOR` / `GIT_SEQUENCE_EDITOR` so a rebase, an amend or an `am` takes a pre-written message and todo list. Everything else — `PATH`, `HOME`, `SSH_AUTH_SOCK`, the credential helper's own configuration — is inherited, and that inheritance is the whole reason network operations shell out. Never build the child's environment from scratch.
- **Argv, not a command string.** A branch called `feature/$(touch-pwned)&|;` and a stash message holding quotes both round-trip untouched, because no shell ever sees them. This is why the service no longer needs a platform-specific quoting helper.
- **The long timeout is 600 s and is part of the contract.** merge, rebase, `am`, `format-patch`, push, pull and fetch carry it; everything else takes the 30 s default. A rebase of a long branch over a slow link is a slow command, not a hung one.
- **`format-patch` output is normalised to one trailing newline.** The runner strips exactly one line ending, and `format-patch` ends with a blank line; `exportCommitPatch` re-adds one so every payload ends in exactly one `\n`, which is also the separator `exportCommitPatches` joins entries with.

## Build / test

- `npm run build -w packages/coc-native` — tsc only. Must run before `coc` compiles, which resolves workspace deps from built `dist`.
- `npm run build:native -w packages/coc-native` — compiles the addon and regenerates `src/native-bindings.ts`. Needs a Rust toolchain; nothing else in the repo does.
- `cargo test --manifest-path packages/coc-native/rust/Cargo.toml -p coc-native-core` — the whole logic layer. The `git_exec`, `git_status`, `git_log`, `git_range`, `git_branch`, `git_remote` and `git_config` suites drive a real `git`, so it has to be on PATH; `git_log`, parts of `git_range` and parts of `git_branch` additionally compare their output against the real CLI.
- `npm run test:run -w packages/coc-native` — loader and capability-resolution tests (no binary needed), plus the N-API boundary suites (marshalling, async build/refresh/search contracts, snapshot consistency, error propagation, concurrency, lifetime) and parity. The binary-backed suites **fail** when nothing is built — there is no skip path — so a botched native build cannot pass for a green run.
- `cargo fmt`/`cargo clippy` run in the `coc-native` CI job. `rust/rustfmt.toml` widens `use_small_heuristics` to match the density of the surrounding TypeScript.
