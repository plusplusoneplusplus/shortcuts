# AI Task Creation Modes: Simple vs Deep

## Overview

AI task creation supports two entry points with different behaviors:

1. **Tasks Panel (Direct Creation)**: Always uses **Simple** mode - no change to current behavior
2. **Right-Click on Feature**: Provides mode selection with two options:
   - **Simple**: Quick, single-pass AI analysis (current behavior)
   - **Deep**: Multi-phase research using the `go-deep` skill for comprehensive analysis

## Requirements

1. Tasks panel direct creation remains unchanged (Simple mode only)
2. Right-click on feature entry point adds mode selection UI
3. "Simple" mode uses existing single-pass AI processing
4. "Deep" mode invokes the `go-deep` skill when available
5. Graceful fallback if `go-deep` skill is unavailable

## Implementation Plan

- [x] Identify the entry point for right-click on feature context menu
- [x] Add mode selection UI (dropdown or quick pick with "Simple" / "Deep" options) for feature right-click entry point
- [x] Keep Tasks panel direct creation unchanged (Simple mode only)
- [x] Implement simple mode (preserve current behavior)
- [x] Implement deep mode integration with `go-deep` skill
- [x] Add skill availability check before offering "Deep" option
- [x] Handle fallback when skill is unavailable
- [x] Update UI to show which mode is being used during execution
- [x] Add tests for both entry points and modes

## Technical Notes

### go-deep Skill Integration

The `go-deep` skill is defined in the project and provides:
- Advanced research and verification methodologies
- Multi-phase approaches
- Parallel sub-agents for deep research

### Skill Invocation

Using skill `go-deep` when available. The only difference between Simple and Deep modes is in the prompt construction.

## Design Decisions Made

- **Mode Selection Placement**: QuickPick appears after focus input to maintain natural flow
- **Default Behavior**: When only Simple is available (no go-deep skill), mode selection is skipped entirely
- **Fallback**: Deep mode gracefully falls back to built-in guidance if skill loading fails
- **Progress Display**: Shows mode name in both title and progress message
