# AI Processes Panel: Show “Queued / Pending” Tasks

## Description
The AI Processes panel currently shows running and completed AI processes, but it does not clearly represent work that is **pending in the queue** (i.e., scheduled but not yet started). This task adds a first-class “Queued / Pending” representation so users can understand when requests are waiting for capacity and why nothing appears to be happening.

The change should make queued state visible, consistent with existing process lifecycle states, and should not regress existing running/completed/failed behavior.

## Acceptance Criteria
- **Queued items are visible** in the AI Processes panel when there are AI requests pending execution.
- A queued item is **distinct from running and completed** items (label, icon, and/or status text).
- Queued items display at least:
  - Process/request name (or best available identifier)
  - Status text (e.g., `Queued` / `Pending`)
  - Timestamp or relative time (if already available for other states)
- When a queued item transitions to running, the UI **updates automatically** (no manual refresh required beyond existing refresh mechanisms).
- The “clear / remove” actions behave correctly for queued items:
  - Removing a queued item removes it from the panel (and cancels if cancellation is supported).
  - “Clear all” clears queued items as well (or explicitly documents exclusions if any).
- Sorting/grouping remains sensible (e.g., queued items grouped together or ordered near running items).
- No regression in existing AI Processes behaviors (running, completed, failed, cancelled, restored-on-restart).
- Tests are updated/added to cover queued visibility and transitions.

## Subtasks
1. **Define the queued state**
   - Identify where “pending in queue” exists today (in-memory queue, session pool backlog, persisted state, etc.).
   - Decide naming: `queued` vs `pending` (align with existing terminology).

2. **Model/state updates**
   - Extend the AI process model to represent queued state explicitly.
   - Ensure persistence format (if any) can store this state without breaking backward compatibility.

3. **Tree data provider changes (AI Processes panel)**
   - Update the provider to include queued items.
   - Decide display rules (group header, sorting, and whether queued appear under a “Queued” parent).
   - Add a distinct icon or description text.

4. **Lifecycle & refresh**
   - Ensure queued → running → completed transitions trigger a refresh.
   - Validate behavior on extension restart (restored queued items, if applicable).

5. **Commands/actions**
   - Confirm existing commands (remove/clear/show details) work for queued.
   - Add/correct cancellation behavior if queued cancellation is supported.

6. **Test coverage**
   - Add/extend unit tests for:
     - queued items appear
     - queued → running transition updates UI
     - remove/clear behavior for queued
   - Ensure tests pass across platforms.

## Notes
- Clarify what “pending in the queue” means in this extension context:
  - Waiting for a Copilot session
  - Waiting for concurrency limits
  - Waiting on permission/approval flow
- If multiple queues exist (e.g., session pool + map-reduce executor), ensure the panel’s queued state reflects the user-visible bottleneck.
- Prefer minimal UI changes that align with existing tree item patterns and base tree provider behaviors.
