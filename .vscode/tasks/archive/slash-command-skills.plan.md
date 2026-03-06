# Slash-Command Skill Attachment in Chat

## Problem

The "Chat with this repository" UI (`RepoChatTab.tsx`) has no way to attach skills to a message. Users must use the separate `EnqueueDialog` / `FollowPromptDialog` to invoke skills, and only one skill at a time is supported. We want users to type `/skill-name` directly in the chat textarea with autocomplete suggestions and support for multiple skills per message (e.g., `/go-deep /impl analyze the auth module`).

## Proposed Approach

Add slash-command parsing and an autocomplete popup to the chat textarea. When the user types `/`, a filtered dropdown of available skills appears. Selected skills are kept as `/name` tokens in the text. On submit, tokens are extracted, stripped from the prompt, and sent as `skillNames: string[]` in the payload. The backend is updated to accept and apply multiple skill directives.

---

## Changes

### 1. Slash-command parser utility (new file)

**File:** `packages/coc/src/server/spa/client/react/repos/slash-command-parser.ts`

- `parseSlashCommands(text: string, availableSkills: string[]): { skills: string[], prompt: string }`
  - Scans for all `/word` tokens at word boundaries
  - Validates each against the known skill list (case-insensitive match)
  - Returns matched skill names and the remaining prompt text (with tokens stripped and whitespace normalized)
- `getSlashCommandContext(text: string, cursorPosition: number): { active: boolean, prefix: string, startIndex: number } | null`
  - Determines whether the cursor is currently inside a `/` token
  - Returns the partial prefix for filtering the autocomplete list (e.g., cursor after `/go` → `prefix: "go"`)
- Unit-testable, no React dependency

### 2. Autocomplete dropdown component (new file)

**File:** `packages/coc/src/server/spa/client/react/repos/SlashCommandMenu.tsx`

- React component rendered as an absolutely-positioned dropdown anchored below/above the cursor position in the textarea
- Props: `skills: SkillItem[]`, `filter: string`, `onSelect: (name: string) => void`, `onDismiss: () => void`, `visible: boolean`
- Renders a filtered list of skills showing `⚡ name — description`
- Keyboard navigation: `ArrowUp`/`ArrowDown` to move highlight, `Enter`/`Tab` to select, `Escape` to dismiss
- Dismisses on blur or when the `/` context is lost
- Max height with scroll, highlight on hover

### 3. Custom hook for slash-command state (new file)

**File:** `packages/coc/src/server/spa/client/react/repos/useSlashCommands.ts`

- `useSlashCommands(skills: SkillItem[])`
- Manages:
  - `menuVisible: boolean`
  - `menuFilter: string` (partial text after `/`)
  - `filteredSkills: SkillItem[]`
  - `menuPosition: { top, left }` (computed from textarea caret position)
- Exposes:
  - `handleInputChange(text: string, cursorPos: number)` — updates menu state based on cursor context
  - `handleKeyDown(e: KeyboardEvent)` — intercepts arrow keys and Enter/Tab/Escape when menu is open
  - `selectSkill(name: string)` — inserts `/name ` at the correct position in the text, closes menu
  - `parseAndExtract(text: string)` — delegates to `parseSlashCommands` for submission

### 4. Update `RepoChatTab.tsx`

**What changes:**

- **Fetch skills on mount** — call `GET /api/workspaces/:id/skills` when `workspaceId` is set (same pattern as `EnqueueDialog`). Store as `skills: SkillItem[]` state.
- **Integrate `useSlashCommands` hook** — wire it into both the start-screen textarea and the follow-up textarea.
- **Render `SlashCommandMenu`** — positioned relative to the textarea, controlled by the hook.
- **`handleStartChat`** — before sending, call `parseSlashCommands(inputValue, skillNames)` to extract skills and clean prompt. Add `skillNames` to the `POST /api/queue` body:
  ```ts
  body: JSON.stringify({
    type: 'chat',
    workspaceId,
    prompt: parsedPrompt,        // cleaned text without /tokens
    skillNames: parsedSkills,    // string[]
    displayName: 'Chat',
    ...
  })
  ```
- **`sendFollowUp`** — same extraction before posting to `POST /api/processes/:id/message`. Add `skillNames` to the JSON body.
- **Visual feedback** — render `/skill` tokens with distinct styling (e.g., pill/tag appearance via CSS) in the textarea area. Since native textareas don't support inline rich text, consider one of:
  - (Simpler) Show parsed skill pills as tags above/below the textarea, visually distinct from the prompt text.
  - (Advanced) Use a contentEditable div with styled spans — higher complexity, defer to later iteration.
  
  **Recommendation:** Start with the simpler approach — show skill tags as removable pills above the textarea. The `/name` text remains in the textarea for editing, and the pills are a read-only visual echo.

### 5. Update `ChatPayload` type

**File:** `packages/coc/src/server/task-types.ts`

```ts
export interface ChatPayload {
    readonly kind: 'chat';
    prompt: string;
    skillNames?: string[];   // ← NEW: multiple skills
    workspaceId?: string;
    folderPath?: string;
}
```

Also add `skillNames?: string[]` to the message endpoint body type if one exists, or document the new field in the handler.

### 6. Update `FollowPromptPayload` type (optional, for consistency)

**File:** `packages/coc/src/server/task-types.ts`

Add `skillNames?: string[]` alongside the existing `skillName?: string` for backward compatibility. Existing `skillName` continues to work; `skillNames` takes precedence when present.

### 7. Update `applySkillContent` in queue-executor-bridge

**File:** `packages/coc/src/server/queue-executor-bridge.ts`

```ts
private applySkillContent(prompt: string, task: QueuedTask): string {
    const payload = task.payload as { skillName?: string; skillNames?: string[] };
    const names = payload.skillNames?.length
        ? payload.skillNames
        : payload.skillName
            ? [payload.skillName]
            : [];
    if (names.length === 0) return prompt;
    const directives = names.map(n => `Use ${n} skill when available`).join('\n');
    return `${directives}\n\n[Task]\n${prompt}`;
}
```

### 8. Update message handler for follow-ups

**File:** `packages/coc/src/server/api-handler.ts` (or wherever `POST /processes/:id/message` is handled)

- Accept optional `skillNames: string[]` in the message body
- If present, prepend skill directives to the message content before forwarding to the AI process (same pattern as `applySkillContent`)

### 9. Tests

- **Unit tests for `slash-command-parser.ts`:**
  - Parses single skill: `/impl do something` → `{ skills: ["impl"], prompt: "do something" }`
  - Parses multiple skills: `/go-deep /impl analyze auth` → `{ skills: ["go-deep", "impl"], prompt: "analyze auth" }`
  - Ignores unknown `/tokens`: `/notaskill do something` → `{ skills: [], prompt: "/notaskill do something" }`
  - Handles edge cases: empty input, only slashes, duplicate skills, skills mid-sentence
  - `getSlashCommandContext` returns correct prefix at various cursor positions

- **Unit tests for `applySkillContent` changes:**
  - Single `skillName` backward compat
  - Multiple `skillNames`
  - Empty arrays
  - `skillNames` takes precedence over `skillName`

- **Component tests for `SlashCommandMenu`** (if test infra supports React component tests):
  - Renders filtered skill list
  - Keyboard navigation works
  - Selection callback fires

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Slash prefix (`/`) vs `@` | `/` | Matches the screenshot mockup; familiar from Slack/Discord/GitHub Copilot Chat |
| Skill validation | Only known skills highlighted/autocompleted; unknown `/tokens` left as-is in prompt | Avoids silently swallowing typos; user can still type `/something` as plain text |
| Multiple skills | Array field `skillNames` | Forward-compatible; single `skillName` kept for backward compat |
| Textarea vs contentEditable | Native textarea + skill pills above | Lower complexity; contentEditable is fragile across browsers |
| Autocomplete trigger | Any `/` at a word boundary when preceded by whitespace or at start of input | Prevents false triggers mid-URL or mid-path |

## Out of Scope

- Skill parameters (e.g., `/go-deep --depth=3`) — future enhancement
- Prompt file attachment via slash commands (`/prompt:name`) — separate feature
- Deep-wiki chat (`ask-ai.ts`) integration — separate feature, different architecture
- Slash commands for non-skill actions (e.g., `/clear`, `/model`) — future enhancement
