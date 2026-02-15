---
status: pending
commit: "003"
title: Add prompt/skill discovery REST endpoints to CoC server
depends_on: ["001"]
---

# 003 — Add prompt/skill discovery REST endpoints to CoC server

## Goal

Expose the pipeline-core `findPromptFiles()` and `findSkills()` functions
(created in commit 001) as REST endpoints in the CoC execution server so the
SPA dashboard can fetch available prompts and skills for a given workspace.

## Context

- Commit 001 adds `findPromptFiles(rootDir, locations?)` and
  `findSkills(rootDir, skillsLocation?)` to `pipeline-core`, exported from
  `packages/pipeline-core/src/discovery/index.ts` and re-exported from the
  package root.  Types: `PromptFileInfo` and `SkillInfo`.
- The CoC server (357 lines in `packages/coc/src/server/index.ts`) registers
  routes via mutating a `Route[]` array: each handler file exports a
  `registerXxxRoutes(routes, store)` function.
- Routes use raw Node.js `http.IncomingMessage` / `http.ServerResponse`.
  Helpers `sendJSON(res, code, data)`, `sendError(res, code, msg)`, and
  `parseBody(req)` live in `api-handler.ts`.
- `Route` type: `{ method?: string; pattern: string | RegExp; handler: (req, res, match?) => void | Promise<void> }` (from `types.ts`).
- Every workspace-scoped handler duplicates a local `resolveWorkspace()` helper
  (see `tasks-handler.ts:50-53`, `task-generation-handler.ts:41-44`).
- `WorkspaceInfo` has `{ id, name, rootPath, color? }` — `rootPath` is the
  absolute workspace directory.
- `@plusplusoneplusplus/pipeline-core` is already a dependency of `packages/coc`.
- The `tasks-handler.ts` (590 lines) and `task-generation-handler.ts` are the
  closest models for this new file.

## Prior-art patterns (verified from codebase)

| Pattern | Source | Line(s) |
|---------|--------|---------|
| Route registration signature | `export function registerTaskRoutes(routes: Route[], store: ProcessStore): void` | `tasks-handler.ts:63` |
| Workspace resolution helper | `async function resolveWorkspace(store, id) { … store.getWorkspaces().find(w => w.id === id) }` | `tasks-handler.ts:50-53` |
| Route regex capture group | `/^\/api\/workspaces\/([^/]+)\/tasks\/content$/` | `tasks-handler.ts:71` |
| ID decoding | `const id = decodeURIComponent(match![1]);` | `tasks-handler.ts:73` |
| 404 for missing workspace | `if (!ws) { return sendError(res, 404, 'Workspace not found'); }` | `tasks-handler.ts:75-77` |
| Query param parsing | `const parsed = url.parse(req.url \|\| '/', true); parsed.query.folder` | `tasks-handler.ts:79-87` |
| Import helpers from api-handler | `import { sendJSON, sendError, parseBody } from './api-handler';` | `tasks-handler.ts:18` |
| Import Route type | `import type { Route } from './types';` | `tasks-handler.ts:19` |
| Import ProcessStore type | `import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';` | `tasks-handler.ts:15` |
| Route table mutated in-place | `routes.push({ method, pattern, handler })` | `tasks-handler.ts:69` |
| Registration call site | Sequential calls in `index.ts:162-167` | `index.ts:162-167` |
| Import at call site | `import { registerTaskRoutes, registerTaskWriteRoutes } from './tasks-handler';` | `index.ts:19` |

## Files to create

### 1. `packages/coc/src/server/prompt-handler.ts`

#### File header

```typescript
/**
 * Prompt & Skill Discovery REST API Handler
 *
 * HTTP API routes for discovering .prompt.md files and skills
 * available in a workspace. Consumed by the SPA dashboard
 * to populate the "AI Actions" dropdown.
 *
 * No VS Code dependencies — uses only Node.js built-in modules
 * and pipeline-core exports.
 * Cross-platform compatible (Linux/Mac/Windows).
 */
```

#### Imports

```typescript
import * as url from 'url';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { findPromptFiles, findSkills } from '@plusplusoneplusplus/pipeline-core';
import type { PromptFileInfo, SkillInfo } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError } from './api-handler';
import type { Route } from './types';
```

Notes:
- `findPromptFiles` and `findSkills` come from commit 001's discovery module,
  re-exported through the pipeline-core root barrel.
- `url` is used for query parameter parsing (matching `tasks-handler.ts` pattern
  which uses `url.parse(req.url, true)` — NOT `new URL()` constructor).
- No `fs` or `path` import needed — filesystem work is delegated entirely to
  the pipeline-core discovery functions.

#### Workspace resolution helper

Duplicate the inline helper (identical to `tasks-handler.ts:50-53`):

```typescript
async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}
```

#### `registerPromptRoutes(routes, store)`

Exported function — registers both GET endpoints.

##### Endpoint 1: `GET /api/workspaces/:id/prompts`

| Aspect | Detail |
|--------|--------|
| Route regex | `/^\/api\/workspaces\/([^/]+)\/prompts$/` |
| Method | `GET` |
| Query params | `?locations=.github/prompts,custom/prompts` (optional, comma-separated, defaults to `['.github/prompts']`) |
| Workspace resolution | `resolveWorkspace(store, id)` → 404 if not found |
| Discovery call | `findPromptFiles(ws.rootPath, locations)` from pipeline-core |
| Success response | `200 { prompts: PromptFileInfo[] }` |
| Error: workspace not found | `404 { error: "Workspace not found" }` |
| Error: scan failure | `200 { prompts: [], warning: "<message>" }` (graceful degradation) |

Handler implementation:

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/prompts$/,
    handler: async (req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const ws = await resolveWorkspace(store, id);
        if (!ws) {
            return sendError(res, 404, 'Workspace not found');
        }

        // Parse optional ?locations=folder1,folder2
        const parsed = url.parse(req.url || '/', true);
        const locationsParam = typeof parsed.query.locations === 'string'
            ? parsed.query.locations
            : '';
        const locations = locationsParam
            ? locationsParam.split(',').map(s => s.trim()).filter(Boolean)
            : undefined;  // undefined → findPromptFiles uses default ['.github/prompts']

        try {
            const prompts = await findPromptFiles(ws.rootPath, locations);
            sendJSON(res, 200, { prompts });
        } catch (err: any) {
            sendJSON(res, 200, {
                prompts: [],
                warning: 'Failed to scan prompts: ' + (err.message || 'Unknown error'),
            });
        }
    },
});
```

##### Endpoint 2: `GET /api/workspaces/:id/skills`

| Aspect | Detail |
|--------|--------|
| Route regex | `/^\/api\/workspaces\/([^/]+)\/skills$/` |
| Method | `GET` |
| Query params | none |
| Workspace resolution | `resolveWorkspace(store, id)` → 404 if not found |
| Discovery call | `findSkills(ws.rootPath)` from pipeline-core |
| Success response | `200 { skills: SkillInfo[] }` |
| Error: workspace not found | `404 { error: "Workspace not found" }` |
| Error: discovery failure | `200 { skills: [], warning: "<message>" }` (graceful degradation) |

Handler implementation:

```typescript
routes.push({
    method: 'GET',
    pattern: /^\/api\/workspaces\/([^/]+)\/skills$/,
    handler: async (_req, res, match) => {
        const id = decodeURIComponent(match![1]);
        const ws = await resolveWorkspace(store, id);
        if (!ws) {
            return sendError(res, 404, 'Workspace not found');
        }

        try {
            const skills = await findSkills(ws.rootPath);
            sendJSON(res, 200, { skills });
        } catch (err: any) {
            sendJSON(res, 200, {
                skills: [],
                warning: 'Failed to discover skills: ' + (err.message || 'Unknown error'),
            });
        }
    },
});
```

#### Full exported function signature

```typescript
export function registerPromptRoutes(routes: Route[], store: ProcessStore): void {
    // ... both routes.push() calls above
}
```

#### Estimated file size: ~75 lines

## Files to modify

### 2. `packages/coc/src/server/index.ts`

Three surgical changes:

**Change A — Add import** (after `import { registerTaskGenerationRoutes } ...` at line 20):

```typescript
import { registerPromptRoutes } from './prompt-handler';
```

**Change B — Register routes** (after `registerTaskGenerationRoutes(routes, store);` at line 167):

```typescript
registerPromptRoutes(routes, store);
```

**Change C — Optional: Add re-export at bottom** if other handler files are re-exported. Check whether index.ts re-exports other handlers first — if not, skip this.

## Files to create — tests

### 3. `packages/coc/test/server/prompt-handler.test.ts`

Follows `tasks-handler.test.ts` pattern exactly: temp directories, port 0,
`createExecutionServer`, workspace registration via POST.

#### Test helpers (identical to tasks-handler.test.ts)

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}
```

#### Test scaffolding

```typescript
describe('Prompt Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-workspace-'));
    });

    afterEach(async () => {
        if (server) { await server.close(); server = undefined; }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }
```

#### File creation helpers

```typescript
    /** Create prompt files in the workspace. */
    function createPromptFiles(files: Record<string, string>, folder = '.github/prompts'): void {
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(workspaceDir, folder, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    /** Create skill directories in the workspace. */
    function createSkill(name: string, skillMdContent: string): void {
        const skillDir = path.join(workspaceDir, '.github', 'skills', name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');
    }
```

#### Test cases — prompts endpoint

| # | Test name | Setup | Assert |
|---|-----------|-------|--------|
| 1 | `should return 404 for unknown workspace` | no workspace registered | `GET /api/workspaces/nonexistent/prompts` → status 404, `body.error === 'Workspace not found'` |
| 2 | `should return empty prompts when prompts folder does not exist` | register workspace, no files created | status 200, `body.prompts` is `[]`, no `warning` |
| 3 | `should discover .prompt.md files recursively` | create `fix-bug.prompt.md` and `sub/deep.prompt.md` in `.github/prompts` | status 200, `body.prompts.length === 2`, names include `'fix-bug'` and `'deep'` |
| 4 | `should support custom locations query param` | create `custom/prompts/test.prompt.md` | `GET ?locations=custom/prompts` → status 200, `body.prompts.length === 1`, `body.prompts[0].name === 'test'` |
| 5 | `should return sorted results by name` | create `z.prompt.md` and `a.prompt.md` | `body.prompts[0].name === 'a'`, `body.prompts[1].name === 'z'` |
| 6 | `should include relativePath and sourceFolder` | create `sub/my.prompt.md` | `body.prompts[0].relativePath` matches `'sub/my.prompt.md'` (or platform path), `sourceFolder` is set |
| 7 | `should ignore non-.prompt.md files` | create `README.md` and `real.prompt.md` | `body.prompts.length === 1` |

#### Test cases — skills endpoint

| # | Test name | Setup | Assert |
|---|-----------|-------|--------|
| 8 | `should return 404 for unknown workspace` | no workspace registered | `GET /api/workspaces/nonexistent/skills` → status 404 |
| 9 | `should return empty skills when .github/skills does not exist` | register workspace, no dirs | status 200, `body.skills` is `[]` |
| 10 | `should discover skill with description from frontmatter` | `createSkill('go-deep', '---\ndescription: Deep research\n---\n# Go Deep')` | status 200, `body.skills[0].name === 'go-deep'`, `body.skills[0].description === 'Deep research'` |
| 11 | `should return skill without description when no frontmatter` | `createSkill('simple', '# Simple Skill')` | `body.skills[0].name === 'simple'`, `body.skills[0].description` is undefined |
| 12 | `should return multiple skills sorted alphabetically` | create `z-skill` and `a-skill` | `body.skills[0].name === 'a-skill'` |
| 13 | `should only list directories with SKILL.md` | create dir `.github/skills/no-skill/` (empty, no SKILL.md) and `valid/SKILL.md` | only `valid` appears in results |

## Response shapes (TypeScript)

```typescript
// GET /api/workspaces/:id/prompts — success (200)
interface PromptsResponse {
    prompts: Array<{
        absolutePath: string;   // e.g. "/home/user/project/.github/prompts/fix.prompt.md"
        relativePath: string;   // e.g. "fix.prompt.md" (relative to source folder)
        name: string;           // e.g. "fix" (filename without .prompt.md)
        sourceFolder: string;   // e.g. ".github/prompts"
    }>;
    warning?: string;  // only present when scan partially failed
}

// GET /api/workspaces/:id/skills — success (200)
interface SkillsResponse {
    skills: Array<{
        absolutePath: string;   // e.g. "/home/user/project/.github/skills/go-deep"
        relativePath: string;   // e.g. ".github/skills/go-deep"
        name: string;           // e.g. "go-deep" (directory name)
        sourceFolder: string;   // e.g. ".github/skills"
        description?: string;   // from SKILL.md YAML frontmatter
    }>;
    warning?: string;  // only present when discovery partially failed
}

// Error — workspace not found (404)
interface ErrorResponse {
    error: string;  // "Workspace not found"
}
```

Note: Response shapes match `PromptFileInfo` and `SkillInfo` types from
pipeline-core's discovery module (commit 001), serialized directly to JSON.

## Verification

```bash
# Build pipeline-core first (dependency)
cd packages/pipeline-core && npm run build

# Build CoC
cd packages/coc && npm run build

# Run new tests only
cd packages/coc && npx vitest run test/server/prompt-handler.test.ts

# Run all CoC server tests to confirm no regressions
cd packages/coc && npm run test:run
```

## Dependency graph

```
pipeline-core (commit 001)
  ├── findPromptFiles(rootDir, locations?)  → PromptFileInfo[]
  ├── findSkills(rootDir, skillsLocation?)  → SkillInfo[]
  ├── PromptFileInfo type
  └── SkillInfo type
        │
        ▼
packages/coc/src/server/prompt-handler.ts  (NEW, ~75 lines)
  ├── resolveWorkspace()         ← local helper (same as tasks-handler.ts)
  └── registerPromptRoutes()     ← exported, registers 2 GET routes
        │                           delegates to findPromptFiles / findSkills
        ▼
packages/coc/src/server/index.ts  (MODIFIED, 2 lines added)
  └── import + call registerPromptRoutes(routes, store)

packages/coc/test/server/prompt-handler.test.ts  (NEW, ~200 lines)
  └── 13 test cases (7 prompts + 6 skills)
```

## Dependencies

- Depends on: 001 (pipeline-core discovery module provides `findPromptFiles`, `findSkills`, `PromptFileInfo`, `SkillInfo`)
