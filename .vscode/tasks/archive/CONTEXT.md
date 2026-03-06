# Context: Chat Sidebar Status Updates

## User Story
When a chat follow-up is still streaming, the left sidebar panel should show 🔄 (in progress) instead of staying on ✅ (completed). Also, queued items should appear with ⏳.

## Goal
Fix the chat sidebar to reflect real-time session status during follow-up streaming, fix the chatMeta field mapping bug, and ensure queued items display correctly.

## Commit Sequence
1. Fix sidebar status updates and chatMeta mapping (single commit)

## Key Decisions
- Client-side optimistic update for follow-up status (no backend changes needed)
- Backend already returns queued+running+history for chat type — no API changes
- `updateSessionStatus` method on useChatSessions hook for local state mutation
- Refresh from server after completion to get canonical status

## Conventions
- Follow existing React hook patterns in useChatSessions (useCallback, setSessions)
- Keep toSessionItem as a pure mapping function with graceful fallbacks
- Tests in packages/coc/test/spa/react/ matching existing test file structure
