# Language Servers

Workspace-scoped language support spans the CoC server, `coc-client`, and the
dashboard file editor.

### Session lifecycle

`LanguageServerManager` attaches every definition matching a document in
priority order and keys each session by workspace, browser editing session,
definition, and resolved project root by default. Definitions may select
workspace scope to share an expensive process across editing sessions when they
open different files. A second editing session opening the same path receives
an isolated process so its unsaved buffer and diagnostics remain independent.

All built-ins and valid custom definitions are available by default in every
workspace. Configuration retains executable, arguments, project matching,
initialization/settings and process limits, without enable controls. Reads strip
saved master/per-definition enable fields, including false values, without
rewriting the file. Missing or corrupt files use built-in defaults; corrupt files
retain warnings. Acquisition and settings GET never seed configuration.

File paths preserve spelling through normalization and URI mapping.
`file-identity.ts` resolves directory-entry spelling on the owning filesystem;
`GET /api/repos/:id/file-identity?path=...` exposes that relative path. Alias
resolution requires filesystem proof, including within Windows case-sensitive
directories, and checks canonical containment without merging symlink or hard-link
names. Explorer and definition opens resolve before creating state, serialize
concurrent requests and reject stale owners. Ambiguous existing buffers remain
untouched and identity failures offer Retry without an owner fallback.
The WebSocket bridge listens for client messages before its async workspace
lookup and queues them until the socket is validated, so an attach sent on
`open` is never dropped. A session `start()` issued while `stop()` is still
tearing down (a request during a user restart) waits for the stop instead of
launching a second process.
The WebSocket bridge sends `didClose` for tracked open documents when a socket
drops, allowing the warm shared process to be reused without stale text.
One browser document handle groups all of its physical server attachments,
broadcasts document synchronization to each, and supports targeted requests by
definition id. Replacing one member reacquires the ordered group and replays the
current buffer to every server.
Definitions may set per-definition process caps, request timeouts, and idle
timeouts. clangd shares by workspace and root, caps itself at four processes,
uses a two-minute request timeout, and remains idle for 30 minutes.
The `languageServers.maxSessions` setting defaults to 24 host-wide, and
`languageServers.maxSessionsPerWorkspace` defaults to 8 so one workspace cannot
consume the host budget. Each session is a real OS process, and monorepos with
many roots or languages may need a higher workspace limit. Both values are read
on every acquire. Lowering either gates future acquisitions without proactively
closing live sessions; capacity eviction never selects a referenced session.
`LanguageServerSession` starts lazily,
performs the LSP initialize handshake, preserves bounded stderr, and reports
`starting`, `indexing`, `ready`, `reconnecting`, `unavailable`, `timeout`, or
`failed`. Readable and writable transport errors both close the connection so
broken server pipes reject in-flight work and enter the normal restart lifecycle.
A successful handshake clears prior failure detail.

An executable that cannot be spawned is `unavailable`. A process that rejects or
exits during initialization is `failed`; an initialize request timeout is
`timeout`. A process that exits after reaching `ready` is reported as crashed.
Failure text is sanitized before it reaches the browser.

### Runtime discovery

Language adapters resolve project-specific runtimes before every start, including
manual retry. The Rust adapter prefers `rustup which rust-analyzer`, falls back to
PATH, and recognizes a PATH entry backed by the rustup proxy. A missing component
returns the recovery command `rustup component add rust-analyzer`; CoC only offers
the command for copying and never executes it.

The built-in Python preset serves `.py`, `.pyi`, and
`.pyw` through Pyright. Its adapter prefers a project
`node_modules/pyright/langserver.index.js`, then the `pyright` package shipped
with CoC, then `pyright-langserver` on the owning host's PATH. Project and
packaged entry points run through Node with `shell: false`; browser-visible
runtime labels contain only the source category. Python files use the nearest
configured project marker with canonical-path containment and the owning
workspace's path spelling.

The built-in clangd preset serves C, C++, Objective-C,
Objective-C++, and CUDA files with `--background-index=false`. Its adapter checks
the owning host's PATH before platform-specific LLVM install locations. Project
roots use only `compile_commands.json`, `.clangd`, and `compile_flags.txt`, keeping
large repositories sharded when component-local markers exist. Missing discovery
surfaces a platform-specific apt, Homebrew, or winget install command through the
existing runtime error state.

Workspace definitions pass no-database compiler options through
`initializationOptions.fallbackFlags`. clangd gives an in-tree compilation
database priority; `--compile-commands-dir=<directory>` selects an external one.
MSVC fallback flags use `--driver-mode=cl` and include the MSVC standard library
and Windows SDK `/I` paths. CoC does not generate databases or modify user clangd
configuration. The cross-platform validation workflow discovers those include
directories on a Windows runner and exercises a real `<vector>` translation unit
through the same `initializationOptions.fallbackFlags` path.

C and C++ go-to-definition targets the preferred semantic attachment and
`coc-symbols` concurrently through the grouped document handle. Any non-empty,
structurally valid semantic response is authoritative: exact locations keep the
server's order, are deduplicated by file and line, and discard the speculative
symbols response. An exact target the surface cannot load stays in the list as
an unavailable exact result rather than being replaced by textually similar
symbols.

The `coc-symbols` response is used when clangd is unavailable, fails,
does not advertise definition support, or returns no locations. Candidate ranges
come directly from its LSP locations, and candidate URIs carry a
`symbol-index-candidate` fragment. Explorer and unified-panel tabs preserve that
provenance and show an amber `Symbol candidate` pill on the destination until a
plain or exact cross-file open replaces it.

Cross-file locations inside an accepted workspace are prepared by the initiating
editor's temporary `coc-file` preview source. A repository editor accepts only
its own workspace; a repo-group editor also accepts every live member and reads
through the target member's workspace and concrete clone route. Standalone
Monaco resolves existing models through `editingModels.ts`, scoped by concrete
owner and editing session. Peek reuses an open dirty model; other accepted targets
receive a temporary model with a scoped URI after identity resolution. The routed
read updates that model in place. Unified-panel chats isolate document records and
transport editing sessions; a split mirror retains its tab's model. Unconfirmed
or ambiguous owners stop navigation before model creation with a retryable error.
Accepted targets whose reads fail receive an unavailable model. Cancellation removes stale
loading models, and temporary models are disposed when Peek detaches or the
editor closes. Prepared models remain available while a slow Peek widget
attaches and have a bounded orphan timeout when no widget claims them.

### External definition sources

A definition may name a file outside every workspace — a libstdc++ or libc++
header, an SDK header, a dependency source. The owning host canonicalizes that
target and replaces its `file://` URI with `coc-lsp-external://<capability>/<basename>`
in `ws-bridge.ts`. Only definition-family responses
(`textDocument/definition`, `declaration`, `typeDefinition`, `implementation`)
mint capabilities; every other response keeps its own URI. A target that is not
a readable regular file gets no capability and stays as an unavailable external
definition.

A capability is opaque, carries no host path, and is valid only for the issuing
socket, its workspace, the attachment that asked, and the exact canonical file.
It has a bounded lifetime and a per-socket retention limit that evicts the
oldest entry, and it is revoked when the attachment detaches or the socket
closes. Reads go over the same `lsp-external-source` request on the attachment's
own routed WebSocket, so a result from a remote clone is read from that clone
and never from the dashboard's local server. The host re-canonicalizes before
reading, so replacing the path with a symlink after issuance cannot redirect the
read, and it refuses missing, non-regular, oversized, and binary targets.
External paths are never added to `/api/fs/blob`, the trusted-directory list, or
the workspace file API.

In the browser, the Peek preview source loads an external target through the
attachment that received the definition and picks the Monaco language from the
display basename, falling back to the host's language hint for extensionless
standard-library headers. Confirming the result unmounts the pane whose
attachment owns the capability, so the loaded text is published to a
reference-counted store and handed to the tab instead of being re-read; the tab
holds the retain until it closes, and an unreferenced record is dropped after a
bounded timeout. External results are therefore always awaited before
navigation, even as the only result.

External sources open read-only in the surface that started the navigation — an
`external` Explorer tab or an `external` unified-panel tab, both keyed by the
capability rather than a path, carrying an `External · Read only` cue, and
offering no Save action or dirty state. They are never persisted, because the
capability dies with the language-server connection; a restored payload naming
one is rejected, and the recovery is a fresh Go to Definition. A repo-group
external tab is owned by the member and concrete clone whose language server
produced the result.
When `python.pythonPath` is absent, the adapter selects an executable interpreter
from project-root `.venv`, then `venv`, while preserving all explicit and
unrelated settings.

### Workspace symbol search (Go To All)

A symbol palette needs a live session with no file open. `acquireWorkspace`
detects applicable effective definitions from project markers and a bounded
file scan on each request, including custom file patterns, and roots each session
at the workspace root; the browser
reaches it through the `lsp-attach-workspace` client message, which returns the
same `lsp-attached` stream and uses the same request, cancel, and detach
framing as a document attach. No sentinel document path is involved.

The palette holds one workspace attachment per repository for as long as the
dialog is open — up to six in a repo group — and fans `workspace/symbol` out to
every attached server advertising `workspaceSymbolProvider`, merging each
answer as it arrives. A Ctrl/Cmd+, palette waits 500 ms of typing quiet before
each fan-out, aborting the superseded one. A server that times out, dies, or does not support the
method is "no answer": some failing is `partial`, all failing is `failed`, and
none of it throws into the dialog. There is no HTTP symbol route; the fan-out
is browser-side, so a group member on another host is reached directly.

`tsserver` answers `workspace/symbol` from the project holding the first open
file and answers nothing without one, so a TypeScript session opens a priming
document of its own before such a request when the editor has nothing open —
the first file under its project root the preset claims, resolved by
`prime-document.ts`. The editor's first `didOpen` closes it again, so the
user's file decides which project answers. Results stay scoped to that one
project, which is tsserver's own limit, not CoC's.

`coc-symbols-lsp` answers `workspace/symbol` with a camel-case-aware scorer: a
subsequence match weighted by word starts, with an all-word-starts acronym
(`fwc` → `findWorkspaceConfig`) ranked above an incidental one, and the prefix
index kept as the fast path. The cap applies after ranking. Each result carries
`cocMatchIndices`, the UTF-16 offsets the score used, which the palette
highlights from so the highlight and the ranking cannot disagree.

### User surfaces

The editor badge derives its label, tone, detail, and retry availability from the
session state. Failed states open an action panel with sanitized runtime detail,
an optional recovery command, and Retry. Language-independent browsing remains
available while language features are detached.

The Monaco completion provider translates its zero-based trigger kinds to LSP's
one-based kinds before sending `textDocument/completion` through the owning
document handle. Typing and explicit invocation use LSP kind 1, trigger
characters use kind 2, and incomplete-list retriggers use kind 3.
Completion stays registered for eligible models even without a server capability.
Ready/indexing servers with completion support supply authoritative items; empty
or failed requests and unavailable/unsupported servers fall back to deduplicated
current-document words. Fallback matches prefixes case-insensitively, preserves
word spelling, and caps each list at 200 items with incomplete retriggering.
Cancelled requests and disposed providers publish neither server nor word items.

Language Servers settings provides definition editing, custom definition removal,
and status/retry without enable controls. It reads live runtime rows from
`GET /api/workspaces/:id/language-servers`. Rows are grouped by definition and
project root, so mixed multi-root outcomes remain visible. Runtime payloads use
workspace-relative root labels and opaque session IDs; host paths, environment
values, capabilities, and internal session keys stay server-side.

### Semantic highlighting

The default client capabilities advertise semantic tokens (full and range, no
deltas, relative format) with refresh support. `semanticTokens.ts` reads a
session's `semanticTokensProvider` capability or its dynamic
`textDocument/semanticTokens` registration, decodes the server's data against
that server's legend, and re-encodes only the styled standard types
(namespace, types, parameters, variables, properties, enum members, functions,
methods, macros, decorators, plus the `readonly` modifier) against a fixed
`lsp.*` legend. Monaco styles every token it receives, so unknown types,
operators, and malformed replies are dropped and keep their Monarch colors.
`monaco-setup.ts` redefines the built-in `vs` and `vs-dark` themes with
inherited `lsp.*` rules, and the explorer and diff editors set
`semanticHighlighting.enabled`; there is no user setting.

`registerLanguageProviders` registers one semantic provider per document from
the first attachment, in host preference order, that advertises tokens. It
prefers the full-document request and uses the range request when it is the only
mode. Requests are skipped when the Monaco model text differs from the document
buffer. A failed request reports Monaco's `busy` signal so painted colors stay;
replacing or losing the server re-registers or removes the provider, which
clears them. A relayed refresh request or a replay to a restarted server fires
the provider's `onDidChange`. When two registrations share a model URI, only
the oldest live one requests tokens and hands over on dispose.

External definition sources get tokens through their capability: after Peek
loads one, `definitionPreview.ts` sends `lsp-external-semantic-tokens` on the
same attachment (none when that server advertises no tokens). The host opens the
exact canonical file in the issuing attachment's session just for that request,
then closes it, and drops `publishDiagnostics` for files outside the workspace.
The decoded tokens are stored on the `externalSourceStore` record, so the
read-only tab colors from them after the originating attachment is gone;
`externalSemanticTokens.ts` serves that record to exactly the Peek or tab model
whose text matches. A failed, unsupported, or cancelled request keeps basic
syntax colors.

### Diff documents

`MonacoFileDiffViewer` shares the explorer's reference-counted
`LanguageDocumentStore` only for real modified working-copy models: unstaged
diffs and server-confirmed clean branch-range heads. Branch-range eligibility
requires checked-out HEAD, a clean index/file, and byte-identical disk content;
the server rechecks it outside the immutable snapshot cache.
`diffLanguageEligibility` and the owned editor adapter reject synthetic or
foreign URIs. An unsaved explorer buffer disables diff language features without
overwriting that buffer, and closing a diff releases only its own document reference.

`currentCodeDefinitions.ts` supplies the ref-backed diff lookup primitive through
a routed workspace attachment, without opening an LSP document. It queries
capable workspace-symbol servers, accepts exact names only, validates each
result's workspace URI before normalization, and deduplicates positions. Results
carry symbol-candidate provenance. Disposal releases the attachment and aborts
pending lookups; cancellation suppresses late replies. Its workspace attachment
lifetime is independent of the working-copy document path.

`diffCurrentCodeMount.ts` provides a separate, definition-only Monaco mount for
ref-backed models within the size limit. It scopes providers to the exact model,
prepares candidate models through the routed Explorer reader for Peek, and uses
`definitionLinkCue` with a document-free resolver. Hover identifies current-code
results. Each invocation owns cancellation; disposal revokes pending answers and
releases providers, previews and the workspace attachment.

Viewer hosts opt in with `historicalDefinitions` plus the concrete clone
`routingRef`. The adapter's `attachHistoricalLanguage(side, mount)` mounts on a
side only while its model is `coc-diff-ref:`, so the working-copy document keeps
the full mount and ref-backed models never open one. Mounts are per side and
undone on model swap and dispose; a mount that cannot start leaves a plain diff.
Local commit and branch-range `DiffSource`s set `supportsCurrentCodeDefinitions`
(PR sources never do); `WorkingTreeFileDiff` opts in for the HEAD/index sides of
staged and unstaged diffs. `DiffDefinitionNavigate` receives the initiating side.

`diffDefinitionRoute.ts` decides where a diff jump lands: the shown file reveals
on the initiating side, another changed file of the review switches the review
there (same side), and any other file opens its current version at the line in
the unified panel's Explorer file tab (the `#repos/:id/explorer/:path` deep link
without a panel). Foreign-workspace targets are declined. `FileDiffPanel` holds
the reveal until that file's models are displayed and suppresses the hunk target
for it; the viewer's `revealTarget` goes through the controller's `reveal`, which
waits for attach and is dropped by a model swap. Peek stays Monaco's own.

### Retry

Editor retry travels over `/ws/language-server`. Settings retry uses
`POST /api/workspaces/:id/language-servers/retry` with an opaque `sessionId`.
Both restart only the selected session, rerun adapter discovery, and preserve the
classified failure state when another attempt fails.
