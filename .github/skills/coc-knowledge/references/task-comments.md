# CoC Task Comments

Inline comments on task results, anchored to selected text, for review and
AI-assisted follow-up. Comments are persistent, categorized, and local to the
workspace.

## Authoring flow

Open a task result in the task viewer (`coc serve`), select text, and press
`Cmd/Ctrl+Shift+M` — the only bound shortcut, and only active while a task result
is open. Pick an optional category, enter the text, and submit. The comment then
renders inline in the viewer and in the comments panel.

Categories are `bug`, `question`, `suggestion`, `praise`, `nitpick`, and
`general` (the default). They drive filtering and per-category counts in the
filter bar; a status filter selects open, resolved, or all.

## Anchoring

Each comment anchors to a text range via content fingerprinting plus surrounding
context (`contextBefore` / `contextAfter`). Fuzzy matching relocates the anchor
when content shifts, so comments survive a task re-run. Heavy modification can
break relocation; the originally anchored text stays stored on the comment and is
displayed on the card either way.

## Storage

```
{dataDir}/tasks-comments/{workspaceId}/{sha256(filePath)}.json
```

One file per task file, named by the SHA-256 of the file path, scoped to a
workspace by a deterministic workspace ID. Comments are plain JSON and can be
created or edited programmatically. They are metadata only — they never affect
task execution or pipeline results — and are not synced across machines; commit
the directory or `.gitignore` it depending on whether the team shares them.

```json
{
  "comments": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "text": "This function needs error handling",
      "category": "bug",
      "status": "open",
      "anchor": {
        "startLine": 42,
        "endLine": 45,
        "startColumn": 0,
        "endColumn": 25,
        "text": "function processData(input) {\n  return input.map(x => x.value);\n}",
        "contextBefore": "// Process input data",
        "contextAfter": "// Return results",
        "fingerprint": "a1b2c3d4"
      },
      "createdAt": "2026-01-15T10:30:00.000Z",
      "updatedAt": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

## AI prompt generation

Accumulated comments on a task result generate a structured prompt carrying task
context plus every comment with its category and anchored text, which can be sent
to an AI assistant for automated review. The typical loop is: run a pipeline,
comment issues by category, generate the prompt, iterate until comments resolve.

## Related

- `packages/coc/README.md` — main CoC documentation
- `CLAUDE.md` §"YAML Pipeline Framework" — pipeline configuration
- [spa/shell.md](spa/shell.md) — dashboard module layout
- [spa/notes.md](spa/notes.md) — Notes editor comment marks and decorations
