# Update skill-based action for Follow Prompt consistency

## Description
Commit `8fb0a3a21b6b482139133bc7c212f6cc6c630486` adjusted the **queued** “Follow Prompt” behavior to match the **interactive** flow.

We need to confirm whether the **skill-based action path** (i.e., the execution path that invokes a specific Skill/tool-driven action rather than a plain prompt) should be updated as well, so that:
- queued vs interactive behavior remains consistent, and
- skill-based vs non-skill flows behave predictably (same prompt shaping, same defaults, same UX expectations).

This task is to audit the current behavior, decide the intended behavior, implement the smallest safe change, and add/adjust tests.

## Acceptance Criteria
- [x] Identify all code paths that implement “Follow Prompt” for:
  - interactive execution
  - queued execution
  - skill-based action execution (if distinct)
- [x] Document current behavioral differences (inputs, prompt formatting, model/options selection, tool/permission filtering, working directory, etc.).
- [x] Decide and document the expected behavior for skill-based action execution:
  - whether it should match interactive “Follow Prompt” behavior exactly
  - or intentionally differ (and why)
- [x] If updates are required:
  - [x] Implement minimal code changes to align skill-based behavior with the intended spec
  - [x] Ensure queued and interactive remain aligned after the change
- [x] Add/update automated tests covering:
  - [x] skill-based action follow-up behavior
  - [x] queued vs interactive parity for the affected scenarios
- [x] Verify `npm test` (or the relevant existing test suite(s)) passes.

## Subtasks
1. **Locate implementations**
   - Find where “Follow Prompt” is constructed/handled for queued and interactive flows.
   - Find where skill-based actions are dispatched and how follow-up prompts are generated.

2. **Behavior audit**
   - Compare:
     - prompt text shaping / templates
     - session options (model, streaming, timeout)
     - tool filtering / MCP configuration
     - permission handling and defaults
     - working directory selection
     - UI messaging (labels, statuses, tree item text)

3. **Define intended behavior**
   - Decide: should skill-based follow-up use the same prompt pipeline as interactive “Follow Prompt”?
   - Confirm any edge cases:
     - skill requires a strict tool whitelist
     - follow-up should preserve/override tool filtering
     - “queued” execution may require a stricter set of allowed operations

4. **Implement + tests**
   - Apply minimal changes.
   - Add or update tests for the specific regression/parity expectations.

5. **Regression check**
   - Ensure existing “Follow Prompt” flows still work:
     - interactive follow prompt
     - queued follow prompt
     - skill-based action execution

## Notes
- Keep the change scope small: prefer sharing/reusing the same prompt-building function across flows rather than duplicating logic.
- Pay attention to subtle defaults that often diverge between flows:
  - workingDirectory resolution
  - timeoutMs and retry behavior
  - streaming vs non-streaming
  - tool filtering / MCP server loading
- If the skill-based path must remain different, explicitly document the rationale and ensure the UX communicates the difference.
