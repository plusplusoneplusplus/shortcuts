# packages/coc

CoC CLI and integrated server. Consumes `@plusplusoneplusplus/forge`. See the
root `AGENTS.md` for the cross-package overview, build/test commands, and the
"repo-scoped data" convention. Deeper architecture references live under
`.github/skills/coc-knowledge/`.

## Ralph session journal

Each Ralph session owns a small file-backed journal under the repo data
directory. The store lives in `src/server/ralph/ralph-session-store.ts`.

### Layout

```
~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/
  session.json    # metadata (atomic write-temp + rename)
  progress.md     # append-only Markdown journal, AI-writable
```

`session.json` is a `RalphSessionRecord` (see `src/server/ralph/types.ts`):
`sessionId`, `workspaceId`, `originalGoal`, `maxIterations`,
`currentIteration`, `phase` (`'executing' | 'complete' | 'failed'`),
`startedAt`, and the per-iteration `iterations[]` (each with at least
`iteration`, `signal`, optional `processId`, `startedAt`, `completedAt`).

`progress.md` is a plain Markdown file. The store writes a small header on
init and then each iteration appends a section header followed by the AI's
narrative body:

```
## Iteration <N> — <SIGNAL> — <ISO_TIMESTAMP>
<body…>
```

`SIGNAL` is one of `RALPH_NEXT`, `RALPH_COMPLETE`, `NONE`. The em dash is
preferred but the parser also accepts a plain `-` separator.

### Write protocol

The Ralph executor is the only writer. It must:

1. Call `RalphSessionStore.initSession(workspaceId, sessionId, …)` once at
   the start of the session — idempotent.
2. After each iteration, call `appendProgressSection(...)` with the
   iteration number, exit signal, and the AI-produced summary body.
3. After each iteration, call `updateSessionRecord(...)` to bump
   `currentIteration`, append to `iterations[]`, and update `phase`
   on terminal signals.

Readers (REST handlers, the SPA hook `useRalphSessionView`) treat
`progress.md` and `session.json` as the source of truth and never mutate
either file. Readers tolerate a missing journal as `null`/empty and tolerate
a partially written `session.json` as `null` (the next mutator pass
rewrites it).

### Size cap

`appendProgressSection` enforces a defensive 10 MB cap on `progress.md`.
When the file exceeds the cap, the store keeps only the last ~500 KB of
content and prepends a `# Ralph Session (truncated)` banner that records
the original byte size. This is a hard, lossy guard — there is no
compaction logic and no historical archive — so the journal stays bounded
even for runaway sessions.
