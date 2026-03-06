# Context: Paste Image in Generate Task with AI

## Goal
Enable users to paste images (screenshots, mockups, diagrams) into the "Generate Task with AI" dialog as visual context for AI task generation, leveraging the Copilot SDK's existing file attachment and vision support.

## Commit Sequence
1. Add attachments to SDK wrapper types
2. Forward attachments in SDK service
3. Thread attachments through AI invoker
4. Add paste image UI to task dialog
5. Wire image handling in task commands

## Key Decisions
- Images are for AI context only — not persisted in the generated task file
- Images are saved to OS temp dir as files (SDK requires file paths, not base64)
- Temp files are cleaned up in a `finally` block after AI invocation
- Commit 4 (UI) is independent of commits 1-3 (backend) — can be developed in parallel
- Both "create" and "from-feature" dialog modes support image paste

## Conventions
- Attachment type mirrors SDK's `MessageOptions.attachments` element: `{ type: "file"|"directory", path: string, displayName?: string }`
- `images` field on task creation options carries base64 data URLs (webview → extension boundary)
- Conversion from base64 to temp file happens in `ai-task-commands.ts` (the handler layer)
- CSP must include `img-src data:` for base64 thumbnail previews in the webview
