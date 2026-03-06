# Pause/Resume Button Visibility Issue - Plan

## Problem Statement
The pause/resume button (or control) in the Queue/Processes view appears to be positioned outside the visible area, making it inaccessible to users. Based on the screenshot, the button text/control extends beyond the right edge of the container.

## Current State
- **Location:** Queue view in the Processes/AI Service panel
- **Affected Component:** Pause/Resume button in queue task controls
- **Issue:** Button text appears cut off or extends beyond visible viewport bounds
- **Root Cause:** Likely layout overflow without proper wrapping or scrolling, or insufficient space allocation in the button container

## Proposed Approach
1. **Identify exact location:** Find the HTML/CSS/component rendering the pause/resume button in the Queue view
   - Could be in webview HTML (queue-job-dialog.ts or related)
   - Could be in native VS Code tree view with custom item rendering
   - Could be in a separate processes/queue panel webview

2. **Analyze layout issue:**
   - Check container width constraints
   - Check button text length and wrapping rules
   - Check flexbox/grid layout configuration
   - Identify if this is a responsive design issue

3. **Fix visibility:**
   - Option A: Make button text shorter or use icons only
   - Option B: Adjust container width or padding
   - Option C: Enable text wrapping or ellipsis
   - Option D: Add horizontal scroll if container is constrained
   - Option E: Reorganize layout to give more space to button

4. **Verify across viewport sizes:**
   - Test at minimum window width
   - Test with collapsed/expanded sidebar states
   - Ensure button remains accessible and clickable

## Todos
- [ ] **locate-pause-resume-component** - Find the exact file and component rendering the pause/resume button
- [ ] **analyze-layout** - Understand the container layout, sizing, and CSS rules
- [ ] **identify-fix-option** - Determine the best approach to make button visible (text, layout, or responsiveness change)
- [ ] **implement-fix** - Apply the fix and test visibility
- [ ] **test-responsiveness** - Verify the fix works across different viewport sizes

## Notes
- Pause/Resume commands are registered as: `shortcuts.queue.pauseQueue` and `shortcuts.queue.resumeQueue`
- Queue controls are part of the AI Service panel's queue management system
- The issue appears to be UI/CSS related rather than functional
- Priority: Medium (impacts usability but has workaround via status bar/context menu)
