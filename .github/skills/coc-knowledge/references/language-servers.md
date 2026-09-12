# Language Servers

Workspace-scoped language support spans the CoC server, `coc-client`, and the
dashboard file editor.

### Session lifecycle

`LanguageServerManager` keys sessions by workspace, browser editing session,
definition, and resolved project root. `LanguageServerSession` starts lazily,
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
runtime labels contain only the source category.

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
