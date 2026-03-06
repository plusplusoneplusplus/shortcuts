# Chat UI — Model Selector

## Problem

The chat UI in RepoChatTab (used for repo-scoped AI conversations) has no model selector. Users are forced to use the default model and cannot choose a different one. The `EnqueueDialog` already has a working model selector, but the chat-specific UI (new chat start screen and follow-up input area) lacks this capability.

## Proposed Approach

Add a model selector dropdown to both the **new chat start screen** and the **follow-up message area** in `RepoChatTab.tsx`, following the existing pattern from `EnqueueDialog.tsx`.

### Key Design Decisions

1. **New chat**: Add model to the `POST /api/queue` body as `config.model`. The backend already supports this.
2. **Follow-up messages (Option B)**: The SDK session is bound to the model chosen at creation. For now, show the model as **read-only** in the follow-up area so users know which model they're talking to. Mid-conversation model switching can be added later.

### UI Design

- **New chat start screen**: A compact `<select>` dropdown placed inline next to the Start Chat button, matching EnqueueDialog styling. Fetches models from `GET /api/queue/models` on mount, persists via `usePreferences` (`lastModel`), defaults to persisted model or "Default".
- **Follow-up area**: A read-only model label/badge displayed near the Send button showing the model the chat was started with (read from `task.metadata.model` or `task.config.model`).

## Todos

### Frontend (RepoChatTab.tsx)

1. ~~**Add model state and fetch**~~ ✅
2. ~~**Add model selector to start screen**~~ ✅
3. ~~**Pass model in handleStartChat**~~ ✅
4. ~~**Show model label in follow-up area**~~ ✅
5. ~~**Persist model selection**~~ ✅

### Testing

6. ~~**Frontend tests**~~ ✅ — 21 new tests added (213 total, all passing)

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/RepoChatTab.tsx` | Add model state, fetch, selector UI on start screen, read-only model badge in follow-up, pass model in POST body |
| `packages/coc/test/spa/react/` | Add/update tests for model selector |

## Notes

- No backend changes needed — `POST /api/queue` already supports `config.model`, and the model is stored in `process.metadata.model`.
- The model registry and `/api/queue/models` endpoint already work — no changes needed.
- The `usePreferences` hook already handles `lastModel` persistence — reuse directly.
- The EnqueueDialog pattern (fetch → select → persist → submit) is proven and should be followed closely.
- Mid-conversation model switching (Option A) can be added later as an enhancement.
