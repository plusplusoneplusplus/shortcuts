# Language Servers

Workspace-scoped language support spans the CoC server, `coc-client`, and the
dashboard file editor.

### Session lifecycle

`LanguageServerManager` keys sessions by workspace, browser editing session,
definition, and resolved project root by default. Definitions may select
workspace scope to share an expensive process across editing sessions, and may
set per-definition process caps, request timeouts, and idle timeouts. clangd
shares by workspace and root, caps itself at four processes, uses a two-minute
request timeout, and remains idle for 30 minutes. `LanguageServerSession` starts lazily,
performs the LSP initialize handshake, preserves bounded stderr, and reports
`starting`, `indexing`, `ready`, `reconnecting`, `unavailable`, `timeout`, or
`failed`. A successful handshake clears prior failure detail.

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

The built-in Python preset is disabled by default and serves `.py`, `.pyi`, and
`.pyw` through Pyright. Its adapter prefers a project
`node_modules/pyright/langserver.index.js`, then the `pyright` package shipped
with CoC, then `pyright-langserver` on the owning host's PATH. Project and
packaged entry points run through Node with `shell: false`; browser-visible
runtime labels contain only the source category. Python files use the nearest
configured project marker with canonical-path containment and the owning
workspace's path spelling.

The built-in clangd preset is disabled by default and serves C, C++, Objective-C,
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
configuration.

C and C++ go-to-definition combines clangd locations with the owning workspace's
persistent symbol-index candidates in the Monaco provider. Exact locations sort
first, results are deduplicated by file and line, and candidate URIs carry a
`symbol-index-candidate` fragment. The index continues to answer when clangd is
disabled, unavailable, or does not advertise definition support.
When `python.pythonPath` is absent, the adapter selects an executable interpreter
from project-root `.venv`, then `venv`, while preserving all explicit and
unrelated settings.

### User surfaces

The editor badge derives its label, tone, detail, and retry availability from the
session state. Failed states open an action panel with sanitized runtime detail,
an optional recovery command, and Retry. Language-independent browsing remains
available while language features are detached.

Language Servers settings reads live runtime rows from
`GET /api/workspaces/:id/language-servers`. Rows are grouped by definition and
project root, so mixed multi-root outcomes remain visible. Runtime payloads use
workspace-relative root labels and opaque session IDs; host paths, environment
values, capabilities, and internal session keys stay server-side.

### Retry

Editor retry travels over `/ws/language-server`. Settings retry uses
`POST /api/workspaces/:id/language-servers/retry` with an opaque `sessionId`.
Both restart only the selected session, rerun adapter discovery, and preserve the
classified failure state when another attempt fails.
