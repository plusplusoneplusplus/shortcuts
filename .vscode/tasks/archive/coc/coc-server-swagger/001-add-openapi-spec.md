---
status: pending
---

# 001: Add OpenAPI 3.0 spec for all CoC server endpoints

## Summary
Create `packages/coc-server/src/openapi.yaml` containing a complete OpenAPI 3.0.3 specification for all ~55 CoC server REST/SSE endpoints. This is a pure documentation/data commit with zero runtime code changes.

## Motivation
Separating the spec as a pure documentation/data commit makes it independently reviewable for API accuracy without any code risk. Reviewers can verify endpoint coverage and schema correctness without reading routing code. It also establishes a single source of truth for the API contract before wiring it into an express middleware.

## Changes

### Files to Create
- `packages/coc-server/src/openapi.yaml` — Full OpenAPI 3.0.3 spec covering all CoC server endpoints, with reusable schemas in `components/schemas`, standard error envelopes, SSE response types, and logical tag grouping.

### Files to Modify
- `packages/coc-server/package.json` — Add a `postbuild` copy step (e.g. `"postbuild": "node -e \"require('fs').cpSync('src/openapi.yaml','dist/openapi.yaml')\""`) so the YAML file is copied to `dist/` alongside compiled JS. No new npm dependencies required.

### Files to Delete
(none)

## Implementation Notes

### File placement & build pipeline
`tsc` does **not** copy non-`.ts` files. Options considered:
1. **Embed as TS string** (`openapi-spec.ts`) — loses YAML readability and linter compatibility.
2. **Place at package root** — requires awkward `../../` relative paths from `dist/`.
3. **Copy in `postbuild` script (chosen)** — zero new deps, standard Node.js `fs.cpSync`. Add to `package.json`:
   ```json
   "postbuild": "node -e \"require('fs').cpSync('src/openapi.yaml', 'dist/openapi.yaml')\""
   ```
   Commit 2 will then read it as:
   ```ts
   path.join(__dirname, 'openapi.yaml')  // resolves to dist/openapi.yaml at runtime
   ```

### YAML top-level structure

```yaml
openapi: 3.0.3
info:
  title: CoC Server API
  version: "1.0.0"
  description: >
    REST and SSE API for the CoC (Copilot of Copilot) server.
    SSE endpoints return Content-Type: text/event-stream.
servers:
  - url: http://localhost:4000
    description: Default local server
tags:
  - name: workspaces
  - name: git
  - name: processes
  - name: filesystem
  - name: admin
  - name: preferences
  - name: wikis
paths:
  # ... all paths (see below)
components:
  schemas:
    # ... all reusable schemas (see below)
```

---

### Reusable schemas (`components/schemas`)

#### `ErrorResponse`
```yaml
type: object
required: [error]
properties:
  error:
    type: string
```

#### `WorkspaceInfo`
```yaml
type: object
required: [id, name, rootPath]
properties:
  id:        { type: string }
  name:      { type: string }
  rootPath:  { type: string }
  color:     { type: string, nullable: true }
  remoteUrl: { type: string, nullable: true }
```

#### `GitInfo`
```yaml
type: object
properties:
  branch:    { type: string }
  dirty:     { type: boolean }
  ahead:     { type: integer }
  behind:    { type: integer }
  isGitRepo: { type: boolean }
  remoteUrl: { type: string, nullable: true }
```

#### `CommitSummary`
```yaml
type: object
properties:
  hash:    { type: string }
  message: { type: string }
  author:  { type: string }
  date:    { type: string, format: date-time }
```

#### `FileChange`
```yaml
type: object
properties:
  status: { type: string, enum: [added, modified, deleted, renamed, untracked, staged] }
  path:   { type: string }
```

#### `BranchInfo`
```yaml
type: object
properties:
  name:     { type: string }
  current:  { type: boolean }
  upstream: { type: string, nullable: true }
  ahead:    { type: integer }
  behind:   { type: integer }
```

#### `AIProcess`
```yaml
type: object
required: [id, promptPreview, status, startTime]
properties:
  id:               { type: string }
  promptPreview:    { type: string }
  status:           { type: string, enum: [queued, running, completed, failed, cancelled] }
  startTime:        { type: string, format: date-time }
  endTime:          { type: string, format: date-time, nullable: true }
  type:             { type: string, nullable: true }
  fullPrompt:       { type: string, nullable: true }
  error:            { type: string, nullable: true }
  result:           { type: string, nullable: true }
  structuredResult: { type: object, nullable: true, additionalProperties: true }
  metadata:         { type: object, nullable: true, additionalProperties: true }
  sdkSessionId:     { type: string, nullable: true }
  conversationTurns:
    type: array
    nullable: true
    items:
      type: object
      properties:
        role:    { type: string, enum: [user, assistant] }
        content: { type: string }
  workspaceId:      { type: string, nullable: true }
```

#### `StatsResponse`
```yaml
type: object
properties:
  totalProcesses: { type: integer }
  byStatus:
    type: object
    properties:
      queued:    { type: integer }
      running:   { type: integer }
      completed: { type: integer }
      failed:    { type: integer }
      cancelled: { type: integer }
  byWorkspace:
    type: array
    items:
      type: object
      properties:
        workspaceId: { type: string }
        name:        { type: string }
        count:       { type: integer }
```

#### `CLIConfig`
```yaml
type: object
properties:
  model:    { type: string }
  parallel: { type: integer }
  timeout:  { type: integer }
  output:   { type: string, enum: [table, json, csv, markdown] }
```

#### `UserPreferences`
```yaml
type: object
additionalProperties: true
description: Arbitrary user preference key-value pairs.
```

#### `WikiInfo`
```yaml
type: object
required: [id]
properties:
  id:              { type: string }
  wikiDir:         { type: string, nullable: true }
  repoPath:        { type: string, nullable: true }
  name:            { type: string, nullable: true }
  color:           { type: string, nullable: true }
  title:           { type: string, nullable: true }
  generateWithAI:  { type: boolean, nullable: true }
  aiEnabled:       { type: boolean, nullable: true }
```

#### `ThemeMeta`
```yaml
type: object
properties:
  id:          { type: string }
  title:       { type: string }
  description: { type: string, nullable: true }
```

#### `FsEntry`
```yaml
type: object
properties:
  name:      { type: string }
  type:      { type: string, enum: [file, directory] }
  isGitRepo: { type: boolean, nullable: true }
```

#### `CoCExportPayload`
```yaml
type: object
description: Opaque export blob produced by GET /api/admin/export
additionalProperties: true
```

#### `SSEResponse` (used as response schema for all SSE endpoints)
```yaml
type: string
description: >
  Server-sent event stream. Each event is a line prefixed with "data: ".
  The stream ends with a terminal event (e.g., data: [DONE] or data: {"done":true}).
```

---

### Path definitions

All `4xx`/`5xx` responses use `$ref: '#/components/schemas/ErrorResponse'`.

#### WORKSPACES

```
POST /api/workspaces
  tags: [workspaces]
  requestBody: required
    application/json:
      schema:
        type: object
        required: [id, name, rootPath]
        properties:
          id:        string
          name:      string
          rootPath:  string
          color:     string (nullable)
          remoteUrl: string (nullable)
  responses:
    201: { workspace: $ref WorkspaceInfo }
    400: ErrorResponse
    409: ErrorResponse  # duplicate id

GET /api/workspaces
  tags: [workspaces]
  responses:
    200: { workspaces: array of WorkspaceInfo }

DELETE /api/workspaces/{workspaceId}
  tags: [workspaces]
  parameters: workspaceId (path, required, string)
  responses:
    204: no content
    404: ErrorResponse

PATCH /api/workspaces/{workspaceId}
  tags: [workspaces]
  parameters: workspaceId (path, required, string)
  requestBody:
    application/json:
      schema:
        type: object
        properties:
          name:      string
          color:     string (nullable)
          rootPath:  string
          remoteUrl: string (nullable)
  responses:
    200: { workspace: $ref WorkspaceInfo }
    404: ErrorResponse

GET /api/workspaces/{workspaceId}/git-info
  tags: [workspaces, git]
  parameters: workspaceId (path, required, string)
  responses:
    200: $ref GitInfo
    404: ErrorResponse
```

#### GIT — Commits

```
GET /api/workspaces/{workspaceId}/git/commits
  tags: [git]
  parameters:
    - workspaceId (path, required, string)
    - limit  (query, integer, default 50)
    - skip   (query, integer, default 0)
    - refresh (query, boolean)
  responses:
    200:
      type: object
      properties:
        commits: array of CommitSummary
        unpushedCount: integer
    404: ErrorResponse

GET /api/workspaces/{workspaceId}/git/commits/{hash}/files
  tags: [git]
  parameters: workspaceId (path), hash (path)
  responses:
    200: { files: array of FileChange }

GET /api/workspaces/{workspaceId}/git/commits/{hash}/diff
  tags: [git]
  parameters: workspaceId (path), hash (path)
  responses:
    200: { diff: string }

GET /api/workspaces/{workspaceId}/git/commits/{hash}/files/{filePath}/diff
  tags: [git]
  parameters: workspaceId (path), hash (path), filePath (path, string, url-encoded)
  responses:
    200: { diff: string }
```

#### GIT — Branch Range

```
GET /api/workspaces/{workspaceId}/git/branch-range
  tags: [git]
  parameters:
    - workspaceId (path)
    - refresh (query, boolean)
  responses:
    200:
      oneOf:
        - type: object
          description: Range info
          properties:
            base:   { type: string }
            head:   { type: string }
            ahead:  { type: integer }
            behind: { type: integer }
        - type: object
          description: On default branch
          properties:
            onDefaultBranch: { type: boolean, enum: [true] }

GET /api/workspaces/{workspaceId}/git/branch-range/files
  tags: [git]
  responses:
    200: { files: array of string }

GET /api/workspaces/{workspaceId}/git/branch-range/diff
  tags: [git]
  responses:
    200: { diff: string }

GET /api/workspaces/{workspaceId}/git/branch-range/files/{filePath}/diff
  tags: [git]
  parameters: workspaceId (path), filePath (path, url-encoded)
  responses:
    200: { diff: string, path: string }
```

#### GIT — Branches

```
GET /api/workspaces/{workspaceId}/git/branches
  tags: [git]
  parameters:
    - workspaceId (path)
    - type   (query, string, enum: [local, remote, all])
    - limit  (query, integer)
    - offset (query, integer)
    - search (query, string)
  responses:
    200:
      type: object
      properties:
        local:  { type: array, items: $ref BranchInfo, nullable: true }
        remote: { type: array, items: $ref BranchInfo, nullable: true }

GET /api/workspaces/{workspaceId}/git/branch-status
  tags: [git]
  responses:
    200:
      type: object
      properties:
        current:     { type: string }
        tracking:    { type: string, nullable: true }
        ahead:       { type: integer }
        behind:      { type: integer }
        dirty:       { type: boolean }

POST /api/workspaces/{workspaceId}/git/branches
  tags: [git]
  requestBody:
    required: [name]
    properties:
      name:     string
      checkout: boolean (default false)
  responses:
    200: branch result object { name: string, created: boolean, checkedOut: boolean }
    409: ErrorResponse

POST /api/workspaces/{workspaceId}/git/branches/switch
  tags: [git]
  requestBody:
    required: [name]
    properties:
      name:  string
      force: boolean
  responses:
    200: { name: string }
    404: ErrorResponse

POST /api/workspaces/{workspaceId}/git/branches/rename
  tags: [git]
  requestBody:
    required: [oldName, newName]
    properties:
      oldName: string
      newName: string
  responses:
    200: { oldName: string, newName: string }

DELETE /api/workspaces/{workspaceId}/git/branches/{branchName}
  tags: [git]
  parameters:
    - branchName (path)
    - force (query, boolean)
  responses:
    200: { deleted: string }
    409: ErrorResponse

POST /api/workspaces/{workspaceId}/git/push
  tags: [git]
  requestBody:
    properties:
      setUpstream: boolean
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/pull
  tags: [git]
  requestBody:
    properties:
      rebase: boolean
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/fetch
  tags: [git]
  requestBody:
    properties:
      remote: string
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/merge
  tags: [git]
  requestBody:
    required: [branch]
    properties:
      branch: string
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/stash
  tags: [git]
  requestBody:
    properties:
      message: string
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/stash/pop
  tags: [git]
  responses:
    200: { success: boolean }
```

#### GIT — Working Tree

```
GET /api/workspaces/{workspaceId}/git/changes
  tags: [git]
  responses:
    200: { changes: array of FileChange }

POST /api/workspaces/{workspaceId}/git/changes/stage
  tags: [git]
  requestBody:
    required: [filePath]
    properties:
      filePath: string
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/changes/unstage
  tags: [git]
  requestBody:
    required: [filePath]
    properties:
      filePath: string
  responses:
    200: { success: boolean }

POST /api/workspaces/{workspaceId}/git/changes/discard
  tags: [git]
  requestBody:
    required: [filePath]
    properties:
      filePath: string
  responses:
    200: { success: boolean }

DELETE /api/workspaces/{workspaceId}/git/changes/untracked
  tags: [git]
  requestBody:
    required: [filePath]
    properties:
      filePath: string
  responses:
    200: { success: boolean }
```

#### FILESYSTEM

```
GET /api/fs/browse
  tags: [filesystem]
  parameters:
    - path (query, string) — directory to list; omit for roots
    - showHidden (query, boolean)
  responses:
    200:
      type: object
      properties:
        path:    { type: string }
        parent:  { type: string, nullable: true }
        entries: { type: array, items: $ref FsEntry }
        drives:  { type: array, items: string, nullable: true }  # Windows only
    400: ErrorResponse
```

#### PROCESSES

```
GET /api/processes
  tags: [processes]
  parameters:
    - workspace    (query, string)
    - status       (query, string, comma-separated enum values)
    - type         (query, string)
    - since        (query, string, ISO date-time)
    - limit        (query, integer, default 50)
    - offset       (query, integer, default 0)
    - exclude      (query, string, comma-separated fields to exclude from payload)
    - sdkSessionId (query, string)
  responses:
    200:
      type: object
      properties:
        processes: { type: array, items: $ref AIProcess }
        total:     { type: integer }
        limit:     { type: integer }
        offset:    { type: integer }

POST /api/processes
  tags: [processes]
  requestBody:
    required: true
    schema:
      type: object
      required: [id, promptPreview, status, startTime]
      allOf:
        - $ref: AIProcess
  responses:
    201: $ref AIProcess
    400: ErrorResponse

DELETE /api/processes
  tags: [processes]
  parameters:
    - status (query, string, REQUIRED, comma-separated: queued,running,completed,failed,cancelled)
  responses:
    200: { removed: integer }
    400: ErrorResponse  # missing status

GET /api/processes/{processId}
  tags: [processes]
  parameters:
    - processId (path, required)
    - exclude (query, string, comma-separated fields)
  responses:
    200: { process: $ref AIProcess }
    404: ErrorResponse

PATCH /api/processes/{processId}
  tags: [processes]
  parameters:
    - processId (path, required)
  requestBody:
    schema:
      type: object
      properties:
        status:           { type: string }
        result:           { type: string, nullable: true }
        error:            { type: string, nullable: true }
        endTime:          { type: string, format: date-time, nullable: true }
        structuredResult: { type: object, nullable: true }
        metadata:         { type: object, nullable: true }
        sdkSessionId:     { type: string, nullable: true }
        conversationTurns:
          type: array
          nullable: true
          items: { type: object }
  responses:
    200: { process: $ref AIProcess }
    404: ErrorResponse

DELETE /api/processes/{processId}
  tags: [processes]
  parameters:
    - processId (path, required)
  responses:
    204: no content
    404: ErrorResponse

GET /api/processes/{processId}/stream
  tags: [processes]
  parameters:
    - processId (path, required)
  responses:
    200:
      content:
        text/event-stream:
          schema: $ref SSEResponse
    404: ErrorResponse

GET /api/processes/{processId}/output
  tags: [processes]
  parameters:
    - processId (path, required)
  responses:
    200: { content: string, format: "markdown" }
    404: ErrorResponse

POST /api/processes/{processId}/cancel
  tags: [processes]
  parameters:
    - processId (path, required)
  responses:
    200: { process: $ref AIProcess }
    404: ErrorResponse

POST /api/processes/{processId}/message
  tags: [processes]
  parameters:
    - processId (path, required)
  requestBody:
    required: true
    schema:
      type: object
      required: [content]
      properties:
        content:    { type: string }
        images:     { type: array, items: string, nullable: true }
        skillNames: { type: array, items: string, nullable: true }
  responses:
    202: { processId: string, turnIndex: integer }
    404: ErrorResponse
```

#### STATS

```
GET /api/stats
  tags: [processes]
  responses:
    200: $ref StatsResponse
```

#### ADMIN

```
GET /api/admin/data/wipe-token
  tags: [admin]
  responses:
    200: { token: string, expiresIn: integer (300) }

GET /api/admin/data/stats
  tags: [admin]
  parameters:
    - includeWikis (query, boolean)
  responses:
    200:
      type: object
      description: Dry-run summary of data that would be wiped
      additionalProperties: true

DELETE /api/admin/data
  tags: [admin]
  parameters:
    - confirm     (query, string, REQUIRED — wipe token)
    - includeWikis (query, boolean)
  responses:
    200:
      type: object
      description: Wipe result summary
      additionalProperties: true
    400: ErrorResponse  # missing or invalid token

GET /api/admin/config
  tags: [admin]
  responses:
    200:
      type: object
      properties:
        config:  { $ref: CLIConfig }
        sources: { type: object, additionalProperties: true }

PUT /api/admin/config
  tags: [admin]
  requestBody:
    schema:
      type: object
      properties:
        model:    { type: string }
        parallel: { type: integer }
        timeout:  { type: integer }
        output:   { type: string, enum: [table, json, csv, markdown] }
  responses:
    200: { config: $ref CLIConfig }

GET /api/admin/export
  tags: [admin]
  responses:
    200:
      content:
        application/json:
          schema: $ref CoCExportPayload
      headers:
        Content-Disposition:
          schema: { type: string }
          description: attachment; filename="coc-export-<timestamp>.json"

GET /api/admin/import-token
  tags: [admin]
  responses:
    200: { token: string, expiresIn: integer (300) }

POST /api/admin/import/preview
  tags: [admin]
  requestBody:
    required: true
    content:
      application/json:
        schema: $ref CoCExportPayload
  responses:
    200:
      type: object
      properties:
        valid:   { type: boolean }
        preview: { type: object, nullable: true, additionalProperties: true }
    400: ErrorResponse

POST /api/admin/import
  tags: [admin]
  parameters:
    - confirm (query, string, REQUIRED — import token)
    - mode    (query, string, REQUIRED, enum: [replace, merge])
  requestBody:
    required: true
    content:
      application/json:
        schema: $ref CoCExportPayload
  responses:
    200:
      type: object
      description: Import result
      additionalProperties: true
    400: ErrorResponse
```

#### PREFERENCES

```
GET /api/preferences
  tags: [preferences]
  responses:
    200: $ref UserPreferences

PUT /api/preferences
  tags: [preferences]
  requestBody:
    required: true
    content:
      application/json:
        schema: $ref UserPreferences
  responses:
    200: $ref UserPreferences

PATCH /api/preferences
  tags: [preferences]
  requestBody:
    required: true
    content:
      application/json:
        schema: $ref UserPreferences
  responses:
    200: $ref UserPreferences
```

#### WIKIS — Registry CRUD

```
GET /api/wikis
  tags: [wikis]
  responses:
    200: { type: array, items: $ref WikiInfo }

POST /api/wikis
  tags: [wikis]
  requestBody:
    required: true
    schema:
      type: object
      required: [id]
      properties:
        id:             { type: string }
        wikiDir:        { type: string }
        repoPath:       { type: string }
        name:           { type: string }
        color:          { type: string }
        generateWithAI: { type: boolean }
        aiEnabled:      { type: boolean }
        title:          { type: string }
  responses:
    201: $ref WikiInfo
    400: ErrorResponse
    409: ErrorResponse  # duplicate id

GET /api/wikis/{wikiId}
  tags: [wikis]
  parameters: wikiId (path, required)
  responses:
    200: $ref WikiInfo
    404: ErrorResponse

DELETE /api/wikis/{wikiId}
  tags: [wikis]
  parameters: wikiId (path, required)
  responses:
    200: { success: boolean, id: string }
    404: ErrorResponse

PATCH /api/wikis/{wikiId}
  tags: [wikis]
  parameters: wikiId (path, required)
  requestBody:
    schema:
      type: object
      properties:
        title:     { type: string }
        name:      { type: string }
        color:     { type: string }
        aiEnabled: { type: boolean }
  responses:
    200: $ref WikiInfo
    404: ErrorResponse
```

#### WIKIS — Data

```
GET /api/wikis/{wikiId}/graph
  tags: [wikis]
  parameters: wikiId (path, required)
  responses:
    200:
      type: object
      description: Module/component graph JSON (structure depends on wiki generator output)
      additionalProperties: true
    404: ErrorResponse

GET /api/wikis/{wikiId}/themes
  tags: [wikis]
  parameters: wikiId (path, required)
  responses:
    200: { type: array, items: $ref ThemeMeta }
    404: ErrorResponse

GET /api/wikis/{wikiId}/themes/{themeId}
  tags: [wikis]
  parameters: wikiId (path), themeId (path)
  responses:
    200:
      type: object
      properties:
        meta:     $ref ThemeMeta
        articles:
          type: array
          items:
            type: object
            properties:
              slug:    { type: string }
              title:   { type: string }
              content: { type: string }
    404: ErrorResponse

GET /api/wikis/{wikiId}/themes/{themeId}/{slug}
  tags: [wikis]
  parameters: wikiId (path), themeId (path), slug (path)
  responses:
    200:
      type: object
      properties:
        themeId: { type: string }
        slug:    { type: string }
        content: { type: string }
        meta:    $ref ThemeMeta
    404: ErrorResponse

GET /api/wikis/{wikiId}/components
  tags: [wikis]
  parameters: wikiId (path, required)
  responses:
    200:
      type: object
      description: Components map (id → ComponentInfo)
      additionalProperties: true
    404: ErrorResponse

GET /api/wikis/{wikiId}/components/{componentId}
  tags: [wikis]
  parameters: wikiId (path), componentId (path)
  responses:
    200:
      type: object
      description: Single component detail
      additionalProperties: true
    404: ErrorResponse

GET /api/wikis/{wikiId}/pages/{key}
  tags: [wikis]
  parameters: wikiId (path), key (path, url-encoded page key)
  responses:
    200:
      type: object
      properties:
        key:     { type: string }
        content: { type: string }
    404: ErrorResponse
```

#### WIKIS — AI (SSE)

```
POST /api/wikis/{wikiId}/ask
  tags: [wikis]
  parameters: wikiId (path, required)
  requestBody:
    required: true
    schema:
      type: object
      required: [question]
      properties:
        question:            { type: string }
        sessionId:           { type: string, nullable: true }
        conversationHistory:
          type: array
          nullable: true
          items:
            type: object
            properties:
              role:    { type: string, enum: [user, assistant] }
              content: { type: string }
  responses:
    200:
      content:
        text/event-stream:
          schema: $ref SSEResponse
    404: ErrorResponse

DELETE /api/wikis/{wikiId}/ask/session/{sessionId}
  tags: [wikis]
  parameters: wikiId (path), sessionId (path)
  responses:
    200: { destroyed: boolean, sessionId: string }
    404: ErrorResponse

POST /api/wikis/{wikiId}/explore/{componentId}
  tags: [wikis]
  parameters: wikiId (path), componentId (path)
  requestBody:
    schema:
      type: object
      properties:
        question: { type: string, nullable: true }
        depth:    { type: string, enum: [shallow, normal, deep], nullable: true }
  responses:
    200:
      content:
        text/event-stream:
          schema: $ref SSEResponse
    404: ErrorResponse
```

#### WIKIS — Admin

```
GET /api/wikis/{wikiId}/admin/seeds
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  responses:
    200: { content: string }
    404: ErrorResponse

PUT /api/wikis/{wikiId}/admin/seeds
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  requestBody:
    required: true
    schema:
      type: object
      required: [content]
      properties:
        content: { type: string }
  responses:
    200: { success: boolean }
    404: ErrorResponse

GET /api/wikis/{wikiId}/admin/config
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  responses:
    200: { content: string, description: YAML config string }
    404: ErrorResponse

PUT /api/wikis/{wikiId}/admin/config
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  requestBody:
    required: true
    schema:
      type: object
      required: [content]
      properties:
        content: { type: string, description: YAML config string }
  responses:
    200: { success: boolean }
    400: ErrorResponse

POST /api/wikis/{wikiId}/admin/generate
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  requestBody:
    schema:
      type: object
      properties:
        startPhase: { type: integer }
        endPhase:   { type: integer }
        force:      { type: boolean }
  responses:
    200:
      content:
        text/event-stream:
          schema: $ref SSEResponse
    404: ErrorResponse

POST /api/wikis/{wikiId}/admin/generate/cancel
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  responses:
    200: { success: boolean }
    404: ErrorResponse

GET /api/wikis/{wikiId}/admin/generate/status
  tags: [wikis, admin]
  parameters: wikiId (path, required)
  responses:
    200:
      type: object
      description: Generation status object
      properties:
        running:      { type: boolean }
        phase:        { type: integer, nullable: true }
        progress:     { type: number, nullable: true }
        error:        { type: string, nullable: true }
      additionalProperties: true
    404: ErrorResponse

POST /api/wikis/{wikiId}/admin/generate/component/{componentId}
  tags: [wikis, admin]
  parameters: wikiId (path), componentId (path)
  requestBody:
    schema:
      type: object
      properties:
        force: { type: boolean }
  responses:
    200:
      content:
        text/event-stream:
          schema: $ref SSEResponse
    404: ErrorResponse
```

### Error conventions
- All error responses: `Content-Type: application/json`, body `{ "error": "<message>" }`
- `400` — bad request / missing required fields
- `404` — resource not found
- `409` — conflict (duplicate id)
- `500` — unexpected server error

### SSE conventions
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- Each event: `data: <json-or-string>\n\n`
- Terminal events: `data: [DONE]\n\n` or `data: {"done":true,...}\n\n`

## Tests
- Run `npx swagger-parser validate packages/coc-server/src/openapi.yaml` to check the spec validates against OpenAPI 3.0 rules.
- Confirm all ~55 endpoints are present by counting `operationId` entries or path+method combinations.
- Spot-check: verify `POST /api/processes/{processId}/message` has `required: [content]` in its request body schema.
- Spot-check: verify all SSE endpoints declare `text/event-stream` content type.
- Spot-check: verify `DELETE /api/processes` has `status` as a **required** query parameter.
- Spot-check: verify `DELETE /api/admin/data` has `confirm` as a **required** query parameter.

## Acceptance Criteria
- [ ] `packages/coc-server/src/openapi.yaml` exists and is valid OpenAPI 3.0.3
- [ ] All ~55 endpoints (GET/POST/PUT/PATCH/DELETE) are documented
- [ ] Every endpoint has at least one success response schema and an error response reference
- [ ] All request body schemas mark required fields with `required: [...]`
- [ ] SSE endpoints declare `content: text/event-stream` in their 200 response
- [ ] `components/schemas` defines all 14 reusable schemas listed above
- [ ] Tags cover: `workspaces`, `git`, `processes`, `filesystem`, `admin`, `preferences`, `wikis`
- [ ] `packages/coc-server/package.json` has a `postbuild` script that copies `src/openapi.yaml` → `dist/openapi.yaml`
- [ ] `npx swagger-parser validate packages/coc-server/src/openapi.yaml` exits 0

## Dependencies
- Depends on: None

## Assumed Prior State
None — this is the first commit in the coc-server-swagger feature series. The `packages/coc-server/` package already exists with its own `package.json`, `tsconfig.json`, and `src/` directory.
