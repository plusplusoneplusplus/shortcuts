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
| Dashboard, widget, chart, table, or another interactive artifact | Conversation extension.mjs package | `extension_canvas` |

Prefer a regular canvas unless interaction adds real value. If the requested format is unsupported, use the nearest supported form and briefly say which form you chose.

## Create or update

- Create a new canvas when the request does not identify an existing one.
- When the request includes a canvas ID or clearly refers to a canvas in the conversation, call `read_canvas` before editing unless you created that revision in the same turn.
- If more than one canvas could be the update target, ask which one to use before writing.
- Pass `expectedRevision` on every update. On a revision conflict, read the latest revision and reapply the requested change.
- Preserve the current canvas type during an update unless the user asks for another artifact type.
- Set `purpose` when the request gives the artifact a clear role such as `plan`, `notes`, or `goal`.

Keep the complete artifact in the canvas. End with a short chat summary that references the created or updated canvas instead of duplicating its content. For Excalidraw, include the returned `canvas://<id>` marker verbatim so the diagram renders inline.

## Interactive artifacts

`extension_canvas` publishes a managed, conversation-owned copy of an absolute staged
`extension.mjs` and explicit `assets: [{ path, sourcePath }]`. Stage source in the owning checkout,
a registered group member, or an authorized temporary directory. Copy persisted
source into staging before editing it. Create with `sourcePath`
and `declaredCanvasId`; update with saved `canvasId` and `expectedRevision`. Updates
replace the full asset set; omitted input preserves saved input. Use `read_canvas`
for the source path, asset locations and revision. Inspect/edit source by path.

The live `canvasExtensions.enabled` setting permits Node execution with filesystem
and network access. This requires a write-capable turn and follows tool approval
policy. A separate HOME and desktop guest provide isolation, not a Node sandbox.
Package only self-contained code and explicit assets; compile browser JSX yourself
before staging it. CoC installs no dependencies. Entry limit: 512 KiB; assets: 20,
8 MiB each; package: 32 MiB; host startup: 60 seconds.

Use the SDK `joinSession` and `createCanvas` from
`@github/copilot-sdk/extension`. Return an IPv4 loopback HTTP URL from `open`, expose
named actions, and close each instance's server in `onClose`. The UI mounts only in
the local CoC desktop unified panel. Browser, remote, inline and pop-out views show
the supported desktop-open affordance. Include the returned `canvas://<id>` marker.

Source and `session.workspacePath` state persist across close, archive and restart.
Persist application state under that path, which is already scoped to the generated
package. Write atomically and reload it when opening. For example:

```js
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function loadState(workspacePath, fallback) {
  try { return JSON.parse(await readFile(join(workspacePath, 'state.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function saveState(workspacePath, value) {
  const target = join(workspacePath, 'state.json');
  const temporary = join(workspacePath, `.state-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, target);
}
```

Use `list_canvas_capabilities`, `manage_canvas` open/close/reload, and
`invoke_canvas_action` for later operations. Close preserves source/input/state.
Reload and replacement discard runtime memory and unsaved page input, preserve
application files, and never replay failed actions. `manage_canvas` delete
permanently removes the generated package, all its instances and state. Deleting
the owning chat does the same. Installed extensions reject permanent deletion.

Packages and application state are machine-local and excluded from snapshots.
Interactive applications have no generic offline HTML export. Persisted unsupported
artifact records are retired; missing transcript embeds use normal missing-canvas
behavior. Markdown, code, SVG and Excalidraw retain their ordinary exports.
