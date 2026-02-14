---
status: done
---

# Integration Testing and Polish

Manual integration testing of the Queue AI Job feature end-to-end.

## Test Cases

1. **Prompt mode E2E**: Click "+" → type prompt → select model/priority → Queue → verify in tree → execute → see result
2. **Skill mode E2E**: Click "+" → select skill → add context → Queue → verify in tree → execute → see result
3. **Priority ordering**: Queue multiple jobs with different priorities → verify order in tree
4. **Dialog cancellation**: Open dialog → Cancel → verify nothing queued
5. **Queue cancellation**: Queue a job → cancel from tree → verify cancelled state
6. **Tree view updates**: Verify "Queued Tasks (N)" count updates correctly
7. **SDK fallback**: Test with SDK unavailable → verify graceful fallback behavior
8. **Empty state**: No skills found → verify Skill tab handles gracefully
9. **Validation**: Try to submit empty prompt → verify error shown

## Dependencies

- Depends on all other tasks being complete
