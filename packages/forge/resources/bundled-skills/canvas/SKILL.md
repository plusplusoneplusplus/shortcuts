---
name: canvas
description: Create or update a written, visual, code, or interactive artifact in the canvas. Use when the user selects /canvas or asks to put the result in a canvas.
metadata:
  author: CoC
  version: "0.0.1"
---

# Canvas

Put the main result in an AI canvas when this skill is selected. The text after `/canvas` is the artifact request. Examples include `/canvas write a rollout plan`, `/canvas draw the authentication flow`, `/canvas create an SVG deployment topology`, and `/canvas build an interactive revenue dashboard`.

If the remaining request is empty, ask what the user wants created or changed. Do not create an empty artifact.

## Choose the canvas form

Follow an explicit format request first. Otherwise use the simplest suitable form:

| Request | Canvas form | Tool |
|---|---|---|
| Plan, notes, report, prose, or mixed text and diagrams | Markdown | `write_canvas` |
| Source code or a code artifact | Code with the matching language | `write_canvas` |
| Diagram embedded in a written artifact | Markdown with Mermaid | `write_canvas` |
| Spatial diagram meant to be viewed as a drawing | Excalidraw | `write_canvas` with `type: "excalidraw"` |
| Standalone vector illustration | SVG code | `write_canvas` with `type: "code"` and `language: "svg"` |
| Dashboard, widget, chart, table, or another interactive artifact | Extension | `extension_canvas` |

Prefer a regular canvas unless interaction adds real value. If the requested format is unsupported, use the nearest supported form and briefly say which form you chose.

## Create or update

- Create a new canvas when the request does not identify an existing one.
- When the request includes a canvas ID or clearly refers to a canvas in the conversation, call `read_canvas` before editing unless you created that revision in the same turn.
- If more than one canvas could be the update target, ask which one to use before writing.
- Pass `expectedRevision` on every update. On a revision conflict, read the latest revision and reapply the requested change.
- Preserve the current canvas type during an update unless the user asks for another artifact type.
- Set `purpose` when the request gives the artifact a clear role such as `plan`, `notes`, or `goal`.

Keep the complete artifact in the canvas. End with a short chat summary that references the created or updated canvas instead of duplicating its content. For Excalidraw, include the returned `canvas://<id>` marker verbatim so the diagram renders inline.
