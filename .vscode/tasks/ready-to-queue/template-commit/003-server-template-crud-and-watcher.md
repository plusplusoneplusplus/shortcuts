---
status: pending
commit: "003"
title: "coc server: add template CRUD handler and watcher"
depends_on: ["002"]
files:
  - packages/coc/src/server/templates-handler.ts
  - packages/coc/src/server/template-watcher.ts
---

# 003 — coc server: add template CRUD handler and watcher

## Summary

Add two new files to `packages/coc/src/server/` that expose REST CRUD endpoints for workspace templates and a file-system watcher that triggers WebSocket broadcasts on template changes. The handler follows the exact pattern established by `pipelines-handler.ts`; the watcher clones `pipeline-watcher.ts`.

## Motivation

The server dashboard needs to list, create, update, and delete template YAML files stored in each workspace's `.vscode/templates/` directory. A watcher enables real-time UI updates when templates are edited externally (e.g., via VS Code or git).

## Dependencies

- **Depends on:** commit 002 — `pipeline-core` must export `Template`, `CommitTemplate`, and related types from `@plusplusoneplusplus/pipeline-core`.
- **Depended on by:** commit 005 — wiring these routes and watcher into `packages/coc/src/server/index.ts`.

## Assumed Prior State

- `packages/pipeline-core/src/templates/types.ts` exports `Template`, `CommitTemplate` (discriminated union with `kind: 'commit'`).
- `@plusplusoneplusplus/pipeline-core` barrel re-exports all template types.
- `js-yaml` is already a dependency of the coc package (used in `pipelines-handler.ts`).
- `pipeline-core` exports `GitLogService`, `isWithinDirectory` from their respective subpaths.

---

## Files to Create

### 1. `packages/coc/src/server/templates-handler.ts`

Two exported registration functions, mirroring the read/write split in `pipelines-handler.ts`:

```typescript
export function registerTemplateRoutes(routes: Route[], store: ProcessStore): void;
export function registerTemplateWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    onTemplatesChanged?: (workspaceId: string) => void,
): void;
```

#### Internal Helpers

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Route } from '@plusplusoneplusplus/coc-server';
import { ProcessStore, isWithinDirectory } from '@plusplusoneplusplus/pipeline-core';
import { GitLogService } from '@plusplusoneplusplus/pipeline-core/git';
import { CommitTemplate } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from './api-handler-imports'; // actual path TBD — may use coc-server re-exports
```

**`resolveWorkspace(store, id)`** — local helper (same as every other handler):

```typescript
async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}
```

**`TEMPLATES_DIR`** constant:

```typescript
const TEMPLATES_DIR = '.vscode/templates';
```

**`resolveAndValidateTemplatePath(base, name)`** — path traversal guard:

```typescript
function resolveAndValidateTemplatePath(base: string, name: string): string | null {
    const resolved = path.resolve(base, name);
    if (isWithinDirectory(resolved, base)) { return resolved; }
    return null;
}
```

**`readTemplateFile(filePath)`** — reads and parses a single `.yaml` file:

```typescript
async function readTemplateFile(filePath: string): Promise<Record<string, unknown> | null> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = yaml.load(raw);
        if (typeof parsed !== 'object' || parsed === null) { return null; }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}
```

---

#### Route Definitions

All routes live under `/api/workspaces/:id/templates`. The workspace ID capture group is `([^/]+)`. Template name capture group is also `([^/]+)`.

##### Route 1 — `GET /api/workspaces/:id/templates` (list)

Registered by `registerTemplateRoutes`.

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/templates$/,
    handler: async (_req, res, match) => {
        const workspaceId = decodeURIComponent(match![1]);
        const ws = await resolveWorkspace(store, workspaceId);
        if (!ws) { return sendError(res, 404, 'Workspace not found'); }

        const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
        let entries: string[];
        try {
            entries = await fs.promises.readdir(templatesDir);
        } catch {
            // Directory doesn't exist — return empty list, not an error
            return sendJSON(res, 200, { templates: [] });
        }

        const yamlFiles = entries.filter(e => e.endsWith('.yaml') || e.endsWith('.yml'));
        const templates: Record<string, unknown>[] = [];

        for (const file of yamlFiles) {
            const filePath = path.join(templatesDir, file);
            const parsed = await readTemplateFile(filePath);
            if (parsed) {
                // Inject the filename (sans extension) as `_fileName` for client convenience
                parsed._fileName = path.basename(file, path.extname(file));
                templates.push(parsed);
            }
        }

        sendJSON(res, 200, { templates });
    },
});
```

**Behaviour:**
- Returns `{ templates: [] }` when `.vscode/templates/` doesn't exist (graceful).
- Filters to `.yaml` / `.yml` extensions only.
- Skips files that fail to parse (malformed YAML) silently — they are omitted from the list.
- Injects `_fileName` (the stem of the filename) into each parsed object so the client can reference templates by name.

##### Route 2 — `GET /api/workspaces/:id/templates/:name` (read single)

Registered by `registerTemplateRoutes`.

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/,
    handler: async (_req, res, match) => {
        const workspaceId = decodeURIComponent(match![1]);
        const templateName = decodeURIComponent(match![2]);
        const ws = await resolveWorkspace(store, workspaceId);
        if (!ws) { return sendError(res, 404, 'Workspace not found'); }

        const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
        const filePath = resolveAndValidateTemplatePath(templatesDir, `${templateName}.yaml`);
        if (!filePath) { return sendError(res, 403, 'Access denied: invalid template name'); }

        const parsed = await readTemplateFile(filePath);
        if (!parsed) { return sendError(res, 404, 'Template not found'); }

        // Enrich with commit metadata if this is a commit-kind template
        if (parsed.kind === 'commit' && typeof parsed.commitHash === 'string') {
            try {
                const gitLog = new GitLogService();
                const commit = gitLog.getCommit(ws.rootPath, parsed.commitHash);
                if (commit) {
                    parsed._commit = {
                        shortHash: commit.shortHash,
                        subject: commit.subject,
                        authorName: commit.authorName,
                        date: commit.date,
                        relativeDate: commit.relativeDate,
                    };
                }
                gitLog.dispose();
            } catch {
                // Git metadata is best-effort — swallow errors
            }
        }

        parsed._fileName = templateName;
        sendJSON(res, 200, parsed);
    },
});
```

**Behaviour:**
- Appends `.yaml` extension to the `:name` param automatically.
- Path traversal guard via `resolveAndValidateTemplatePath` → 403.
- If `kind === 'commit'` and `commitHash` is present, calls `GitLogService.getCommit()` to attach `_commit` metadata (shortHash, subject, author, date). This is best-effort — failures are swallowed.
- Returns the full parsed YAML object as JSON, enriched with `_fileName` and optional `_commit`.

##### Route 3 — `POST /api/workspaces/:id/templates` (create)

Registered by `registerTemplateWriteRoutes`.

```typescript
routes.push({
    method: 'POST',
    pattern: /^\/api\/workspaces\/([^/]+)\/templates$/,
    handler: async (req, res, match) => {
        const workspaceId = decodeURIComponent(match![1]);
        const ws = await resolveWorkspace(store, workspaceId);
        if (!ws) { return sendError(res, 404, 'Workspace not found'); }

        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return sendError(res, 400, 'Invalid JSON body');
        }

        // --- Validation ---
        const { name, kind, commitHash, description, hints } = body || {};

        if (!name || typeof name !== 'string' || !name.trim()) {
            return sendError(res, 400, 'Missing required field: name');
        }
        const trimmedName = name.trim();

        // Path safety: no slashes, no dot-dot
        if (trimmedName.includes('/') || trimmedName.includes('\\') || trimmedName.includes('..')) {
            return sendError(res, 403, 'Access denied: invalid template name');
        }

        if (!kind || typeof kind !== 'string') {
            return sendError(res, 400, 'Missing required field: kind');
        }
        if (kind !== 'commit') {
            return sendError(res, 400, `Unsupported template kind: ${kind}. Supported: commit`);
        }

        // Commit-kind requires commitHash
        if (kind === 'commit') {
            if (!commitHash || typeof commitHash !== 'string' || !commitHash.trim()) {
                return sendError(res, 400, 'Missing required field: commitHash (required for commit kind)');
            }
        }

        // --- Check for conflict ---
        const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
        const filePath = path.join(templatesDir, `${trimmedName}.yaml`);
        const resolvedPath = resolveAndValidateTemplatePath(templatesDir, `${trimmedName}.yaml`);
        if (!resolvedPath) { return sendError(res, 403, 'Access denied: invalid template name'); }

        try {
            await fs.promises.stat(resolvedPath);
            return sendError(res, 409, 'Template already exists');
        } catch {
            // Good — file doesn't exist
        }

        // --- Build template object ---
        const template: Record<string, unknown> = {
            name: trimmedName,
            kind,
        };
        if (kind === 'commit') {
            template.commitHash = commitHash.trim();
        }
        if (description && typeof description === 'string') {
            template.description = description;
        }
        if (Array.isArray(hints) && hints.length > 0) {
            template.hints = hints.filter((h: unknown) => typeof h === 'string');
        }

        // --- Write file ---
        const yamlContent = yaml.dump(template, { lineWidth: 120, noRefs: true });
        await fs.promises.mkdir(templatesDir, { recursive: true });
        await fs.promises.writeFile(resolvedPath, yamlContent, 'utf-8');

        onTemplatesChanged?.(workspaceId);
        sendJSON(res, 201, { name: trimmedName, path: resolvedPath });
    },
});
```

**Validation rules:**
| Field | Rule | Error |
|-------|------|-------|
| `name` | Required, non-empty string, no `/`, `\`, `..` | 400 or 403 |
| `kind` | Required, must be `'commit'` | 400 |
| `commitHash` | Required when `kind === 'commit'`, non-empty string | 400 |
| `description` | Optional string | — |
| `hints` | Optional string array | — |
| (conflict) | File must not already exist | 409 |

**Side effects:** Creates `.vscode/templates/` directory (recursive) on first write. Calls `onTemplatesChanged(workspaceId)` after successful write.

##### Route 4 — `PATCH /api/workspaces/:id/templates/:name` (update)

Registered by `registerTemplateWriteRoutes`.

```typescript
routes.push({
    method: 'PATCH',
    pattern: /^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/,
    handler: async (req, res, match) => {
        const workspaceId = decodeURIComponent(match![1]);
        const templateName = decodeURIComponent(match![2]);
        const ws = await resolveWorkspace(store, workspaceId);
        if (!ws) { return sendError(res, 404, 'Workspace not found'); }

        const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
        const resolvedPath = resolveAndValidateTemplatePath(templatesDir, `${templateName}.yaml`);
        if (!resolvedPath) { return sendError(res, 403, 'Access denied: invalid template name'); }

        // Verify file exists
        try {
            await fs.promises.stat(resolvedPath);
        } catch {
            return sendError(res, 404, 'Template not found');
        }

        let body: any;
        try {
            body = await parseBody(req);
        } catch {
            return sendError(res, 400, 'Invalid JSON body');
        }

        if (!body || typeof body !== 'object') {
            return sendError(res, 400, 'Request body must be a JSON object');
        }

        // Read existing template, merge with updates
        const existing = await readTemplateFile(resolvedPath);
        if (!existing) { return sendError(res, 500, 'Failed to read existing template'); }

        // Apply allowed field updates (whitelist approach)
        const allowedFields = ['description', 'hints', 'commitHash', 'kind'];
        for (const field of allowedFields) {
            if (field in body) {
                existing[field] = body[field];
            }
        }

        // Re-validate after merge
        if (existing.kind === 'commit') {
            if (!existing.commitHash || typeof existing.commitHash !== 'string') {
                return sendError(res, 400, 'commitHash is required for commit kind');
            }
        }

        // `name` field in YAML always matches the filename — do not allow rename via PATCH
        existing.name = templateName;

        // Remove internal fields before writing
        delete existing._fileName;
        delete existing._commit;

        const yamlContent = yaml.dump(existing, { lineWidth: 120, noRefs: true });
        await fs.promises.writeFile(resolvedPath, yamlContent, 'utf-8');

        onTemplatesChanged?.(workspaceId);
        sendJSON(res, 200, { name: templateName, path: resolvedPath });
    },
});
```

**Behaviour:**
- Reads the existing YAML, merges allowed fields from the request body (whitelist: `description`, `hints`, `commitHash`, `kind`).
- The `name` field is always pinned to the filename — renaming requires delete + create.
- Internal enrichment fields (`_fileName`, `_commit`) are stripped before writing.
- Re-validates commit-kind constraints after merge.
- Calls `onTemplatesChanged` after write.

##### Route 5 — `DELETE /api/workspaces/:id/templates/:name` (delete)

Registered by `registerTemplateWriteRoutes`.

```typescript
routes.push({
    method: 'DELETE',
    pattern: /^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/,
    handler: async (_req, res, match) => {
        const workspaceId = decodeURIComponent(match![1]);
        const templateName = decodeURIComponent(match![2]);
        const ws = await resolveWorkspace(store, workspaceId);
        if (!ws) { return sendError(res, 404, 'Workspace not found'); }

        const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
        const resolvedPath = resolveAndValidateTemplatePath(templatesDir, `${templateName}.yaml`);
        if (!resolvedPath) { return sendError(res, 403, 'Access denied: invalid template name'); }

        try {
            await fs.promises.stat(resolvedPath);
        } catch {
            return sendError(res, 404, 'Template not found');
        }

        await fs.promises.unlink(resolvedPath);
        onTemplatesChanged?.(workspaceId);
        sendJSON(res, 200, { deleted: templateName });
    },
});
```

**Behaviour:**
- Deletes the single `.yaml` file (not a directory — unlike pipelines which are directories).
- 404 if the file doesn't exist; 403 on path traversal.
- Calls `onTemplatesChanged` after successful deletion.

---

#### Route Summary Table

| # | Method | Regex Pattern | Registered By | Response |
|---|--------|---------------|---------------|----------|
| 1 | `GET` | `/^\/api\/workspaces\/([^/]+)\/templates$/` | `registerTemplateRoutes` | `{ templates: [...] }` |
| 2 | `GET` | `/^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/` | `registerTemplateRoutes` | `{ name, kind, ... , _commit? }` |
| 3 | `POST` | `/^\/api\/workspaces\/([^/]+)\/templates$/` | `registerTemplateWriteRoutes` | `{ name, path }` (201) |
| 4 | `PATCH` | `/^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/` | `registerTemplateWriteRoutes` | `{ name, path }` |
| 5 | `DELETE` | `/^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/` | `registerTemplateWriteRoutes` | `{ deleted: name }` |

#### Error Response Matrix

| Condition | Status | Message |
|-----------|--------|---------|
| Workspace not found | 404 | `Workspace not found` |
| Template not found | 404 | `Template not found` |
| Directory doesn't exist (list) | 200 | `{ templates: [] }` (graceful) |
| Invalid JSON body | 400 | `Invalid JSON body` |
| Missing `name` | 400 | `Missing required field: name` |
| Missing `kind` | 400 | `Missing required field: kind` |
| Unsupported kind | 400 | `Unsupported template kind: {kind}. Supported: commit` |
| Missing `commitHash` for commit kind | 400 | `Missing required field: commitHash (required for commit kind)` |
| Path traversal attempt | 403 | `Access denied: invalid template name` |
| Template already exists (create) | 409 | `Template already exists` |
| Failed to read existing (update) | 500 | `Failed to read existing template` |

---

### 2. `packages/coc/src/server/template-watcher.ts`

Direct clone of `pipeline-watcher.ts` (lines 21–133 of that file), with three substitutions:

| pipeline-watcher.ts | template-watcher.ts |
|---------------------|---------------------|
| `PipelinesChangedCallback` | `TemplatesChangedCallback` |
| `PipelineWatcher` | `TemplateWatcher` |
| `'.vscode', 'pipelines'` | `'.vscode', 'templates'` |

```typescript
import * as fs from 'fs';
import * as path from 'path';

export type TemplatesChangedCallback = (workspaceId: string) => void;

const DEBOUNCE_MS = 300;

export class TemplateWatcher {
    private watchers = new Map<string, fs.FSWatcher>();
    private timers = new Map<string, ReturnType<typeof setTimeout>>();
    private onTemplatesChanged: TemplatesChangedCallback;

    constructor(onTemplatesChanged: TemplatesChangedCallback) {
        this.onTemplatesChanged = onTemplatesChanged;
    }

    watchWorkspace(workspaceId: string, rootPath: string): void;
    unwatchWorkspace(workspaceId: string): void;
    closeAll(): void;
    isWatching(workspaceId: string): boolean;

    // private: debounceFire(workspaceId), cleanupWatcher(workspaceId)
}
```

#### Implementation Details

- **`watchWorkspace(workspaceId, rootPath)`:**
  1. If `this.watchers.has(workspaceId)` → return (already watching).
  2. Build `templatesDir = path.join(rootPath, '.vscode', 'templates')`.
  3. `fs.statSync(templatesDir)` — if throws or not a directory → return silently (graceful for missing dir).
  4. `fs.watch(templatesDir, { recursive: true }, () => this.debounceFire(workspaceId))`.
  5. Attach `watcher.on('error', () => this.cleanupWatcher(workspaceId))`.
  6. `this.watchers.set(workspaceId, watcher)`.
  7. Entire body wrapped in try/catch — `fs.watch` can throw if the path disappears between stat and watch.

- **`unwatchWorkspace(workspaceId)`** → delegates to `cleanupWatcher`.

- **`closeAll()`** → iterates `this.watchers` keys, calls `cleanupWatcher` for each.

- **`isWatching(workspaceId)`** → `this.watchers.has(workspaceId)`.

- **`debounceFire(workspaceId)` (private):**
  1. Clear any existing timer for this workspace.
  2. `setTimeout(() => { ... }, DEBOUNCE_MS)` where the callback checks `this.watchers.has(workspaceId)` (guard: still watching?) before calling `this.onTemplatesChanged(workspaceId)`.
  3. Store timer in `this.timers`.

- **`cleanupWatcher(workspaceId)` (private):**
  1. Clear timer if exists, delete from map.
  2. Close watcher if exists (try/catch ignore), delete from map.

---

## Files to Modify

None — this is a pure additive commit. Wiring into `index.ts` happens in commit 005.

---

## Import Graph

```
templates-handler.ts
  ├── fs, path, js-yaml (Node builtins + existing dep)
  ├── @plusplusoneplusplus/coc-server  → Route type
  ├── @plusplusoneplusplus/pipeline-core  → ProcessStore, isWithinDirectory, CommitTemplate
  ├── @plusplusoneplusplus/pipeline-core/git  → GitLogService
  └── sendJSON, sendError, parseBody  → from coc-server api-handler (or local re-export)

template-watcher.ts
  ├── fs, path (Node builtins only)
  └── (no external deps)
```

Note: Check the actual import paths used in `pipelines-handler.ts` for `sendJSON`, `sendError`, `parseBody` — they may come from `@plusplusoneplusplus/coc-server` or from a local re-export. Match the existing pattern exactly.

---

## Tests

Tests for these files should be added alongside (or in a follow-up), following the pattern in `packages/coc/test/server/`:

### `templates-handler.test.ts`

1. **"GET /templates returns empty array when directory missing"** — Mock `store.getWorkspaces()` to return a workspace. Assert response is `{ templates: [] }`.
2. **"GET /templates lists YAML files"** — Create a temp dir with two `.yaml` files. Assert response contains both parsed templates.
3. **"GET /templates/:name returns 404 for missing template"** — Assert 404 with `Template not found`.
4. **"GET /templates/:name enriches commit templates with git metadata"** — Mock `GitLogService.getCommit` to return commit info. Assert `_commit` field is present.
5. **"POST /templates validates required fields"** — Send body without `name` → 400. Without `kind` → 400. With `kind: 'commit'` but no `commitHash` → 400.
6. **"POST /templates creates file and calls onTemplatesChanged"** — Assert file is written, YAML is valid, callback was called.
7. **"POST /templates returns 409 on duplicate"** — Pre-create the file, then POST → 409.
8. **"POST /templates rejects path traversal"** — Name with `../` → 403.
9. **"PATCH /templates/:name merges fields"** — Pre-create template, PATCH with `{ description: 'updated' }`. Read file back, assert description changed.
10. **"DELETE /templates/:name deletes file and calls callback"** — Pre-create, DELETE, assert file gone and callback called.

### `template-watcher.test.ts`

1. **"watchWorkspace ignores missing directory"** — Pass non-existent path. Assert no error, `isWatching()` returns false.
2. **"watchWorkspace is idempotent"** — Call twice with same id. Assert only one watcher created.
3. **"fires callback after debounce"** — Create a temp dir, watch it, write a file. Assert callback fires within 500ms.
4. **"unwatchWorkspace stops watching"** — Watch, unwatch, write file. Assert callback not called.
5. **"closeAll cleans up all watchers"** — Watch two workspaces, closeAll, assert both stopped.

---

## Acceptance Criteria

- [ ] `templates-handler.ts` exports `registerTemplateRoutes` and `registerTemplateWriteRoutes`
- [ ] `GET /api/workspaces/:id/templates` returns parsed YAML templates from `.vscode/templates/`
- [ ] `GET /api/workspaces/:id/templates` returns `{ templates: [] }` when directory doesn't exist
- [ ] `GET /api/workspaces/:id/templates/:name` returns single template with optional `_commit` enrichment
- [ ] `POST /api/workspaces/:id/templates` validates `name`, `kind`, `commitHash` and writes YAML
- [ ] `POST /api/workspaces/:id/templates` creates `.vscode/templates/` directory if missing
- [ ] `POST /api/workspaces/:id/templates` returns 409 if template already exists
- [ ] `PATCH /api/workspaces/:id/templates/:name` merges allowed fields and re-validates
- [ ] `DELETE /api/workspaces/:id/templates/:name` removes the file
- [ ] All mutation routes call `onTemplatesChanged(workspaceId)` after success
- [ ] All routes enforce path traversal protection via `isWithinDirectory`
- [ ] `template-watcher.ts` exports `TemplateWatcher` and `TemplatesChangedCallback`
- [ ] `TemplateWatcher` debounces at 300ms and gracefully handles missing directories
- [ ] No existing tests are broken
- [ ] `npm run build` succeeds with no type errors in the new files
