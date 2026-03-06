# Fix File Path Href Rendering Bug

## Problem

On Windows, file/folder paths in CoC chat messages render incorrectly. For example:
- **Expected:** `D:/projects/shortcuts/.vscode/tasks/coc/chat`
- **Actual:** `D:/projects/shortcuts.vscode/tasks/coc/chat` (missing `/` before `.vscode`)

## Root Cause

**Markdown backslash escaping strips `\` before `.` (a punctuation character).**

On Windows, `path.resolve()` returns backslash paths like:
```
D:\projects\shortcuts\.vscode\tasks\coc\chat
```

These paths are embedded directly into prompt text (via `buildCreateTaskPrompt`, etc.), which is then rendered as markdown by the `marked` library. Per CommonMark/GFM spec, a backslash before a punctuation character (like `.`) is treated as an escape — the `\` is removed. So `shortcuts\.vscode` becomes `shortcuts.vscode`.

Other backslash sequences like `\p`, `\s`, `\t`, `\c` are preserved because those characters aren't punctuation.

**Verified reproduction:**
```js
const { Marked } = require('marked');
const m = new Marked({ gfm: true, breaks: true });
m.parse('D:\\projects\\shortcuts\\.vscode\\tasks\\coc\\chat');
// → <p>D:\projects\shortcuts.vscode\tasks\coc\chat</p>
//                           ^ missing backslash!
```

## Fix Strategy

Normalize `targetPath` to forward slashes in the prompt builder functions before embedding in markdown. This is the minimal, centralized fix.

### Files to Change

1. **`packages/pipeline-core/src/tasks/task-prompt-builder.ts`**
   - Import `toForwardSlashes` from `../utils/path-utils`
   - In each of the 4 exported prompt builder functions (`buildCreateTaskPrompt`, `buildCreateTaskPromptWithName`, `buildCreateFromFeaturePrompt`, `buildDeepModePrompt`), normalize `targetPath` at the top: `targetPath = toForwardSlashes(targetPath)`

2. **`src/shortcuts/tasks-viewer/ai-task-commands.ts`**
   - This has duplicate prompt builder functions (local copies, not imported from pipeline-core)
   - Apply the same `toForwardSlashes` normalization in the 3 local functions: `buildCreateTaskPrompt`, `buildCreateTaskPromptWithName`, `buildCreateFromFeaturePrompt`
   - Import `toForwardSlashes` (likely already available via pipeline-core re-exports or `path-utils`)

### Tests to Add/Update

3. **`packages/pipeline-core/test/tasks/task-prompt-builder.test.ts`**
   - Add test: Windows backslash paths with `.vscode` produce forward-slash paths in prompt output
   - Verify `shortcuts/.vscode` is present (not `shortcuts.vscode`)

4. **`packages/coc/test/spa/react/chatMarkdownToHtml.test.ts`**
   - The existing test at line 145 passes but doesn't assert the rendered path content
   - Add assertion: the rendered HTML contains `shortcuts/.vscode` (not `shortcuts.vscode`)

## Scope

- Only prompt builder functions need changes (4 in pipeline-core, 3 in VS Code extension)
- No changes to marked config, regex, or rendering pipeline needed
- Fix is cross-platform safe (forward slashes work on all OSes in prompt text)
