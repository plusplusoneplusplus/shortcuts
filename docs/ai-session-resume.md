# AI Session Resume Feature

**Version:** 1.0  
**Created:** 2026-01-24  
**Status:** Draft

---

## Overview

This feature enables users to resume completed Copilot SDK AI sessions in interactive mode, allowing continuation of previous AI conversations through the AI Processes panel. This provides a more natural multi-turn interaction experience without losing conversation history.

## Problem Statement

### Current Limitation

The current AI service creates **one-shot sessions**: users send a prompt, receive a response, and the session terminates. To ask follow-up questions, users must:
1. Start a completely new session
2. Manually re-establish context from scratch
3. Lose the conversation history

### Proposed Solution

Enable users to **resume completed AI sessions** through:
- Storing session IDs with persisted process metadata
- Adding "Resume Session..." context menu action
- Using Copilot CLI to resume the session interactively (SDK does not support interactive resume)
- Launching interactive session in external terminal
- Graceful degradation when sessions expire

### Out of Scope

- Resuming sessions from clipboard or copilot-cli backends (**SDK only**)
- Resuming failed or cancelled sessions
- Web-based interactive UI (uses external terminal only)
- Cross-workspace session sharing

---

## User Experience

### Entry Points

**Primary: Context Menu (Right-click)**
- **Location:** AI Processes tree view in the sidebar
- **Menu Item:** "Resume Session..."
- **Visibility:** Only when process has session ID, completed successfully, and used copilot-sdk backend
- **Position:** Between "Copy Result" and "Remove"

**Secondary: Inline Action Icon**
- **Location:** Hover actions on process tree items
- **Icon:** `$(debug-continue)` or `$(comment-discussion)`
- **Tooltip:** "Resume this session in interactive mode"

### User Flow

```
1. User right-clicks completed AI process in tree view
   ↓
2. Selects "Resume Session..." from context menu
   ↓
3. System validates session is resumable (has ID, completed, SDK backend)
   ↓
4. External terminal opens with restored conversation
   ↓
5. User can continue the conversation with follow-up questions
```

### Prerequisites

- User has previously run an AI request using the `copilot-sdk` backend
- The session completed successfully with a result
- Session has not expired server-side

---

## Technical Architecture

### Current Architecture

**Session Management Flow:**
```
User Request → CopilotSDKService.sendMessage()
              ↓
         createSession() → New SDK Session
              ↓
         sendAndWait(prompt) → AI Response
              ↓
         session.destroy() → Session Terminated
```

**Key Files:**
- `copilot-sdk-service.ts` - SDK wrapper, session creation
- `session-pool.ts` - Session pooling for parallel requests
- `ai-process-manager.ts` - Process tracking and persistence

**Current Limitations:**
1. Sessions destroyed immediately after completion
2. Session IDs stored in memory but NOT persisted
3. No mechanism to reuse/resume existing session IDs

### Architecture Changes

#### 1. Persist Session IDs

Add session metadata to `SerializedAIProcess`:
- `sdkSessionId?: string` - Store SDK session identifier
- `backend?: AIBackendType` - Track which backend was used
- `workingDirectory?: string` - Store CWD for context consistency

**Functions:**
- `serializeProcess()` - Include session metadata
- `deserializeProcess()` - Restore session metadata

#### 2. SDK Session Resume Support

Add session resume capability via SDK or CLI:

**CopilotSDKService Functions:**
- `resumeSession()` - Resume existing SDK session in interactive mode

**ExternalTerminalLauncher Functions:**
- Support `resumeSessionId` option for CLI-based fallback

**InteractiveSessionManager Functions:**
- Support creating sessions from existing SDK sessions

#### 3. Resume Command & UI

**New Command:** `shortcuts.aiProcess.resumeSession`

**Validation Logic:**
- `validateResumable()` - Check if process can be resumed
  - Has session ID
  - Status is completed
  - Backend is copilot-sdk
  - SDK is available

**Resume Logic:**
- Try SDK-based resume first
- Fallback to CLI-based resume (`--resume=<sessionId>`) if SDK doesn't support
- Handle session expiry gracefully

**Tree Item Enhancement:**
- Update `contextValue` for resumable processes
- Add visual indicators (optional icon badge)
- Enhanced tooltips showing "This session can be resumed"

### Data Flow

#### Resume Flow

```
1. User right-clicks completed process → "Resume Session..."
   ↓
2. Command handler validates resumability
   - Has sessionId? ✓
   - Status = completed? ✓
   - Backend = copilot-sdk? ✓
   ↓
3. Extract session metadata (sessionId, workingDirectory, model)
   ↓
4. Copilot CLI resumes the session using --resume flag
   ↓
5. Launch external terminal with restored session
   ↓
6. User sees conversation and can continue
```

---

## Error Handling

### Session Expiry

**Detection:** SDK/CLI returns error indicating session not found or expired

**Fallback Strategy:**
- Prompt user: "Session has expired. Would you like to start a new session with the original prompt?"
- Options: "Start New Session" or "Cancel"
- If "Start New Session", launch new interactive session with original prompt

### Session ID Missing

**When:** Process was created before this feature, or non-SDK backend

**Behavior:** Context menu item not shown (graceful degradation)

### Terminal Launch Failure

**Handling:**
- Show error message: "Could not open terminal: [reason]"
- Offer "Open Settings" button to configure terminal preferences

### SDK Not Available

**Detection:** Check SDK availability before showing resume option

**Handling:**
- Context menu item not shown
- If attempted, show error: "Copilot SDK is not available. Please ensure @github/copilot-sdk is installed."

---

## Configuration

### Settings

**No New Settings Required** - Session IDs are automatically persisted for all SDK-based processes.

**Respects Existing Settings:**
- `workspaceShortcuts.aiService.preferredTerminal` - Which terminal to open
- `workspaceShortcuts.aiService.backend` - Must be 'copilot-sdk' for resume
- `workspaceShortcuts.aiService.defaultWorkingDirectory` - Fallback CWD

### Design Philosophy

Keep it simple - no opt-out, no retention limits, no configuration overhead.

---

## UI/UX Details

### Visual Design

**Icons:**
- Resume action (inline): `$(debug-continue)` or `$(comment-discussion)`
- Resumable indicator (badge): `$(history)` or `$(sync)`

**Tree View:**
- Standard process: `[checkmark] Clarify: handleUserAuth...`
- Resumable process: `[checkmark] Clarify: handleUserAuth...  [>]`
  - Inline resume action appears on hover

**Tooltip Enhancement:**
```
Clarification: handleUserAuth...
Status: Completed
Started: 10:30 AM
Duration: 2.3s
---
This session can be resumed
```

### Notifications

| Type | When | Message | Actions |
|------|------|---------|---------|
| Success | Terminal opens | None (terminal focus is feedback) | - |
| Info | Session expired | "Session has expired. Would you like to start a new session?" | Start New, Cancel |
| Error | Terminal fails | "Could not open terminal: [reason]" | Open Settings, Dismiss |
| Hint (one-time) | First resumable session | "Tip: You can resume AI conversations via right-click menu" | Don't show again, OK |

### Discoverability

**Passive Discovery:**
1. Context menu appears when right-clicking completed processes
2. Inline icon provides visual hint on hover
3. Tooltip indicates "This session can be resumed"

**Active Discovery (One-time):**
After first resumable session completes, show tip notification with option to dismiss permanently.

---

## Implementation Plan

### Phase 1: Foundation (Core Changes)
- Add `sdkSessionId`, `backend`, `workingDirectory` to `SerializedAIProcess`
- Update serialization/deserialization functions
- Add backend tracking to all process registration
- Write tests for persistence

### Phase 2: Session Resume Integration
- Investigate Copilot SDK `resumeSession()` API
- Add `resumeSession()` method to `CopilotSDKService`
- Add CLI `--resume` flag support as fallback
- Update `InteractiveSessionManager` for existing SDK sessions
- Write tests for resume methods

### Phase 3: Command & UI
- Create `validateResumable()` helper function
- Implement `resumeSession()` command logic
- Register `shortcuts.aiProcess.resumeSession` command
- Add context menu item with conditional visibility
- Update tree item context values
- Add optional inline action icon

### Phase 4: Error Handling & Polish
- Implement session expiry detection and fallback
- Add terminal launch failure handling
- Add SDK availability check
- Add first-time discovery notification
- Update settings schema

### Phase 5: Testing & Documentation
- Write unit tests for validation logic
- Write integration tests for resume flow
- Test session expiry scenarios
- Test cross-platform terminal launching
- Update CLAUDE.md, README.md
- Create user-facing documentation

---

## Testing Strategy

### Unit Tests

**Test File:** `ai-session-resume.test.ts`

**Test Coverage:**
- Serialization includes session metadata
- Deserialization restores session metadata
- `validateResumable()` correctly identifies resumable processes
- `validateResumable()` rejects non-SDK backends
- `validateResumable()` rejects failed/cancelled processes
- `validateResumable()` rejects processes without session IDs

### Integration Tests

**Scenarios:**
1. Complete AI process → Session ID persisted → Reload extension → Session ID restored
2. Resume session via SDK → Success
3. Resume session via CLI fallback → Terminal opens with `--resume` flag
4. Resume expired session → Fallback to new session with original prompt
5. Resume non-SDK process → Context menu item not shown

### Manual Testing

**Platforms:**
- macOS (Terminal.app, iTerm)
- Windows (Windows Terminal, PowerShell)
- Linux (gnome-terminal, konsole)

**Scenarios:**
- Resume recent session (< 1 hour old)
- Resume with different terminal preference
- Resume when SDK not available
- Resume when terminal launch fails

---

## Open Questions

### Q1: Does Copilot SDK support session resume?

**Status:** Requires investigation

**CLI Discovery:** ✅ Copilot CLI supports `--resume=<session-id>` flag (verified)

**Investigation Plan:**
1. Review @github/copilot-sdk documentation for session APIs
2. Check if `ICopilotClient` has `resumeSession()` methods
3. Test session persistence across client instances

**Implementation Approaches:**
- **Option A (Preferred):** Use SDK to resume programmatically (better control)
- **Option B (Fallback):** Use CLI `--resume=<sessionId>` flag (already proven)

**Recommendation:** Investigate SDK first, fallback to CLI if needed

### Q2: How long are SDK sessions valid server-side?

**Impact:** Determines when to show expiry fallback

**Preliminary:** Assume 24-48 hours, let SDK handle expiry gracefully

### Q3: Can sessions be resumed multiple times?

**Impact:** UI should indicate if session is "used up" after one resume

**Fallback:** Track "resumed" flag on processes if needed

### Q4: Should we enforce same model when resuming?

**Current:** Resume uses default model or user's preference

**Recommendation:** Store model but allow override

### Q5: Should working directory be editable before resume?

**Current:** Uses stored working directory from original session

**Recommendation:** Use stored CWD for consistency

---

## Future Enhancements

### In-Panel Interactive Mode
Embed terminal in VS Code panel instead of external terminal for better integration.

**Timeline:** Post-MVP (6+ months)

### Session Management UI
Dedicated view for managing active/resumable sessions with features like:
- List all resumable sessions
- Preview last N messages
- Rename/favorite sessions
- Manual session expiry

**Timeline:** Post-MVP (3-6 months)

### Session Sharing
Export/import session IDs for team collaboration.

**Timeline:** Future consideration (12+ months)

### Automatic Session Chaining
Automatically resume last session when user triggers new AI request.

**Timeline:** Post-MVP (3+ months)

---

## Success Criteria

### Feature Adoption
- **Metric:** % of SDK users who resume at least one session
- **Target:** > 20% within first month

### Resume Success Rate
- **Metric:** Successful vs failed resume attempts
- **Target:** > 90% for non-expired sessions

### Error Recovery
- **Metric:** % of expired sessions that successfully fall back
- **Target:** > 80%

---

## Security & Privacy

### Session ID Security

**Risk:** Session IDs stored in workspace state (not encrypted)

**Mitigation:**
- Session IDs scoped to user's Copilot account (authenticated)
- Workspace state is local to machine
- VSCode handles Memento API security
- Session IDs not sensitive - require authentication to use

### Prompt History

**Note:** Full prompts already persisted (existing behavior). Session resume doesn't increase exposure.

---

## Dependencies

### External Dependencies
- **@github/copilot-sdk:** May support session resume (to be investigated)
- **Copilot CLI:** ✅ Confirmed supports `--resume=<session-id>` flag
- **VS Code API:** Memento API (existing)

### Internal Dependencies
- **AI Process Manager:** Must be initialized before resume
- **Terminal Launcher:** Must support platform-specific terminals
- **Configuration Manager:** Must provide settings access

### Version Requirements
- **VS Code:** >= 1.74.0 (existing minimum)
- **@github/copilot-sdk:** >= 1.0.0 (verify exact version)

---

## Documentation Updates

### CLAUDE.md
Add section: "AI Service → Resuming AI Sessions"
- How to resume sessions
- Requirements
- Note about automatic persistence

### README.md
Add feature bullet: "Resume AI Sessions: Continue completed Copilot conversations in interactive mode"

### CHANGELOG.md
```markdown
### Added
- Session resume capability for Copilot SDK sessions
  - Automatically store session IDs with completed processes
  - Resume sessions via "Resume Session..." context menu
  - Graceful fallback when sessions expire
```

---

## Related Files

**Core:**
- `src/shortcuts/ai-service/types.ts`
- `src/shortcuts/ai-service/ai-process-manager.ts`
- `src/shortcuts/ai-service/copilot-sdk-service.ts`
- `src/shortcuts/ai-service/session-pool.ts`

**Interactive:**
- `src/shortcuts/ai-service/interactive-session-manager.ts`
- `src/shortcuts/ai-service/external-terminal-launcher.ts`
- `src/shortcuts/ai-service/cli-utils.ts`

**UI:**
- `src/shortcuts/ai-service/ai-process-tree-provider.ts`
- `src/shortcuts/commands.ts`
- `package.json`

**Tests:**
- `src/test/suite/ai-session-resume.test.ts` (new)
- `src/test/suite/copilot-sdk-service.test.ts` (update)

---

**Document Status:** Draft - Ready for review  
**Next Steps:** Review with team, validate Copilot SDK resume support, begin Phase 1 implementation
