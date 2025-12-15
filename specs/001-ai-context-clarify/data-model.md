# Data Model: AI Context Clarification Menu

**Feature**: `001-ai-context-clarify`
**Date**: 2025-12-15

## Entities

### ClarificationRequest

Represents a single AI clarification request from the user.

| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `selectedText` | `string` | Text the user highlighted | Required, non-empty |
| `selectionRange` | `SelectionRange` | Line/column position of selection | Required |
| `filePath` | `string` | Path to the document being reviewed | Required |
| `surroundingContent` | `string` | Lines around the selection for context | Optional, max ~4000 chars |
| `headings` | `string[]` | All markdown headings in document | Optional |
| `nearestHeading` | `string \| null` | Closest heading above selection | Optional |

### SelectionRange

Reuses existing pattern from `CommentSelection` in `types.ts`.

| Field | Type | Description |
|-------|------|-------------|
| `startLine` | `number` | 1-based starting line |
| `startColumn` | `number` | 1-based starting column |
| `endLine` | `number` | 1-based ending line |
| `endColumn` | `number` | 1-based ending column |

### AIToolConfiguration

User preference for AI tool routing. Stored in VS Code settings.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `tool` | `'copilot-cli' \| 'clipboard'` | Target AI tool | `'copilot-cli'` |

### DocumentContext (Webview → Extension)

Context data sent from webview to extension when "Ask AI" is triggered.

| Field | Type | Description |
|-------|------|-------------|
| `selectedText` | `string` | The selected text |
| `startLine` | `number` | Selection start line |
| `endLine` | `number` | Selection end line |
| `surroundingLines` | `string` | Context lines around selection |
| `nearestHeading` | `string \| null` | Heading above selection |
| `allHeadings` | `string[]` | Document structure |

## Message Types

### WebviewMessage Extension (in `webview-scripts/types.ts`)

Add to existing `WebviewMessage` union type:

```typescript
| { type: 'askAI'; context: DocumentContext }
```

### Extension Handler (in `review-editor-view-provider.ts`)

New case in `handleWebviewMessage()`:

```typescript
case 'askAI':
    this.handleAskAI(message.context);
    break;
```

## Type Definitions

### New Types (in `src/shortcuts/markdown-comments/types.ts`)

```typescript
/**
 * Document context for AI clarification requests
 */
export interface ClarificationContext {
    /** The selected text to clarify */
    selectedText: string;
    /** Selection line range */
    selectionRange: {
        startLine: number;
        endLine: number;
    };
    /** File being reviewed */
    filePath: string;
    /** Surrounding lines for context */
    surroundingContent: string;
    /** Nearest heading above selection */
    nearestHeading: string | null;
    /** All document headings for structure */
    headings: string[];
}

/**
 * AI tool types for clarification
 */
export type AIToolType = 'copilot-cli' | 'clipboard';

/**
 * Configuration for AI clarification feature
 */
export interface AIClarificationConfig {
    /** Which AI tool to use */
    tool: AIToolType;
}
```

### Settings Schema (in `package.json`)

```json
{
    "workspaceShortcuts.aiClarification.tool": {
        "type": "string",
        "enum": ["copilot-cli", "clipboard"],
        "enumDescriptions": [
            "Send to GitHub Copilot CLI in terminal",
            "Copy prompt to clipboard"
        ],
        "default": "copilot-cli",
        "description": "Target AI tool for clarification requests from the review editor"
    }
}
```

## State Transitions

### User Flow State

```
[No Selection]
    → (user selects text)
    → [Has Selection]
    → (right-click)
    → [Context Menu Open]
    → (click "Ask AI")
    → [Processing]
    → (invoke AI tool)
    → [Complete]
```

### Selection State in Webview

Managed by existing `state.savedSelectionForContextMenu` in `state.ts`:

```typescript
interface SavedSelection {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    selectedText: string;
    range: Range;
    rect: DOMRect;
}
```

## Relationships

```
┌─────────────────┐     sends      ┌──────────────────────┐
│    Webview      │ ─────────────> │   Extension Host     │
│  (dom-handlers) │   askAI msg    │ (view-provider)      │
└─────────────────┘                └──────────────────────┘
        │                                    │
        │ reads                              │ invokes
        ▼                                    ▼
┌─────────────────┐                ┌──────────────────────┐
│  state.ts       │                │ ai-clarification-    │
│ (selection)     │                │ handler.ts           │
└─────────────────┘                └──────────────────────┘
                                             │
                                             │ uses
                                             ▼
                                   ┌──────────────────────┐
                                   │ VS Code Terminal API │
                                   │ or Clipboard API     │
                                   └──────────────────────┘
```

## Validation Rules

1. **Selection Required**: `selectedText` must be non-empty and trimmed
2. **Line Numbers Valid**: `startLine` ≤ `endLine`, both ≥ 1
3. **Prompt Size**: Total prompt must not exceed 8000 characters
4. **Tool Valid**: Must be one of `'copilot-cli'` or `'clipboard'`

## Backwards Compatibility

- No changes to existing data structures
- New message type added to union (non-breaking)
- New settings are additive (existing settings unchanged)
- No database or file format changes
