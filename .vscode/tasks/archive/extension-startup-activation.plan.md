# Extension Startup Activation

## Description

Enable the VS Code extension to automatically activate when VS Code starts, eliminating the need to manually navigate to the plugin's panel to trigger activation.

Currently, the extension only activates when the user interacts with the extension's views or commands. This requires users to click into the plugin's panel before the extension becomes active, which is inconvenient for users who want immediate access to the extension's features.

## Acceptance Criteria

- [x] Extension activates automatically when VS Code starts
- [x] No user interaction required to activate the extension
- [x] Extension startup does not noticeably delay VS Code window load time
- [x] All existing functionality continues to work correctly
- [x] Existing activation events remain functional (for backward compatibility)

## Subtasks

- [x] **Review current activation events** in `package.json`
- [x] **Add `onStartupFinished` activation event** to the `activationEvents` array
  - This is the recommended approach as it activates after VS Code finishes starting
  - Does not impact initial window load performance
- [x] **Test activation behavior**
  - Verify extension activates without user interaction
  - Verify all views and commands work correctly
  - Verify no startup performance regression
- [ ] **Update CHANGELOG.md** with the new behavior

## Implementation Options

### Option A: `onStartupFinished` (Recommended)

Add `"onStartupFinished"` to the existing activation events array:

```json
"activationEvents": [
    "onStartupFinished",
    ...existing events...
]
```

**Pros:**
- Activates after VS Code has finished starting
- No impact on VS Code startup performance
- Existing events remain as fallback

### Option B: Wildcard `*`

Replace the entire array with the wildcard:

```json
"activationEvents": ["*"]
```

**Pros:**
- Simpler configuration
- Activates immediately

**Cons:**
- May slightly delay VS Code startup
- Less precise than `onStartupFinished`

## Notes

- **Recommendation**: Use `onStartupFinished` as it provides the best balance between immediate activation and startup performance
- The existing `onView` and `onCommand` events can remain in place; they become redundant but don't cause any issues
- This change should be tested on different platforms (macOS, Windows, Linux) to ensure consistent behavior
- Consider documenting this behavior change in the extension's README if users expect manual activation
