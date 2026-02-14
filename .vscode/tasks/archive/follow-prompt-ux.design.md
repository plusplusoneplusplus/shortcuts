# UX Design: AI Action → Follow Prompt with Execution Mode & Model Selection

## Overview

Design the user experience for selecting execution mode (Background / Interactive) and AI model when using **AI Action → Follow Prompt** in the Markdown Review Editor.

---

## Current State

### Existing Flow
1. User clicks **AI Action** dropdown in the editor toolbar
2. Selects **Follow Prompt** → chooses a prompt file or skill
3. Enters optional additional context
4. Launches interactive session in external terminal

### Existing Modes (AICommandMode)
```typescript
type AICommandMode = 'comment' | 'interactive';
```
- `comment`: AI response added as inline comment
- `interactive`: Opens external terminal session

---

## Proposed UX Design

### Goal
Allow users to:
1. **Choose execution mode**: Background (async) vs Interactive (terminal)
2. **Select AI model**: Choose from available models (e.g., GPT-4, Claude, etc.)

---

## Option A: Modal Dialog with Options (Recommended)

After selecting a prompt file, show a unified dialog:

```
┌─────────────────────────────────────────────────────────┐
│  Follow Prompt: implement.prompt.md                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Additional Context (optional)                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Focus on error handling and edge cases...        │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Execution Mode                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ○ 🖥️  Interactive Session                       │    │
│  │      Launch in external terminal                │    │
│  │                                                 │    │
│  │ ● ⏳ Background                                 │    │
│  │      Track progress in AI Processes panel      │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  AI Model                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Claude Sonnet 4 (Recommended)              ▾ │    │
│  └─────────────────────────────────────────────────┘    │
│  └ gpt-4o                                               │
│  └ claude-sonnet-4-20250514                             │
│  └ o1-preview                                           │
│                                                         │
│              [Cancel]            [Execute]              │
└─────────────────────────────────────────────────────────┘
```

### Pros
- All options in one place
- Clear visual hierarchy
- User can see all choices before executing
- Supports future options (timeout, permissions, etc.)

### Cons
- More clicks than current flow
- Requires webview dialog implementation

---

## Option B: Sequential Quick Picks

Use VS Code's native Quick Pick for each choice:

### Step 1: Select Prompt (existing)
```
Select a prompt file
> 📄 implement.prompt.md
  📄 review-code.prompt.md
  📄 refactor.prompt.md
```

### Step 2: Select Execution Mode (new)
```
How do you want to run this prompt?
> 🖥️ Interactive Session - Launch in external terminal
  ⏳ Run in Background - Track in AI Processes panel
```

### Step 3: Select Model (new)
```
Select AI model
> claude-sonnet-4-20250514 (Recommended)
  gpt-4o
  o1-preview
  ───────────────────
  Use default model
```

### Step 4: Additional Context (existing)
```
Additional context or instructions (optional)
[ Focus on error handling...                    ]
```

### Pros
- Uses native VS Code UI
- Minimal implementation effort
- Consistent with VS Code patterns

### Cons
- More steps (4 dialogs vs 1)
- Can feel tedious for repeated use

---

## Option C: Inline Menu with Icons (Compact)

Extend the dropdown menu with mode/model indicators:

```
AI Action
└── Follow Prompt
    ├── 📂 Recent Prompts
    │   └── implement.prompt.md
    │       ├── 🖥️ Interactive │ claude-sonnet-4
    │       ├── 🖥️ Interactive │ gpt-4o
    │       ├── ⏳ Background │ claude-sonnet-4
    │       └── ⏳ Background │ gpt-4o
    ├── 📁 Prompt Files
    │   └── ...
    └── 🔧 Skills
        └── ...
```

### Pros
- Minimal additional clicks
- All options visible at once

### Cons
- Menu becomes very deep/wide
- Hard to scale with many models
- Visual clutter

---

## ✅ Selected Approach: Option A (Modal Dialog)

**Decision**: Implement Option A for a unified, professional UX.

---

## Option A Implementation Plan

### Phase 1: Type Definitions & Configuration

#### 1.1 Files to Modify
| File | Changes |
|------|---------|
| `src/shortcuts/ai-service/ai-command-types.ts` | Add `'background'` to `AICommandMode` |
| `src/shortcuts/ai-service/types.ts` | Add `FollowPromptExecutionOptions`, `FollowPromptProcessMetadata` |
| `package.json` | Add settings for default preferences |

#### 1.2 New Settings
```json
{
    "workspaceShortcuts.followPrompt.defaultMode": {
        "type": "string",
        "enum": ["interactive", "background"],
        "default": "interactive",
        "description": "Default execution mode for Follow Prompt"
    },
    "workspaceShortcuts.followPrompt.defaultModel": {
        "type": "string",
        "default": "claude-sonnet-4.5",
        "description": "Default AI model for Follow Prompt"
    },
    "workspaceShortcuts.followPrompt.rememberLastSelection": {
        "type": "boolean",
        "default": true,
        "description": "Remember last used mode and model"
    }
}
```

### Phase 2: Webview Dialog Component

#### 2.1 Dialog HTML Structure
Add to `webview-content.ts` template:

```html
<div id="followPromptDialog" class="modal-overlay hidden">
  <div class="modal-dialog">
    <div class="modal-header">
      <h3>📝 Follow Prompt: <span id="fpPromptName"></span></h3>
      <button id="fpCloseBtn" class="close-btn">×</button>
    </div>
    
    <div class="modal-body">
      <!-- Additional Context -->
      <div class="form-group">
        <label>Additional Context (optional)</label>
        <textarea id="fpAdditionalContext" 
                  placeholder="e.g., Focus on error handling..."
                  rows="3"></textarea>
      </div>
      
      <hr class="divider" />
      
      <!-- Execution Mode -->
      <div class="form-group">
        <label>Execution Mode</label>
        <div class="radio-group">
          <label class="radio-option">
            <input type="radio" name="fpMode" value="interactive" checked />
            <span class="radio-label">
              <span class="icon">🖥️</span>
              <span class="title">Interactive Session</span>
              <span class="desc">Launch in external terminal</span>
            </span>
          </label>
          <label class="radio-option">
            <input type="radio" name="fpMode" value="background" />
            <span class="radio-label">
              <span class="icon">⏳</span>
              <span class="title">Background</span>
              <span class="desc">Track progress in AI Processes panel</span>
            </span>
          </label>
        </div>
      </div>
      
      <!-- AI Model -->
      <div class="form-group">
        <label>AI Model</label>
        <select id="fpModelSelect">
          <option value="claude-sonnet-4.5">Claude Sonnet 4.5 (Recommended)</option>
          <option value="claude-haiku-4.5">Claude Haiku 4.5</option>
          <option value="claude-opus-4.5">Claude Opus 4.5</option>
          <option value="gpt-5.1-codex-max">GPT-5.1 Codex Max</option>
          <option value="gemini-3-pro-preview">Gemini 3 Pro (Preview)</option>
        </select>
      </div>
    </div>
    
    <div class="modal-footer">
      <button id="fpCancelBtn" class="btn btn-secondary">Cancel</button>
      <button id="fpExecuteBtn" class="btn btn-primary">Execute</button>
    </div>
  </div>
</div>
```

#### 2.2 Message Types
```typescript
// Webview → Extension
interface ShowFollowPromptDialogMessage {
    type: 'showFollowPromptDialog';
    promptFilePath: string;
    promptName: string;
    skillName?: string;
}

interface FollowPromptDialogResultMessage {
    type: 'followPromptDialogResult';
    promptFilePath: string;
    skillName?: string;
    options: FollowPromptExecutionOptions;
}

// Extension → Webview
interface FollowPromptDialogDataMessage {
    type: 'followPromptDialogData';
    promptName: string;
    availableModels: AIModelConfig[];
    defaults: {
        mode: 'interactive' | 'background';
        model: string;
    };
}
```

### Phase 3: Backend Execution Logic

#### 3.1 New Method: `executeFollowPromptInBackground()`
Location: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`

```typescript
private async executeFollowPromptInBackground(
    planFilePath: string,
    promptFilePath: string,
    options: FollowPromptExecutionOptions
): Promise<void> {
    const processManager = getAIProcessManager();
    const sdkService = getCopilotSDKService();
    
    // Register process
    const processId = processManager.registerTypedProcess({
        type: 'follow-prompt',
        label: `Follow: ${path.basename(promptFilePath)}`,
        metadata: {
            promptFile: promptFilePath,
            planFile: planFilePath,
            model: options.model,
            additionalContext: options.additionalContext
        }
    });
    
    try {
        // Build full prompt
        const promptContent = fs.readFileSync(promptFilePath, 'utf-8');
        let fullPrompt = `Follow this instruction:\n\n${promptContent}\n\nApply to: ${planFilePath}`;
        if (options.additionalContext) {
            fullPrompt += `\n\nAdditional context: ${options.additionalContext}`;
        }
        
        // Execute via SDK
        const result = await sdkService.sendMessage({
            prompt: fullPrompt,
            model: options.model,
            workingDirectory: this.resolveWorkPlanWorkingDirectory(planFilePath),
            timeoutMs: options.timeoutMs ?? 600000
        });
        
        // Complete process
        processManager.completeProcess(processId, {
            success: result.success,
            result: result.response,
            error: result.error
        });
        
        if (result.success) {
            vscode.window.showInformationMessage(
                `✅ Follow Prompt completed: ${path.basename(promptFilePath)}`,
                'View Result'
            ).then(action => {
                if (action === 'View Result') {
                    vscode.commands.executeCommand('shortcuts.aiProcesses.showResult', processId);
                }
            });
        }
    } catch (error) {
        processManager.failProcess(processId, error);
        vscode.window.showErrorMessage(`Follow Prompt failed: ${error}`);
    }
}
```

#### 3.2 Update `handleExecuteWorkPlan()`
```typescript
private async handleExecuteWorkPlan(
    planFilePath: string,
    promptFilePath: string
): Promise<void> {
    await this.trackPromptUsage(promptFilePath);
    
    // Show dialog and get options
    const options = await this.showFollowPromptDialog(promptFilePath);
    if (!options) return; // User cancelled
    
    if (options.mode === 'background') {
        await this.executeFollowPromptInBackground(planFilePath, promptFilePath, options);
    } else {
        // Existing interactive flow
        await this.executeFollowPromptInteractive(planFilePath, promptFilePath, options);
    }
}
```

### Phase 4: Process Type Registration

#### 4.1 Add to `AIProcessType`
```typescript
// In pipeline-core/src/ai/process-types.ts
export type AIProcessType = 
    | 'clarification'
    | 'code-review'
    | 'discovery'
    | 'follow-prompt'  // NEW
    | 'generic';
```

#### 4.2 Process Metadata
```typescript
interface FollowPromptProcessMetadata extends GenericProcessMetadata {
    promptFile: string;
    planFile: string;
    model: string;
    additionalContext?: string;
}
```

### Phase 5: Testing

#### 5.1 Unit Tests
- `follow-prompt-dialog.test.ts` - Dialog show/hide, form validation
- `follow-prompt-execution.test.ts` - Background execution, process tracking

#### 5.2 Integration Tests
- Dialog appears after prompt selection
- Options passed correctly to execution
- Process tracked in AI Processes panel
- Completion notification shown

---

## Alternative Reference: Option B with Enhancements

Use **Option B (Sequential Quick Picks)** with these UX improvements:

### 1. Remember Last Selection
Store user's last execution mode and model preference:
```typescript
interface FollowPromptPreferences {
    lastExecutionMode: 'interactive' | 'background';
    lastModel: string;
    rememberMode: boolean;  // Skip mode selection if true
    rememberModel: boolean; // Skip model selection if true
}
```

### 2. Combine Mode + Model in Single Quick Pick
```
How do you want to run this prompt?
> 🖥️ Interactive │ claude-sonnet-4 (last used)
  🖥️ Interactive │ gpt-4o
  ─────────────────────────────────
  ⏳ Background │ claude-sonnet-4
  ⏳ Background │ gpt-4o
  ─────────────────────────────────
  ⚙️ Configure default settings...
```

### 3. Keyboard Shortcuts
- `Ctrl+Enter` in prompt selection: Execute with defaults (skip mode/model dialog)
- Hold `Shift` while clicking: Always show mode/model dialog

### 4. Settings for Defaults
```json
{
    "workspaceShortcuts.followPrompt.defaultMode": "background",
    "workspaceShortcuts.followPrompt.defaultModel": "claude-sonnet-4-20250514",
    "workspaceShortcuts.followPrompt.alwaysAskMode": false,
    "workspaceShortcuts.followPrompt.alwaysAskModel": false
}
```

---

## Type Definitions

### Extended AICommandMode
```typescript
type AICommandMode = 'comment' | 'interactive' | 'background';
```

### Execution Options
```typescript
interface FollowPromptExecutionOptions {
    /** Execution mode */
    mode: 'interactive' | 'background';
    /** AI model to use */
    model: string;
    /** Additional context/instructions */
    additionalContext?: string;
    /** Timeout in ms (for background mode) */
    timeoutMs?: number;
}
```

### Available Models (Configuration)
```typescript
interface AIModelConfig {
    id: string;          // e.g., "claude-sonnet-4-20250514"
    label: string;       // e.g., "Claude Sonnet 4"
    description?: string; // e.g., "(Recommended for coding)"
    isDefault?: boolean;
}
```

---

## User Flow Summary

```
┌─────────────────────┐
│  Click "AI Action"  │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Select "Follow     │
│  Prompt"            │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Select prompt file │
│  or skill           │
└─────────┬───────────┘
          ▼
    ┌─────┴─────┐
    │Has default│
    │settings?  │
    └─────┬─────┘
      No  │  Yes
    ┌─────┴─────┐
    ▼           ▼
┌─────────┐  ┌─────────────┐
│ Quick   │  │ Use default │
│ Pick:   │  │ mode/model  │
│ Mode +  │  └──────┬──────┘
│ Model   │         │
└────┬────┘         │
     └──────┬───────┘
            ▼
┌─────────────────────┐
│  Input: Additional  │
│  context (optional) │
└─────────┬───────────┘
          ▼
    ┌─────┴─────┐
    │  Mode?    │
    └─────┬─────┘
  Background│Interactive
    ┌───────┴───────┐
    ▼               ▼
┌─────────┐   ┌───────────┐
│ SDK     │   │ External  │
│ Service │   │ Terminal  │
│ + Track │   │ Session   │
│ in AI   │   └───────────┘
│ Panel   │
└─────────┘
```

---

## Implementation Checklist

### Phase 1: Type Definitions & Configuration
- [x] Add `'background'` to `AICommandMode` type in `ai-command-types.ts`
- [x] Add `FollowPromptExecutionOptions` interface to `types.ts`
- [x] Add `FollowPromptProcessMetadata` interface to `types.ts`
- [x] Add VS Code settings in `package.json`:
  - `workspaceShortcuts.followPrompt.defaultMode`
  - `workspaceShortcuts.followPrompt.defaultModel`
  - `workspaceShortcuts.followPrompt.rememberLastSelection`

### Phase 2: Webview Dialog Component
- [x] Add dialog HTML template to `webview-content.ts`
- [x] Add dialog CSS styles (modal, form controls, radio buttons)
- [x] Implement dialog JavaScript (show/hide, form handling)
- [x] Add message types for dialog communication

### Phase 3: Backend Execution Logic
- [x] Create `showFollowPromptDialog()` method
- [x] Create `executeFollowPromptInBackground()` method
- [x] Create `executeFollowPromptInteractive()` method (refactor existing)
- [x] Update `handleExecuteWorkPlan()` to use dialog
- [x] Update `handleExecuteWorkPlanWithSkill()` to use dialog

### Phase 4: Process Tracking
- [x] Add `'follow-prompt'` to `AIProcessType` in pipeline-core
- [x] Register process with metadata in AIProcessManager
- [x] Show completion notification with "View Result" action
- [x] Display results in AI Processes panel

### Phase 5: Model Selection
- [x] Expose `VALID_MODELS` with display labels
- [x] Create `getAvailableModels()` helper function
- [x] Mark first model as "(Recommended)"
- [x] Remember last selected model in workspace state

### Phase 6: Testing
- [x] Unit tests for dialog validation
- [x] Unit tests for background execution
- [x] Unit tests for process tracking
- [x] Integration tests for full flow (6581 tests passing)

---

## Future Enhancements

1. **Batch Execution**: Run same prompt against multiple files
2. **Scheduled Execution**: Run prompts at specific times
3. **Model Comparison**: Run same prompt with multiple models, compare results
4. **Cost Estimation**: Show estimated token usage before execution
5. **Template Variables**: Support `{{model}}` in prompts for dynamic model selection
