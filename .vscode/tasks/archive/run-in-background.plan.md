# "Run in Background" Option for Follow Prompt Feature

## User Ask
In the markdown review editor, the AI Action dropdown → Follow Prompt submenu currently only launches interactive AI sessions in an external terminal. Add an option to **run the prompt in the background** instead, allowing users to continue working while AI processing completes asynchronously.

---

## Current State Analysis

### Existing Follow Prompt Flow
1. User clicks **AI Action** → **Follow Prompt** → selects a prompt file or skill
2. `handleExecuteWorkPlan()` or `handleExecuteWorkPlanWithSkill()` is called
3. An **interactive session** is launched via `InteractiveSessionManager.startSession()`
4. User interacts with AI in an external terminal (iTerm2, Terminal, etc.)

### Key Components Involved
- **Webview Content** (`webview-content.ts` lines 139-185): HTML dropdown menu structure
- **DOM Handlers** (`dom-handlers.ts` lines 467-593): Menu event handlers
- **VSCode Bridge** (`vscode-bridge.ts` lines 221-234): Message posting functions
- **Review Editor Provider** (`review-editor-view-provider.ts` lines 1414-1541): Backend handlers
- **AI Process Manager** (`ai-process-manager.ts`): Tracks running/completed AI processes

---

## Proposed Design

### Option 1: Add "Run in Background" Submenu Items (Recommended)

Add a second tier of options when selecting a prompt/skill:

```
AI Action
└── Follow Prompt
    ├── 📂 Recent Prompts
    │   └── implement.prompt.md
    │       ├── 🖥️ Interactive Session (existing behavior)
    │       └── ⏳ Run in Background (NEW)
    ├── 📁 Prompt Files
    │   └── review-code.prompt.md
    │       ├── 🖥️ Interactive Session
    │       └── ⏳ Run in Background (NEW)
    └── 🔧 Skills
        └── code-review
            ├── 🖥️ Interactive Session
            └── ⏳ Run in Background (NEW)
```

**Pros:** Clear separation, user explicitly chooses execution mode
**Cons:** Deeper menu nesting, more clicks

### Option 2: Toggle Switch in Additional Context Dialog (Alternative)

When user selects a prompt, the existing input dialog for "Additional context" gains a checkbox:

```
┌─────────────────────────────────────────────────┐
│ Additional context or instructions (optional)   │
│ ┌─────────────────────────────────────────────┐ │
│ │ Focus on error handling...                  │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ [x] Run in background (view progress in AI     │
│     Processes panel)                           │
│                                                 │
│            [Cancel]  [Execute]                 │
└─────────────────────────────────────────────────┘
```

**Pros:** Fewer menu changes, familiar dialog
**Cons:** VS Code's `showInputBox` doesn't support checkboxes natively; would need a webview dialog or Quick Pick

### Option 3: Quick Pick with Execution Mode (Simpler)

After selecting a prompt file, show a Quick Pick:

```
How do you want to execute this prompt?
> 🖥️ Interactive Session - Launch in external terminal
  ⏳ Run in Background - Track in AI Processes panel
```

**Pros:** Simple, no menu redesign, uses native VS Code UI
**Cons:** One extra step for every execution

---

## Recommended Implementation: Option 3 (Quick Pick)

This approach minimizes changes while providing clear user choice.

### Implementation Steps

#### 1. Update Message Types (`webview-scripts/types.ts`)
Add optional `runInBackground` flag to messages:
```typescript
| { type: 'executeWorkPlan'; promptFilePath: string; runInBackground?: boolean }
| { type: 'executeWorkPlanWithSkill'; skillName: string; runInBackground?: boolean }
```

#### 2. Update VSCode Bridge (`vscode-bridge.ts`)
Modify `requestExecuteWorkPlan` and `requestExecuteWorkPlanWithSkill` to accept optional flag.

#### 3. Update Review Editor Provider (`review-editor-view-provider.ts`)

##### 3.1 Add Execution Mode Selection
Create a helper method to prompt for execution mode:
```typescript
private async selectExecutionMode(): Promise<'interactive' | 'background' | undefined> {
    const items = [
        { label: '$(terminal) Interactive Session', 
          description: 'Launch in external terminal', 
          mode: 'interactive' as const },
        { label: '$(watch) Run in Background', 
          description: 'Track in AI Processes panel', 
          mode: 'background' as const }
    ];
    
    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'How do you want to execute this prompt?'
    });
    
    return selected?.mode;
}
```

##### 3.2 Modify handleExecuteWorkPlan
```typescript
private async handleExecuteWorkPlan(
    planFilePath: string,
    promptFilePath: string
): Promise<void> {
    // Track prompt usage
    await this.trackPromptUsage(promptFilePath);
    
    // NEW: Select execution mode
    const executionMode = await this.selectExecutionMode();
    if (!executionMode) return; // User cancelled
    
    // Prompt for additional context
    const additionalMessage = await vscode.window.showInputBox({ ... });
    if (additionalMessage === undefined) return;
    
    // Build prompt
    let fullPrompt = `Follow ${promptFilePath} for ${planFilePath}`;
    if (additionalMessage?.trim()) {
        fullPrompt += `\n\nAdditional context: ${additionalMessage.trim()}`;
    }
    
    if (executionMode === 'background') {
        // NEW: Run in background using AIProcessManager
        await this.executeInBackground(planFilePath, promptFilePath, fullPrompt);
    } else {
        // Existing: Launch interactive session
        await this.launchInteractiveSession(planFilePath, promptFilePath, fullPrompt);
    }
}
```

##### 3.3 Add Background Execution Method
```typescript
private async executeInBackground(
    planFilePath: string,
    promptFilePath: string,
    prompt: string
): Promise<void> {
    const workspaceRoot = getWorkspaceRoot() || '';
    const workingDirectory = this.resolveWorkPlanWorkingDirectory(planFilePath);
    
    // Create a unique name for the process
    const planName = path.basename(planFilePath);
    const promptName = path.basename(promptFilePath);
    const processName = `Follow Prompt: ${promptName} → ${planName}`;
    
    // Use CopilotSDKService for background execution
    const sdkService = getCopilotSDKService();
    
    // Register process with AIProcessManager
    const processId = await this.aiProcessManager.startProcess(
        processName,
        'follow-prompt',  // New process type
        { planFilePath, promptFilePath }  // Metadata
    );
    
    try {
        // Execute using SDK (non-interactive)
        const result = await sdkService.sendMessage({
            prompt,
            workingDirectory,
            usePool: false,  // Direct session for long-running tasks
            onPermissionRequest: approveAllPermissions  // Allow file operations
        });
        
        // Mark process as complete
        await this.aiProcessManager.completeProcess(processId, {
            success: true,
            output: result.text
        });
        
        vscode.window.showInformationMessage(
            `Background execution complete: ${processName}`,
            'View Result'
        ).then(action => {
            if (action === 'View Result') {
                // Open AI Processes panel or show output
                vscode.commands.executeCommand('shortcuts.showAIProcess', processId);
            }
        });
        
    } catch (error) {
        await this.aiProcessManager.failProcess(processId, error);
        vscode.window.showErrorMessage(
            `Background execution failed: ${error.message}`
        );
    }
}
```

#### 4. Update AIProcessManager Types
Add new process type for follow-prompt:
```typescript
export type AIProcessType = 
    | 'ai-clarification'
    | 'code-review'
    | 'discovery'
    | 'follow-prompt'  // NEW
    | 'generic';
```

#### 5. UI/UX Considerations

##### Progress Indication
- Show notification when background process starts
- Update AI Processes tree view with the running process
- Show completion notification with "View Result" action

##### Result Display
- Store output in AIProcessManager's result file system
- Allow viewing full output via existing "View Output" command
- Consider adding inline preview in the tree view

##### Cancellation
- Add cancel button in AI Processes panel for running processes
- Use SDK's cancel mechanism to abort long-running requests

---

## Alternative: Deep Menu Implementation (Option 1)

If a richer menu experience is preferred:

### Update Webview Content (`webview-content.ts`)
```html
<div class="ai-action-submenu-item prompt-item" data-prompt-path="...">
    <span class="prompt-name">implement.prompt.md</span>
    <div class="prompt-execution-modes">
        <button class="execution-mode-btn" data-mode="interactive" title="Interactive">🖥️</button>
        <button class="execution-mode-btn" data-mode="background" title="Background">⏳</button>
    </div>
</div>
```

### Update DOM Handlers
Handle click events on execution mode buttons:
```typescript
item.querySelectorAll('.execution-mode-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        const promptPath = item.dataset.promptPath;
        
        if (mode === 'background') {
            requestExecuteWorkPlanBackground(promptPath);
        } else {
            requestExecuteWorkPlan(promptPath);
        }
    });
});
```

---

## Testing Plan

1. **Unit Tests**
   - Test `selectExecutionMode()` returns correct values
   - Test `executeInBackground()` creates process in AIProcessManager
   - Test error handling and cancellation

2. **Integration Tests**
   - Test full flow: select prompt → choose background → verify process tracked
   - Test completion notification appears
   - Test "View Result" action works

3. **Manual Testing**
   - Test with various prompt files
   - Test with skills
   - Test cancellation mid-execution
   - Verify AI Processes panel updates correctly

---

## Future Enhancements

1. **Remember Preference**: Add setting to default to interactive/background mode
2. **Batch Execution**: Allow running multiple prompts in background sequentially
3. **Progress Streaming**: Show real-time AI output in a dedicated panel
4. **History Integration**: Link background execution results to the plan file

---

## Summary

The recommended approach uses VS Code's Quick Pick to let users choose between:
- **Interactive Session**: Current behavior (external terminal)
- **Run in Background**: New behavior (AIProcessManager + SDK)

This requires minimal UI changes while providing a clear, discoverable user experience. The background execution leverages existing `AIProcessManager` infrastructure for tracking and displaying results.
