# Deep Wiki: Conversation Persistence

## Problem

Conversations in deep-wiki's serve mode are entirely in-memory. Server-side sessions live in a `Map` and expire after 10 minutes. Client-side history is a JS variable lost on page refresh. Users lose all conversation context when they restart the server or reload the page.

## Approach

Add file-based conversation persistence using JSON files in the wiki output directory (`.wiki/conversations/`), following the existing cache patterns in `packages/deep-wiki/src/cache/`. The system will:

- Auto-save conversations after each AI response
- Store messages + context metadata (referenced modules)
- Start with empty chat by default, with a history panel to browse/restore past conversations
- Keep the last 20 conversations, auto-deleting older ones
- Reuse atomic write patterns from `cache-utils.ts`

## Storage Format

```
.wiki/
├── conversations/
│   ├── index.json          # List of conversations (metadata only)
│   └── {id}.json           # Individual conversation files
```

**index.json**: `{ conversations: [{ id, title, createdAt, updatedAt, messageCount, moduleIds }] }`

**{id}.json**: `{ id, title, messages: [{ role, content, timestamp, moduleIds? }], createdAt, updatedAt }`

## Todos

### 1. conversation-store — Create ConversationStore module
**File**: `packages/deep-wiki/src/server/conversation-store.ts`

Create a file-based conversation store with:
- Types: `PersistedConversation`, `ConversationMessage` (extended with timestamp + moduleIds), `ConversationIndex`
- `ConversationStore` class:
  - Constructor takes `wikiDir` path, creates `conversations/` subdir
  - `save(conversation)` — atomic write individual conversation JSON + update index
  - `list()` — return index (metadata only, no messages)
  - `load(id)` — read full conversation by ID
  - `delete(id)` — remove conversation file + update index
  - `cleanup()` — enforce 20-conversation limit, delete oldest
- Uses `writeCacheFile` / `readCacheFile` patterns from cache-utils for atomic writes
- Auto-generates title from first user message (first 60 chars)

### 2. api-endpoints — Add conversation history API endpoints
**File**: `packages/deep-wiki/src/server/api-handlers.ts`

Add new REST endpoints:
- `GET /api/conversations` — list all conversations (metadata)
- `GET /api/conversations/:id` — load full conversation
- `DELETE /api/conversations/:id` — delete a conversation
- `DELETE /api/conversations` — clear all conversations

### 3. ask-handler-integration — Integrate auto-save into ask flow
**Files**: `packages/deep-wiki/src/server/ask-handler.ts`, `api-handlers.ts`

- Pass `ConversationStore` into `AskHandlerOptions`
- After each successful AI response (`done` event), save/update the conversation
- Include `moduleIds` from context retrieval in the saved message
- Track `conversationId` alongside `sessionId` (return in SSE `done` event)

### 4. server-init — Wire ConversationStore into server startup
**Files**: `packages/deep-wiki/src/server/index.ts`

- Create `ConversationStore` instance during server init
- Pass it to API handlers and ask handler options
- Run `cleanup()` on startup to enforce retention limit

### 5. spa-history-panel — Add conversation history UI panel
**File**: `packages/deep-wiki/src/server/spa-template.ts`

Client-side changes:
- Add a "History" button/icon next to "Clear" in the ask widget header
- History panel shows list of past conversations (title, date, message count)
- Click a conversation to restore it: fetch full conversation, populate `conversationHistory` and DOM
- Track `currentConversationId` alongside `currentSessionId`
- On restore, do NOT restore the server-side SDK session (start fresh session but with history context)
- Delete button per conversation in history panel
- Auto-save: after receiving `done` SSE event with `conversationId`, update local tracking

### 6. tests — Add tests for ConversationStore
**File**: `packages/deep-wiki/test/server/conversation-store.test.ts`

Test cases:
- Save and load a conversation
- List returns metadata without messages
- Delete removes file and updates index
- Cleanup enforces 20-conversation limit
- Concurrent writes don't corrupt index
- Handle missing/corrupt files gracefully
- Title auto-generation from first message

### 7. api-tests — Add tests for conversation API endpoints
**File**: `packages/deep-wiki/test/server/api-handlers-conversations.test.ts`

Test cases:
- GET /api/conversations returns list
- GET /api/conversations/:id returns full conversation
- DELETE /api/conversations/:id removes conversation
- 404 for non-existent conversation
- Auto-save integration with ask flow

## Notes

- The SDK session (server-side `ConversationSessionManager`) is NOT persisted — it's ephemeral and tied to the Copilot SDK connection. When restoring a conversation, messages are replayed as context in the prompt (legacy mode with `conversationHistory`).
- `conversationId` is separate from `sessionId` — a restored conversation gets a new session.
- The first user message is used as the conversation title (truncated to 60 chars).
- Retention: 20 conversations max, oldest deleted first based on `updatedAt`.
