# AI Action "Resolve Comments" - Send to CLI in Background Option

## User Ask
In the Markdown Review Editor, when using AI Action → Resolve Comments (or similar AI-powered actions), add an option to **send the request to CLI in background** instead of the current foreground execution. This allows users to continue working while the AI processes the request asynchronously.

---

## Current State Analysis (Updated 2026-01-31)

### Existing AI Action Modes
The codebase defines three `AICommandMode` types in `src/shortcuts/shared/webview/context-menu-types.ts`:
```typescript
export type AICommandMode = 'comment' | 'interactive' | 'background';
```

**Current Implementation Status:**
- ✅ **'comment'**: Fully implemented - adds AI response as inline comment via `handleAskAI()` (lines 739-811)
- ✅ **'interactive'**: Fully implemented - opens interactive CLI session via `handleAskAIInteractive()` (lines 817-896)
- ❌ **'background'**: Type defined but **NOT YET IMPLEMENTED** - no handler, no menu option

### Key Files Involved
1. **`review-editor-view-provider.ts`**:
   - `handleAskAI()` (lines 739-811) - handles 'comment' mode
   - `handleAskAIInteractive()` (lines 817-896) - handles 'interactive' mode
   - Message handler switch (lines 625-635) - only routes `askAI` and `askAIInteractive`, no background routing

2. **`context-menu-builder.ts`**:
   - `buildAIMenuItemHTML()` (lines 236-267) - builds menu for 'comment' and 'interactive' modes only
   - `buildAISubmenuHTML()` (lines 199-227) - generates submenu items with `data-mode` attribute
   - `buildContextMenuHTML()` (lines 307-339) - assembles full menu, calls `buildAIMenuItemHTML` for both modes

3. **`context-menu-types.ts`**:
   - `AICommandMode` type includes 'background' (line 14) ✅
   - `SerializedAIMenuConfig` only has `commentCommands` and `interactiveCommands` arrays (no `backgroundCommands`)

### Current Message Flow
1. User selects text → context menu → "Ask AI to Comment" or "Ask AI Interactively"
2. Webview sends `askAI` (comment mode) or `askAIInteractive` message
3. Provider routes to `handleAskAI()` or `handleAskAIInteractive()`
4. Both use existing infrastructure:
   - Comment: `handleAIClarification()` → adds result as comment
   - Interactive: `InteractiveSessionManager` → external terminal

### Existing Infrastructure to Leverage
- ✅ `CopilotSDKService` - already used for Follow Prompt background execution
- ✅ `AIProcessManager` - tracks background processes, persists state
- ✅ `approveAllPermissions` - permission handler for SDK calls
- ✅ `AIProcessTreeDataProvider` - displays running/completed processes
- ✅ `AskAIContext` interface already includes `mode: AICommandMode`

---

## Recommended Implementation: Add Third Menu Option

### Design
Add a third top-level AI menu option "Ask AI in Background" alongside the existing two:

```
Context Menu
├── Ask AI to Comment
│   ├── 💡 Clarify
│   ├── 🔍 Go Deeper
│   └── 💬 Custom...
├── Ask AI Interactively
│   ├── 💡 Clarify
│   ├── 🔍 Go Deeper
│   └── 💬 Custom...
└── Ask AI in Background (NEW)
    ├── 💡 Clarify
    ├── 🔍 Go Deeper
    └── 💬 Custom...
```

**Rationale:** Consistent with existing pattern, minimal menu nesting, discoverable.

---

## Work Plan

- [ ] **1. Update Context Menu Builder**
  - File: `src/shortcuts/shared/webview/context-menu-builder.ts`
  - Add third call to `buildAIMenuItemHTML(aiMenuConfig, 'background', mergedConfig)` in `buildContextMenuHTML()`
  - Update `buildAIMenuItemHTML()` to handle 'background' mode (icon: ⏳, label: "Ask AI in Background")
  - Add `backgroundCommands` support in `getAIMenuConfig()` (default to same commands as others)

- [ ] **2. Update Context Menu Types**
  - File: `src/shortcuts/shared/webview/context-menu-types.ts`
  - Add `backgroundCommands` to `SerializedAIMenuConfig` interface

- [ ] **3. Add Background Handler in Review Editor Provider**
  - File: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
  - Create `handleAskAIBackground(context: AskAIContext, filePath: string)` method
  - Build prompt similar to `handleAskAIInteractive()`
  - Use `CopilotSDKService.sendMessage()` with `usePool: true`
  - Register process with `AIProcessManager`
  - Show notification with completion actions

- [ ] **4. Update Message Handler Switch**
  - File: `src/shortcuts/markdown-comments/review-editor-view-provider.ts`
  - Add routing for `context.mode === 'background'` in `askAI` case
  - OR add new `askAIBackground` message type alongside `askAI` and `askAIInteractive`

- [ ] **5. Update Webview DOM Handlers**
  - Ensure webview sends correct message when background mode items are clicked
  - Update `dom-handlers.ts` or equivalent to handle `data-mode="background"`

- [ ] **6. Implement Result Options Notification**
  - After background completion, show VS Code notification:
    - "Add as Comment" - call existing comment-adding logic
    - "Copy to Clipboard" - copy result text
    - "View Output" - open AI Process detail view

- [ ] **7. Add Tests**
  - Unit test for `handleAskAIBackground()` method
  - Test AIProcessManager integration
  - Test notification action handlers

---

## Implementation Details

### 4.1 New Handler Method
```typescript
// In review-editor-view-provider.ts
private async handleAskAIBackground(context: AskAIContext, filePath: string): Promise<void> {
    const workspaceRoot = getWorkspaceRoot() || '';
    
    // Build prompt (reuse logic from handleAskAIInteractive)
    const promptParts: string[] = [];
    
    // Read prompt file or skill content if specified
    let promptFileContent: string | undefined;
    if (context.promptFilePath) {
        promptFileContent = await this.readPromptFile(context.promptFilePath);
    } else if (context.skillName) {
        promptFileContent = await this.readSkillPrompt(context.skillName);
    }
    
    if (promptFileContent) {
        promptParts.push('--- Instructions from template ---');
        promptParts.push(promptFileContent);
        promptParts.push('');
        promptParts.push('--- Document context ---');
    }
    
    promptParts.push(`File: ${filePath}`);
    if (context.nearestHeading) {
        promptParts.push(`Section: ${context.nearestHeading}`);
    }
    promptParts.push(`Lines: ${context.startLine}-${context.endLine}`);
    promptParts.push('');
    promptParts.push('Selected text:');
    promptParts.push('```');
    promptParts.push(context.selectedText);
    promptParts.push('```');
    
    if (context.customInstruction) {
        promptParts.push('');
        promptParts.push(`Instruction: ${context.customInstruction}`);
    } else if (!promptFileContent) {
        const instructionMap: Record<string, string> = {
            'clarify': 'Please clarify and explain the selected text.',
            'go-deeper': 'Please provide a deep analysis of the selected text.',
            'custom': 'Please help me understand the selected text.'
        };
        promptParts.push(instructionMap[context.instructionType] || instructionMap['clarify']);
    }
    
    const prompt = promptParts.join('\n');
    
    // Get SDK service
    const sdkService = getCopilotSDKService();
    if (!sdkService.isAvailable()) {
        vscode.window.showErrorMessage('Copilot SDK not available');
        return;
    }
    
    // Register with AIProcessManager
    const processId = this.aiProcessManager?.registerProcess({
        prompt,
        type: 'ai-clarification-background',
        metadata: {
            filePath,
            selectionRange: { start: context.startLine, end: context.endLine },
            instructionType: context.instructionType
        }
    });
    
    vscode.window.showInformationMessage(
        'AI request started in background. Track progress in AI Processes panel.'
    );
    
    // Determine working directory
    const srcPath = path.join(workspaceRoot, 'src');
    const workingDirectory = await this.directoryExists(srcPath) ? srcPath : workspaceRoot;
    
    try {
        const result = await sdkService.sendMessage({
            prompt,
            workingDirectory,
            usePool: true,
            onPermissionRequest: approveAllPermissions
        });
        
        if (processId) {
            this.aiProcessManager?.completeProcess(processId, result.text);
        }
        
        // Show completion notification with actions
        const action = await vscode.window.showInformationMessage(
            'AI response ready!',
            'Add as Comment',
            'Copy to Clipboard',
            'View Output'
        );
        
        if (action === 'Add as Comment') {
            const labelMap: Record<string, string> = {
                'clarify': '🤖 **AI Clarification:**',
                'go-deeper': '🔍 **AI Deep Analysis:**',
                'custom': '🤖 **AI Response:**'
            };
            const label = labelMap[context.instructionType] || '🤖 **AI Response:**';
            
            await this.commentsManager.addComment(
                filePath,
                {
                    startLine: context.startLine,
                    startColumn: 1,
                    endLine: context.endLine,
                    endColumn: context.selectedText.length + 1
                },
                context.selectedText,
                `${label}\n\n${result.text}`,
                'AI Assistant',
                undefined,
                undefined,
                'ai-clarification'
            );
        } else if (action === 'Copy to Clipboard') {
            await vscode.env.clipboard.writeText(result.text);
        } else if (action === 'View Output' && processId) {
            vscode.commands.executeCommand('shortcuts.viewAIProcess', processId);
        }
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (processId) {
            this.aiProcessManager?.failProcess(processId, errorMsg);
        }
        vscode.window.showErrorMessage(`Background AI request failed: ${errorMsg}`);
    }
}
```

### 4.2 Context Menu Builder Update
```typescript
// In buildContextMenuHTML() - add after the two existing AI menu items:
parts.push(buildAIMenuItemHTML(aiMenuConfig, 'background', mergedConfig));

// Update buildAIMenuItemHTML() to handle background mode:
const itemId = mode === 'interactive' 
    ? 'contextMenuAskAIInteractive' 
    : mode === 'background'
        ? 'contextMenuAskAIBackground'
        : 'contextMenuAskAIComment';
const submenuId = mode === 'interactive' 
    ? 'askAIInteractiveSubmenu' 
    : mode === 'background'
        ? 'askAIBackgroundSubmenu'
        : 'askAICommentSubmenu';
const label = mode === 'interactive' 
    ? 'Ask AI Interactively' 
    : mode === 'background'
        ? 'Ask AI in Background'
        : 'Ask AI to Comment';
const icon = mode === 'interactive' ? '🤖' : mode === 'background' ? '⏳' : '💬';
```

### 4.3 Message Handler Update
```typescript
// In resolveCustomTextEditor() message switch:
case 'askAI':
    if (message.context) {
        if (message.context.mode === 'background') {
            await this.handleAskAIBackground(message.context, relativePath);
        } else {
            await this.handleAskAI(message.context, relativePath);
        }
    }
    break;

case 'askAIInteractive':
    if (message.context) {
        await this.handleAskAIInteractive(message.context, relativePath);
    }
    break;
```

---

## Testing Plan

1. **Unit Tests**
   - `handleAskAIBackground()` registers process with AIProcessManager
   - Completion notification shows correct action buttons
   - "Add as Comment" action correctly inserts AI comment
   - Error handling properly marks process as failed

2. **Integration Tests**
   - Full flow: select text → AI Action → Go Deeper → Run in Background
   - Verify process appears in AI Processes panel with correct status
   - Verify result can be added as comment after completion

3. **Manual Testing**
   - Test with all AI commands (Clarify, Go Deeper, Custom)
   - Test with prompt files and skills
   - Test cancellation behavior
   - Verify notification actions work correctly

---

## Summary

This plan adds a "Run in Background" option to AI Actions in the Markdown Review Editor. The implementation:
- Leverages existing `AICommandMode = 'background'` type (already defined)
- Uses `CopilotSDKService.sendMessage()` for async execution (proven pattern)
- Tracks progress via `AIProcessManager` (existing infrastructure)
- Provides post-completion actions (Add as Comment, Copy, View)
- Follows existing patterns for minimal code changes

All core infrastructure exists; main work is wiring up the new menu option and handler method.
