---
name: trace-callstack
description: Trace the call stack of a function or feature and render it as a nested, linked tree (caller → callee, each node a clickable file:line link). Use when the user asks to "trace the callstack", "show the call chain", "who calls X", "what does X call", or "walk me through how feature Y flows through the code".
metadata:
  author: Yiheng Tao
  version: "0.0.1"
---

# Trace Callstack

Produce a nested tree of function calls for a function or feature. Every node is a Markdown link to the exact definition or call site.

## Inputs

- **Target**: a function name, a `file:line`, or a feature description ("installing bundled skills").
- **Direction** (default `down`):
  - `down` — what the target calls (callees).
  - `up` — who calls the target (callers).
  - `both` — callers above, callees below.
- **Depth** (default `4`): stop expanding past this many levels.

If the target is a feature, first find its entry point (route handler, CLI command, UI event handler, exported API) and trace `down` from there.

## Procedure

1. **Locate the root.** Find the definition with `grep -n "function <name>\|<name> = \|<name>(" ` (or LSP go-to-definition if available). Record `file:line` of the definition.
2. **Expand one level.**
   - `down`: read the function body; list calls to project-owned functions, in call order. Skip stdlib, logging, trivial getters, and third-party calls unless they matter to the flow.
   - `up`: grep for call sites of the name; group by caller function; record the caller's definition line.
3. **Resolve each child** to its definition `file:line` (follow imports / re-exports). Keep the call-site line too.
4. **Recurse** until depth limit, a leaf (no project-owned calls), or a cycle. Mark cycles `↺` and do not re-expand an already-expanded node — write `(see above)`.
5. **Mark branches** that only run conditionally with a short note, e.g. `[if target exists]`.
6. **Verify**: every link must point to a line that actually contains the definition or call. Re-open files if unsure. Never invent a line number.

## Output Format

Nested bullet list, 4-space indent per level. Each node:

```
- [`functionName`](path/to/file.ts:LINE) — one-line purpose  ·  called at [file.ts:LINE](path/to/file.ts:LINE)
```

- The first link points to the **definition**.
- `called at` points to the **call site in the parent** (omit for the root).
- Paths are repo-relative.
- Keep the purpose under ~10 words. No prose between nodes.

After the tree, add at most 3 short bullets under **Notes** for things the tree cannot show (async boundaries, event emitters, dynamic dispatch, dependency injection you could not resolve).

### Example

```
- [`POST /api/workspaces/:id/skills/install`](packages/coc/src/server/skills/skill-handler.ts:656) — route entry
    - [`handleInstall`](packages/coc/src/server/skills/skill-route-handlers.ts:75) — parse body, pick source  ·  called at [skill-handler.ts:666](packages/coc/src/server/skills/skill-handler.ts:666)
        - [`getBundledSkills`](packages/forge/src/skills/bundled-skills-provider.ts:18) — list registry skills  ·  called at [skill-route-handlers.ts:86](packages/coc/src/server/skills/skill-route-handlers.ts:86)
```

## Big Trees

Budget: **~40 nodes** in one reply. Apply these in order until the tree fits:

1. **Prune noise.** Drop logging, error wrapping, formatting, simple getters, and generic utils (`path.join`, `safeExists`). Keep calls that change state, do I/O, branch the flow, or cross a module boundary.
2. **Dedupe.** Expand a shared function once; after that, write `(see above)`.
3. **Collapse chains.** If a node has exactly one project-owned child, and so does that child, merge them on one line: `a → b → c`. Link each name.
4. **Fold wide levels.** Past 8 children, keep the important ones and write `- … N more: x, y, z` (plain names, no links).
5. **Stop at the frontier.** At the depth or node budget, mark nodes you didn't expand with `▸`, then list them under **Expand next**. The user can pick one to trace as a new root.

If the user asks for the full tree, or it still needs more than ~40 nodes:

- **Overview + sections.** Show a depth-2 overview first. Then add one `###` section per major branch, each with its own subtree. In the overview, point to it: `▸ see §install`.
- **Path mode.** If the user cares about how A reaches B, show only the paths from A to B and drop every other branch.
- **Write to a file or canvas.** Put the full tree in a canvas (or `<name>.callstack.md` if no canvas is available). In chat, reply with the overview and the link.

## Rules

- Links only to code that exists in the workspace. For external packages, show the name in plain text without a link.
- Dynamic calls (callbacks, `routes.push`, event handlers, interface methods): link the registration site and say `(dynamic)`.
- Multi-repo: when the chain crosses workspaces or packages, keep full repo-relative paths so each link opens the right file.
- If the tree gets wider than ~8 children at one level, keep the important ones and add `- … N more (list names)`.
