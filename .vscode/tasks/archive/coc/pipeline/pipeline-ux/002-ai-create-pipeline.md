---
status: pending
---

# 002: AI-Assisted Pipeline Creation Command

## Summary
Add a `pipelinesViewer.createWithAI` VS Code command that accepts a natural language description, invokes the Copilot AI with the pipeline-generator SKILL.md as system context, and writes the generated `pipeline.yaml` + starter `input.csv` to `.vscode/pipelines/<name>/`, then opens the file in the editor.

## Motivation
Creating pipelines from a blank template still requires deep knowledge of the YAML schema. This command provides a zero-friction alternative: describe your intent in plain English and get a fully-formed, valid pipeline. It is a distinct UX flow (prompt → AI generate → validate → write) that has no dependency on template selection, so it warrants its own commit.

## Changes

### Files to Create
- _(none — no new modules needed)_

### Files to Modify
- `src/shortcuts/yaml-pipeline/ui/commands.ts` — Register `pipelinesViewer.createWithAI` in `registerCommands()` (line 64–83) alongside the existing `pipelinesViewer.create` registration; add private `createPipelineWithAI()` method following the same structural pattern as `createPipelineFromTemplate()` (lines 88–145): prompt for description → prompt for name → delegate to `pipelineManager.createPipelineWithAI()` → refresh tree → open file → show info message.
- `src/shortcuts/yaml-pipeline/ui/pipeline-manager.ts` — Add public `async createPipelineWithAI(description: string, name: string): Promise<string>` method (insert after `createPipelineFromTemplate()` at line 323). This method owns the full AI generation lifecycle: load skill, build prompt, invoke AI, strip fences, validate YAML, write files.
- `package.json` — Add entry to `contributes.commands[]`:
  ```json
  {
    "command": "pipelinesViewer.createWithAI",
    "title": "Create Pipeline with AI",
    "category": "Pipelines"
  }
  ```

### Files to Delete
- _(none)_

## Implementation Notes

### `commands.ts` — `createPipelineWithAI()` (new private method)

Pattern mirrors `createPipelineFromTemplate()` exactly. Key differences:

1. **Description input** — collect before name:
   ```ts
   const description = await vscode.window.showInputBox({
       prompt: 'Describe what your pipeline should do',
       placeHolder: 'e.g. Classify GitHub issues by severity using AI',
       validateInput: (v) => (!v?.trim() ? 'Description cannot be empty' : null)
   });
   if (!description) { return; }
   ```

2. **Name input** — reuse the same `validateInput` logic already present in `createPipelineFromTemplate()` (lines 113–122). Default placeholder: `'my-ai-pipeline'`.

3. **Delegate & open** — identical to lines 129–144 but calling `pipelineManager.createPipelineWithAI(description.trim(), name.trim())`.

4. **Success message**: `Pipeline "${name}" created with AI – review and adjust as needed.`

5. **Error message**: `Failed to create pipeline with AI: ${err.message}` (same pattern as line 143).

Register in `registerCommands()`:
```ts
vscode.commands.registerCommand('pipelinesViewer.createWithAI', () => this.createPipelineWithAI()),
```

### `pipeline-manager.ts` — `createPipelineWithAI()` (new public method)

**Signature:**
```ts
async createPipelineWithAI(
    description: string,
    name: string,
    processManager?: IAIProcessManager
): Promise<string>
```

`processManager` is optional; `PipelineCommands` passes `this.aiProcessManager` when calling.  
Alternatively, wire `processManager` via the existing `PipelineManager` constructor or a setter — choose whichever keeps the diff minimal (a setter like `setAIProcessManager` mirrors how `PipelineCommands` already does it for `IAIProcessManager`).

**Imports to add** at top of `pipeline-manager.ts`:
```ts
import * as path from 'path';             // already imported
import { getSkills } from '../../shared/skill-files-utils';
import { parsePipelineYAMLSync } from '@plusplusoneplusplus/pipeline-core';
import { createAIInvoker } from '../../ai-service/ai-invoker-factory';
import { IAIProcessManager } from '../../ai-service/types';
```

**Step-by-step implementation:**

```ts
async createPipelineWithAI(description: string, name: string, processManager?: IAIProcessManager): Promise<string> {
    this.ensurePipelinesFolderExists();

    const sanitizedName = this.sanitizeFileName(name);
    const packagePath = path.join(this.getPipelinesFolder(), sanitizedName);
    if (safeExists(packagePath)) {
        throw new Error(`Pipeline "${name}" already exists`);
    }

    // 1. Load SKILL.md for the pipeline-generator skill
    const skills = await getSkills(this.workspaceRoot);
    const skill = skills.find(s => s.name === 'pipeline-generator');
    let skillContext = '';
    if (skill) {
        const skillMdPath = path.join(skill.absolutePath, 'SKILL.md');
        try {
            skillContext = require('fs').readFileSync(skillMdPath, 'utf8');
        } catch {
            // skill not readable; continue without it
        }
    }

    // 2. Build prompt
    const prompt = skillContext
        ? `${skillContext}\n\nUser request: ${description}\n\nReturn ONLY valid pipeline.yaml content. No markdown code fences. No explanation.`
        : `You are a pipeline generator. Generate a valid pipeline.yaml for the following request.\n\nUser request: ${description}\n\nReturn ONLY valid pipeline.yaml content. No markdown code fences. No explanation.`;

    // 3. Invoke AI
    const aiInvoker = createAIInvoker({
        workingDirectory: this.workspaceRoot,
        featureName: 'Pipeline Generator',
        clipboardFallback: true,
        processManager
    });

    const result = await aiInvoker(prompt);
    if (!result.success || !result.response) {
        throw new Error(result.error || 'AI did not return a response');
    }

    // 4. Strip markdown fences
    const yamlContent = result.response
        .replace(/^```ya?ml\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

    // 5. Validate generated YAML
    try {
        parsePipelineYAMLSync(yamlContent);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`AI generated invalid pipeline YAML: ${msg}`);
    }

    // 6. Write files
    ensureDirectoryExists(packagePath);
    const filePath = path.join(packagePath, 'pipeline.yaml');
    safeWriteFile(filePath, yamlContent);
    safeWriteFile(
        path.join(packagePath, 'input.csv'),
        'id,title,description\n1,Sample Item,Replace with your data'
    );

    return filePath;
}
```

### Fence stripping

The regex `replace(/^```ya?ml\s*/i, '').replace(/\s*```$/, '').trim()` handles:
- ` ```yaml` and ` ```yml` (case-insensitive)
- Trailing ` ``` ` with surrounding whitespace
- Responses that already have no fences (both replaces are no-ops)

### Validation failure path

`parsePipelineYAMLSync` throws a `PipelineExecutionError` (or generic `Error`) on invalid YAML or schema violations. The thrown error is caught in `commands.ts` by the existing `try/catch` block and displayed via `vscode.window.showErrorMessage`. No file is written before this check passes.

### `package.json` placement

Insert the new command entry in `contributes.commands[]` immediately after the existing `pipelinesViewer.create` entry to keep the list coherent.

## Tests

Unit tests live alongside other pipeline-manager tests in `src/test/suite/`.

- **`pipeline-manager-ai-create.test.ts`** (new file):
  1. **Happy path** — mock `createAIInvoker` to return valid YAML; assert `pipeline.yaml` is written to `<pipelinesFolder>/<name>/pipeline.yaml` and `input.csv` is also written; assert returned path equals the `pipeline.yaml` path.
  2. **Fence stripping** — test the regex independently: inputs with ` ```yaml…``` `, ` ```yml…``` `, and bare YAML all produce identical output.
  3. **Invalid YAML from AI** — mock `createAIInvoker` to return `"not: valid: yaml: ["` (malformed); assert the method throws with a message containing `"invalid pipeline YAML"` and that no files are written (check `safeWriteFile` is not called / directory not created).
  4. **AI invocation failure** — mock result `{ success: false, error: 'Copilot unavailable' }`; assert throws with `"Copilot unavailable"`.
  5. **Skill not found** — mock `getSkills` returning `[]`; assert fallback prompt (no SKILL.md prefix) is used and generation still succeeds.

## Acceptance Criteria

- [ ] Command `pipelinesViewer.createWithAI` appears in the command palette as **"Pipelines: Create Pipeline with AI"**
- [ ] Prompts the user for a natural language description, then a pipeline name
- [ ] AI generation is visible in the **AI Processes** panel while running (process registered via `processManager`)
- [ ] Generated `pipeline.yaml` is written to `.vscode/pipelines/<name>/pipeline.yaml` and opened in the editor
- [ ] A starter `input.csv` is written alongside the YAML
- [ ] If the AI returns invalid YAML, an error message is shown and no files are written
- [ ] If the AI backend is unavailable, the prompt is copied to clipboard (clipboard fallback)
- [ ] Success message reads: _"Pipeline \"\<name\>\" created with AI – review and adjust as needed."_
- [ ] Existing `pipelinesViewer.create` (template flow) is unaffected

## Dependencies

- Depends on: None

## Assumed Prior State

None. Commit 001 adds a JSON schema file only and introduces no TypeScript changes. This commit assumes:
- `PipelineManager` with `createPipeline()` / `createPipelineFromTemplate()` / `sanitizeFileName()` / `ensurePipelinesFolderExists()` / `safeWriteFile()` helpers already exist (lines 292–325 of `pipeline-manager.ts`).
- `createAIInvoker(options: AIInvokerFactoryOptions): AIInvoker` is exported from `src/shortcuts/ai-service/ai-invoker-factory.ts` (line 126) and re-exported via `src/shortcuts/ai-service/index.ts` (line 177).
- `parsePipelineYAMLSync(yaml: string): PipelineConfig` is exported from `@plusplusoneplusplus/pipeline-core` (packages/pipeline-core/src/pipeline/executor.ts).
- `getSkills(workspaceRoot?: string): Promise<Skill[]>` is exported from `src/shortcuts/shared/skill-files-utils.ts` (line 25). Each `Skill` has `absolutePath: string` and `name: string`.
- `.github/skills/pipeline-generator/SKILL.md` exists in the workspace (confirmed present).
- `IAIProcessManager` is exported from `src/shortcuts/ai-service/types.ts` and re-exported via the `ai-service` index.
