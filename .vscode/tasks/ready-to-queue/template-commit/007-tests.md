---
status: pending
commit: "007"
title: "tests: add template test coverage"
depends_on: ["001", "002", "003", "004", "005", "006"]
files:
  - packages/pipeline-core/test/templates/prompt-builder.test.ts
  - packages/pipeline-core/test/templates/result-parser.test.ts
  - packages/pipeline-core/test/templates/replicate-service.test.ts
  - packages/coc/test/server/templates-handler.test.ts
  - packages/coc/test/server/replicate-apply-handler.test.ts
  - packages/coc/test/server/template-watcher.test.ts
---

# 007 — tests: add template test coverage

Comprehensive Vitest tests for every layer of the Template feature: prompt building, result parsing, replicate service, CRUD handler, apply handler, and file watcher.

## Assumed Prior State

All template source files from commits 001–006 exist:

| Commit | Module | Key Exports |
|--------|--------|-------------|
| 001 | `pipeline-core/src/templates/` | `buildReplicatePrompt`, `parseReplicateResponse`, `ReplicateService`, types |
| 002 | `pipeline-core/src/index.ts` | Barrel re-exports for templates |
| 003 | `coc/src/server/templates-handler.ts` | `registerTemplateRoutes`, `registerTemplateWriteRoutes` |
| 003 | `coc/src/server/replicate-apply-handler.ts` | `registerReplicateApplyRoutes` |
| 004 | `coc/src/server/template-watcher.ts` | `TemplateWatcher` |
| 005 | `coc/src/server/index.ts` | Wiring |
| 006 | `coc/src/spa/` | Dashboard components |

---

## Files to Create

### 1. `packages/pipeline-core/test/templates/prompt-builder.test.ts`

Tests the `buildReplicatePrompt` function that turns a commit + instruction into an AI prompt string.

**Imports:**

```typescript
import { describe, it, expect } from 'vitest';
import { buildReplicatePrompt } from '../../src/templates/prompt-builder';
```

**Test Cases:**

```
describe('buildReplicatePrompt')

  describe('basic prompt construction')
    it('includes the commit hash in the prompt')
      - Input: commitHash 'abc123', instruction 'Add logging', diff 'diff --git ...', files ['src/a.ts']
      - Assert: result contains 'abc123'

    it('includes the instruction text')
      - Input: instruction 'Add error handling to all functions'
      - Assert: result contains 'Add error handling to all functions'

    it('includes the diff content')
      - Input: diff with recognizable content like '+console.log("hello")'
      - Assert: result contains the diff content verbatim

    it('includes the file list')
      - Input: files ['src/a.ts', 'src/b.ts', 'lib/c.ts']
      - Assert: result contains each file path

  describe('prompt sections')
    it('contains the Template Commit section header')
      - Assert: result includes 'Template Commit' (or equivalent section marker)

    it('contains the Your Task section')
      - Assert: result includes a task/instruction section

    it('contains the Instructions section')
      - Assert: result includes instruction guidance for the AI

    it('contains the Output Format section')
      - Assert: result includes output format specification

    it('includes === FILE === output format markers in instructions')
      - Assert: result contains '=== FILE ===' (the delimiter the AI must use)
      - Assert: result contains '=== END FILE ===' (the closing delimiter)

  describe('optional fields')
    it('includes hints when provided')
      - Input: hints 'Focus on error paths'
      - Assert: result contains the hint text

    it('produces a valid prompt when description is empty')
      - Input: description '' or undefined
      - Assert: result is a non-empty string, does not contain 'undefined'

    it('produces a valid prompt when hints is undefined')
      - Input: no hints field
      - Assert: result is a non-empty string, no placeholder text for hints

  describe('large diff handling')
    it('handles a large diff without truncation up to reasonable size')
      - Input: diff of 50,000 characters
      - Assert: result contains the diff (or a defined truncation marker if truncation is implemented)

    it('includes all files even with a large diff')
      - Input: 20 files, large diff
      - Assert: every file path appears in the prompt
```

**Pattern notes:**
- Pure function, no mocks needed.
- Each test constructs minimal input and asserts on string content.
- Use `expect(result).toContain(...)` for content checks.

---

### 2. `packages/pipeline-core/test/templates/result-parser.test.ts`

Tests the `parseReplicateResponse` function that extracts `FileChange[]` from AI output.

**Imports:**

```typescript
import { describe, it, expect } from 'vitest';
import { parseReplicateResponse } from '../../src/templates/result-parser';
import { FileChange } from '../../src/templates/types';
```

**Test Cases:**

```
describe('parseReplicateResponse')

  describe('single file parsing')
    it('parses a single new file')
      - Input:
        === FILE ===
        path: src/hello.ts
        action: new
        ---
        console.log("hello");
        === END FILE ===
      - Assert: returns FileChange[] with length 1
      - Assert: [0].path === 'src/hello.ts'
      - Assert: [0].action === 'new'
      - Assert: [0].content contains 'console.log("hello")'

    it('parses a single modified file')
      - Input: action: modified, with content
      - Assert: [0].action === 'modified'
      - Assert: [0].content is present

    it('parses a single deleted file')
      - Input: action: deleted, no content body (or empty)
      - Assert: [0].action === 'deleted'
      - Assert: [0].content is undefined or empty

  describe('multiple files')
    it('parses multiple files of different actions')
      - Input: 3 file blocks — new, modified, deleted
      - Assert: returns FileChange[] with length 3
      - Assert: each entry has correct path, action, and content

    it('preserves file order from AI output')
      - Input: files a.ts, b.ts, c.ts in that order
      - Assert: result[0].path ends with 'a.ts', result[1] with 'b.ts', result[2] with 'c.ts'

  describe('malformed output')
    it('handles missing END FILE marker gracefully')
      - Input:
        === FILE ===
        path: src/broken.ts
        action: new
        ---
        some content without closing marker
      - Assert: returns partial result or throws a descriptive error
      - Assert: does not crash

    it('returns empty array for empty output')
      - Input: ''
      - Assert: returns []

    it('returns empty array for output with no file blocks')
      - Input: 'Here is my analysis of the code...'
      - Assert: returns []

  describe('extra text handling')
    it('ignores preamble text before the first file block')
      - Input: 'Sure, here are the changes:\n\n=== FILE ===\npath: src/a.ts\n...'
      - Assert: still parses the file block correctly

    it('ignores trailing text after the last END FILE marker')
      - Input: '...=== END FILE ===\n\nLet me know if you need anything else!'
      - Assert: does not create extra file entries

    it('ignores text between file blocks')
      - Input: two file blocks with explanatory text between them
      - Assert: returns exactly 2 FileChange entries

  describe('summary extraction')
    it('extracts summary when present in output')
      - Input: AI output with a summary section (before or after file blocks)
      - Assert: result or returned object includes the summary text

    it('returns undefined/empty summary when none present')
      - Input: only file blocks, no summary text
      - Assert: summary is undefined or empty string

  describe('FileChange structure validation')
    it('each FileChange has required path and action fields')
      - Input: valid multi-file output
      - Assert: every entry has non-empty 'path' (string) and valid 'action'

    it('content is a string for new and modified files')
      - Input: new file with content
      - Assert: typeof content === 'string' and content.length > 0

    it('path does not have leading slash')
      - Input: path: /src/a.ts (with leading slash in AI output)
      - Assert: result path is normalized (no leading slash), or matches input exactly
```

**Pattern notes:**
- Pure function, no mocks needed.
- Use template literals for multi-line AI output fixtures.
- Define reusable fixtures at the top of the describe block if needed.

---

### 3. `packages/pipeline-core/test/templates/replicate-service.test.ts`

Integration test for `ReplicateService` with mocked dependencies.

**Imports:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplicateService } from '../../src/templates/replicate-service';
```

**Mock Setup:**

```typescript
// Mock AI invoker — simple async function returning structured file output
function createMockAIInvoker(response: string) {
    return vi.fn().mockResolvedValue({ content: response });
}

// Mock git log data — provide commit info without needing a real repo
function createMockGitLogService() {
    return {
        getCommitDiff: vi.fn().mockResolvedValue({
            hash: 'abc123',
            message: 'feat: add feature',
            diff: 'diff --git a/src/a.ts ...',
            files: ['src/a.ts'],
        }),
    };
}
```

**Test Cases:**

```
describe('ReplicateService')

  let service: ReplicateService;
  let mockAIInvoker: ReturnType<typeof createMockAIInvoker>;
  let mockGitLog: ReturnType<typeof createMockGitLogService>;

  beforeEach(() => {
    mockAIInvoker = createMockAIInvoker(defaultAIResponse);
    mockGitLog = createMockGitLogService();
    service = new ReplicateService({ aiInvoker: mockAIInvoker, gitLogService: mockGitLog });
  });

  describe('successful replication flow')
    it('fetches commit diff via git log service')
      - Call: service.replicate({ commitHash: 'abc123', instruction: 'Add tests' })
      - Assert: mockGitLog.getCommitDiff called with 'abc123'

    it('builds prompt and sends to AI invoker')
      - Assert: mockAIInvoker called once
      - Assert: first argument contains 'abc123' and 'Add tests'

    it('parses AI response into FileChange array')
      - Mock AI returns valid file block output
      - Assert: result.files is an array with expected entries
      - Assert: result.files[0].path and .action are correct

    it('returns a complete ReplicateResult')
      - Assert: result has 'files' (FileChange[]), 'summary' (string|undefined)
      - Assert: result.files.length > 0

  describe('options forwarding')
    it('passes hints to the prompt builder')
      - Call with hints: 'Focus on error handling'
      - Assert: AI invoker receives a prompt containing the hints text

    it('passes model option to AI invoker if supported')
      - Call with model: 'gpt-4'
      - Assert: mockAIInvoker called with options including model (if the API supports it)

  describe('onProgress callback')
    it('invokes onProgress with status updates')
      - Provide onProgress: vi.fn()
      - Assert: onProgress called at least once
      - Assert: onProgress called with a string or progress object

    it('reports fetching-diff phase')
      - Assert: one onProgress call contains 'diff' or 'fetching' (phase indicator)

    it('reports ai-processing phase')
      - Assert: one onProgress call indicates AI call in progress

  describe('error handling')
    it('throws descriptive error for invalid commit hash')
      - Mock getCommitDiff to reject with 'not found'
      - Assert: service.replicate rejects with error mentioning commit hash

    it('throws descriptive error when AI invoker fails')
      - Mock AI invoker to reject with 'API error'
      - Assert: service.replicate rejects with error about AI failure

    it('returns empty files array when AI returns no file blocks')
      - Mock AI returns 'I could not generate any changes'
      - Assert: result.files is [] (empty array)

    it('handles empty diff gracefully')
      - Mock getCommitDiff returns diff: ''
      - Assert: either throws a clear error or proceeds with empty-diff prompt
```

**Pattern notes:**
- Follow `pipeline-core` pattern: factory functions for mocks, `vi.fn()` for spying.
- `beforeEach` resets mocks and creates fresh service instance.
- No temp directories needed — everything is in-memory via mocks.

---

### 4. `packages/coc/test/server/templates-handler.test.ts`

Tests the CRUD routes registered by `registerTemplateRoutes` and `registerTemplateWriteRoutes`.

**Imports:**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createExecutionServer } from '../../src/server/index';
// Or, if testing handlers in isolation:
import { registerTemplateRoutes, registerTemplateWriteRoutes } from '../../src/server/templates-handler';
```

**Setup:**

```typescript
let tempDir: string;
let templatesDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-test-'));
    templatesDir = path.join(tempDir, '.vscode', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// HTTP request helper (reuse coc test pattern)
function request(url: string, options?: RequestInit): Promise<{ status: number; body: any }> { ... }
function postJSON(url: string, body: object): Promise<{ status: number; body: any }> { ... }
function patchJSON(url: string, body: object): Promise<{ status: number; body: any }> { ... }
function deleteReq(url: string): Promise<{ status: number; body: any }> { ... }
```

**Test Cases:**

```
describe('templates-handler')

  describe('GET /api/workspaces/:id/templates')
    it('returns empty array when no templates exist')
      - Assert: status 200, body is []

    it('returns all templates when directory has YAML files')
      - Setup: write 2 YAML template files to templatesDir
      - Assert: status 200, body.length === 2
      - Assert: each entry has 'name', 'commitHash', 'instruction'

    it('ignores non-YAML files in the templates directory')
      - Setup: write a .txt file alongside a .yaml file
      - Assert: body.length === 1

  describe('GET /api/workspaces/:id/templates/:name')
    it('returns a single template by name')
      - Setup: write 'add-logging.yaml' template
      - Call: GET /api/workspaces/:id/templates/add-logging
      - Assert: status 200, body.name === 'add-logging'
      - Assert: body.commitHash and body.instruction are present

    it('returns 404 for non-existent template')
      - Call: GET /api/workspaces/:id/templates/nonexistent
      - Assert: status 404

  describe('POST /api/workspaces/:id/templates')
    it('creates a new template and writes YAML file')
      - Body: { name: 'add-tests', commitHash: 'abc123', instruction: 'Add unit tests' }
      - Assert: status 201
      - Assert: file exists at templatesDir/add-tests.yaml
      - Assert: YAML content contains commitHash and instruction

    it('rejects creation with missing name')
      - Body: { commitHash: 'abc123', instruction: 'x' } (no name)
      - Assert: status 400

    it('rejects creation with missing commitHash')
      - Body: { name: 'foo', instruction: 'x' } (no commitHash)
      - Assert: status 400

    it('rejects creation with empty name')
      - Body: { name: '', commitHash: 'abc', instruction: 'x' }
      - Assert: status 400

    it('rejects duplicate template name')
      - Setup: create 'my-tpl' template first
      - Body: { name: 'my-tpl', commitHash: 'def456', instruction: 'y' }
      - Assert: status 409 (conflict) or 400

    it('calls onTemplatesChanged callback after creation')
      - Provide onTemplatesChanged: vi.fn()
      - Assert: callback called once with workspaceId

  describe('PATCH /api/workspaces/:id/templates/:name')
    it('updates instruction field')
      - Setup: create template with instruction 'old'
      - Body: { instruction: 'new instruction' }
      - Assert: status 200
      - Assert: reading YAML file shows updated instruction

    it('updates commitHash field')
      - Setup: create template
      - Body: { commitHash: 'newHash123' }
      - Assert: YAML file contains new hash

    it('returns 404 for non-existent template')
      - Call: PATCH /api/workspaces/:id/templates/ghost
      - Assert: status 404

    it('calls onTemplatesChanged callback after update')
      - Assert: callback called once

  describe('DELETE /api/workspaces/:id/templates/:name')
    it('deletes template file from disk')
      - Setup: create template 'doomed'
      - Call: DELETE /api/workspaces/:id/templates/doomed
      - Assert: status 200 or 204
      - Assert: file no longer exists on disk

    it('returns 404 for non-existent template')
      - Call: DELETE /api/workspaces/:id/templates/ghost
      - Assert: status 404

    it('calls onTemplatesChanged callback after deletion')
      - Assert: callback called once

  describe('YAML serialization')
    it('writes valid YAML that can be parsed back')
      - Create template via POST
      - Read file content, parse with YAML library
      - Assert: parsed object matches input fields

    it('preserves all template fields through write/read cycle')
      - Create with: name, commitHash, instruction, hints, description
      - GET the template back
      - Assert: all fields match original input
```

**Pattern notes:**
- Follow `pipelines-handler.test.ts` pattern: temp directory per test, real filesystem, HTTP helpers.
- If testing in isolation (not full server), register routes on a minimal route table and invoke handlers directly.
- `onTemplatesChanged` is a `vi.fn()` callback passed to `registerTemplateWriteRoutes`.

---

### 5. `packages/coc/test/server/replicate-apply-handler.test.ts`

Tests the apply endpoint that writes `FileChange[]` results to disk.

**Imports:**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
```

**Setup:**

```typescript
let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-test-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});
```

**Test Cases:**

```
describe('replicate-apply-handler')

  describe('applying new files')
    it('creates a new file with correct content')
      - Input: FileChange { path: 'src/new-file.ts', action: 'new', content: 'export const x = 1;' }
      - Apply to tempDir
      - Assert: file exists at tempDir/src/new-file.ts
      - Assert: file content equals 'export const x = 1;'

    it('creates intermediate directories for nested paths')
      - Input: FileChange { path: 'src/deep/nested/dir/file.ts', action: 'new', content: '...' }
      - Assert: all directories created, file exists

    it('does not overwrite existing file when action is new')
      - Setup: write existing file at src/existing.ts
      - Input: action: 'new', path: 'src/existing.ts'
      - Assert: either throws error or skips (document expected behavior)

  describe('applying modified files')
    it('overwrites existing file with new content')
      - Setup: write file with content 'old'
      - Input: FileChange { path: 'src/a.ts', action: 'modified', content: 'new' }
      - Assert: file content is now 'new'

    it('creates file if it does not exist for modified action')
      - Input: action: 'modified', path to non-existent file
      - Assert: file is created (or throws — document expected behavior)

  describe('applying deleted files')
    it('removes file from disk')
      - Setup: write file at src/doomed.ts
      - Input: FileChange { path: 'src/doomed.ts', action: 'deleted' }
      - Assert: file no longer exists

    it('does not error when deleting non-existent file')
      - Input: action: 'deleted', path to non-existent file
      - Assert: no error thrown

    it('does not remove parent directories')
      - Setup: write file at src/dir/only-file.ts
      - Input: delete only-file.ts
      - Assert: src/dir/ still exists (empty directory preserved)

  describe('mixed operations')
    it('applies a batch of new, modified, and deleted changes')
      - Input: [
          { path: 'src/new.ts', action: 'new', content: 'new content' },
          { path: 'src/existing.ts', action: 'modified', content: 'updated' },
          { path: 'src/old.ts', action: 'deleted' },
        ]
      - Setup: pre-create src/existing.ts and src/old.ts
      - Assert: new.ts created, existing.ts updated, old.ts removed

    it('applies changes in order')
      - Provide changes that depend on order (e.g., create then modify same file)
      - Assert: final state reflects ordered application

  describe('error handling')
    it('returns error when process has no result')
      - Mock store returns a process with no replicate result
      - Assert: status 400 or 404 with descriptive message

    it('returns error for missing process ID')
      - Call endpoint without process ID
      - Assert: status 400 or 404

    it('returns error when workspace root does not exist')
      - Provide non-existent workspace path
      - Assert: error with descriptive message

  describe('path safety')
    it('rejects paths with directory traversal (..)')
      - Input: FileChange { path: '../../../etc/passwd', action: 'new', content: 'bad' }
      - Assert: rejected or path is resolved safely within workspace root

    it('rejects absolute paths')
      - Input: FileChange { path: '/etc/passwd', action: 'new', content: 'bad' }
      - Assert: rejected
```

**Pattern notes:**
- Real filesystem with temp directory — matches `pipelines-handler` pattern.
- If the handler is route-based, test via HTTP helpers. If it's a standalone function, call directly.
- Path safety tests are critical for any file-writing endpoint.

---

### 6. `packages/coc/test/server/template-watcher.test.ts`

Tests the `TemplateWatcher` file system watcher lifecycle.

**Imports:**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TemplateWatcher } from '../../src/server/template-watcher';
```

**Setup:**

```typescript
function createTmpWorkspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-test-'));
    const templatesDir = path.join(dir, '.vscode', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    return dir;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let watcher: TemplateWatcher;
let tmpDir: string;

beforeEach(() => {
    tmpDir = createTmpWorkspace();
});

afterEach(() => {
    watcher?.closeAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

**Test Cases:**

```
describe('TemplateWatcher')

  describe('basic watch/unwatch')
    it('fires callback when a YAML file is created in templates directory')
      - Setup: watcher = new TemplateWatcher(callback); watcher.watchWorkspace('ws1', tmpDir);
      - Action: write a .yaml file to .vscode/templates/
      - Wait: 600ms (debounce + CI margin)
      - Assert: callback called with 'ws1'

    it('fires callback when a YAML file is modified')
      - Setup: pre-create .yaml file, start watching
      - Action: append content to the file
      - Wait: 600ms
      - Assert: callback called

    it('fires callback when a YAML file is deleted')
      - Setup: pre-create .yaml file, start watching
      - Action: delete the file
      - Wait: 600ms
      - Assert: callback called

    it('does not fire callback for non-YAML files')
      - Action: create a .txt file in templates directory
      - Wait: 600ms
      - Assert: callback NOT called

    it('stops firing after unwatchWorkspace')
      - Setup: watch, then unwatchWorkspace('ws1')
      - Action: create a .yaml file
      - Wait: 600ms
      - Assert: callback NOT called

  describe('debounce behavior')
    it('debounces rapid events into a single callback')
      - Setup: watch workspace
      - Action: write 10 .yaml files in rapid succession (< 50ms apart)
      - Wait: 800ms
      - Assert: callback called exactly 1 time (not 10)

    it('fires again after debounce window resets')
      - Action: write file, wait 600ms, write another file, wait 600ms
      - Assert: callback called exactly 2 times

  describe('missing directory handling')
    it('does not throw when templates directory does not exist')
      - Setup: workspace with no .vscode/templates/
      - Action: watcher.watchWorkspace('ws2', dirWithoutTemplates)
      - Assert: no error thrown

    it('fires callback when templates directory is created later')
      - Setup: watch workspace without templates dir
      - Action: create .vscode/templates/ directory, then create .yaml file inside
      - Wait: 800ms
      - Assert: callback called (if watcher supports late directory creation)
      - Note: if not supported, assert no crash and document behavior

  describe('closeAll cleanup')
    it('stops all watchers')
      - Setup: watch 2 workspaces
      - Action: watcher.closeAll()
      - Action: write .yaml files in both workspaces
      - Wait: 600ms
      - Assert: callback NOT called after closeAll

    it('is safe to call closeAll multiple times')
      - Action: watcher.closeAll(); watcher.closeAll();
      - Assert: no error thrown

    it('is safe to call closeAll with no active watchers')
      - Setup: create watcher, never call watchWorkspace
      - Action: watcher.closeAll()
      - Assert: no error thrown

  describe('multiple workspaces')
    it('tracks workspaces independently')
      - Setup: watch 'ws1' and 'ws2' on different temp dirs
      - Action: write .yaml in ws1's templates dir
      - Assert: callback called with 'ws1', NOT 'ws2'

    it('prevents double-watch on the same workspace')
      - Action: watchWorkspace('ws1', dir) twice
      - Assert: no error, and creating a file fires callback exactly once

  describe('isWatching state')
    it('returns true after watchWorkspace')
      - Assert: watcher.isWatching('ws1') === true (if method exists)

    it('returns false after unwatchWorkspace')
      - Assert: watcher.isWatching('ws1') === false

    it('returns false for never-watched workspace')
      - Assert: watcher.isWatching('unknown') === false
```

**Pattern notes:**
- Follows `task-watcher.test.ts` exactly: `createTmpWorkspace`, `wait()` helper, `vi.fn()` callbacks.
- All timing uses 600ms+ to account for debounce (typically 300ms) plus CI overhead.
- `afterEach` calls `closeAll()` to prevent leaked watchers.

---

## Testing Patterns Summary

| Layer | Framework | Mocking Strategy | Filesystem |
|-------|-----------|------------------|------------|
| `prompt-builder` | vitest | None (pure function) | None |
| `result-parser` | vitest | None (pure function) | None |
| `replicate-service` | vitest | `vi.fn()` for AIInvoker and GitLogService | None |
| `templates-handler` | vitest | `vi.fn()` for callbacks; real FS | Temp directory |
| `replicate-apply-handler` | vitest | `vi.fn()` for process store | Temp directory |
| `template-watcher` | vitest | `vi.fn()` for onChange callback | Temp directory |

## Naming Conventions

- All test files use `*.test.ts` suffix.
- `pipeline-core` tests go in `packages/pipeline-core/test/templates/` (new subdirectory).
- `coc` tests go in `packages/coc/test/server/` (existing subdirectory).
- Test `describe` blocks mirror the module/class name.
- Test `it` descriptions use present tense: "returns", "creates", "fires", "rejects".

## Running Tests

```bash
# pipeline-core tests only
cd packages/pipeline-core && npx vitest run test/templates/

# coc server tests only
cd packages/coc && npx vitest run test/server/templates-handler.test.ts test/server/replicate-apply-handler.test.ts test/server/template-watcher.test.ts

# all package tests
npm run test:run
```

## Acceptance Criteria

1. **All tests pass:** `npx vitest run` in both `packages/pipeline-core` and `packages/coc` exits 0.
2. **No regressions:** Existing tests continue to pass.
3. **Coverage:** Every public function/method in the templates module has at least one test.
4. **Error paths covered:** Each test file includes negative/error test cases.
5. **No flaky timing:** Watcher tests use sufficient wait times (600ms+) and are deterministic.
6. **No leaked resources:** All watchers, servers, and temp directories are cleaned up in `afterEach`.

## Commit Message

```
test: add template test coverage

Add Vitest tests for all template feature layers:
- pipeline-core: prompt-builder, result-parser, replicate-service
- coc: templates-handler, replicate-apply-handler, template-watcher

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
