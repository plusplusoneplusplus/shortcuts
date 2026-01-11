# Markdown Comments Module - Developer Reference

This module provides inline commenting capability for markdown files. Users can add annotations and review comments directly within markdown documents using a custom editor.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Custom Editor                         │
│        (Markdown Review Editor - Rich rendering)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Renders
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Markdown Comments Module                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           ReviewEditorViewProvider                          ││
│  │  - Custom editor for markdown with commenting               ││
│  │  - Webview with markdown rendering                          ││
│  │  - Comment panel for inline annotations                     ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ CommentsManager │  │  CommentAnchor  │  │ PromptGenerator │ │
│  │ (CRUD + storage)│  │(Position track) │  │  (AI prompts)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │         MarkdownCommentsTreeDataProvider                    ││
│  │  - Tree view showing all comments by file                   ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Webview Scripts & Logic                        ││
│  │  - Markdown rendering (marked.js)                           ││
│  │  - Code highlighting (highlight.js)                         ││
│  │  - Mermaid diagrams                                         ││
│  │  - Selection handling                                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Storage
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│     .vscode/comments/<hash>.json (per-file comment storage)     │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### ReviewEditorViewProvider

The custom editor provider for markdown files.

```typescript
import { ReviewEditorViewProvider } from '../markdown-comments';

// Register the custom editor
const provider = new ReviewEditorViewProvider(context, commentsManager);
context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
        'shortcuts.markdownReviewEditor',
        provider,
        {
            webviewOptions: { retainContextWhenHidden: true },
            supportsMultipleEditorsPerDocument: false
        }
    )
);
```

### CommentsManager

Manages comment storage and operations.

```typescript
import { CommentsManager } from '../markdown-comments';

const manager = new CommentsManager(context);

// Add a comment
const comment = await manager.addComment({
    documentUri: document.uri,
    anchor: {
        startLine: 10,
        endLine: 15,
        selectedText: 'Some important text',
        contentHash: 'abc123'
    },
    text: 'This section needs clarification'
});

// Get comments for a document
const comments = manager.getComments(document.uri);

// Update comment
await manager.updateComment(comment.id, { text: 'Updated text' });

// Delete comment
await manager.deleteComment(comment.id);

// Listen for changes
manager.onDidChangeComments((e) => {
    console.log('Comments changed for:', e.documentUri);
});
```

### CommentAnchor

Handles comment positioning and relocation when document content changes.

```typescript
import {
    createAnchor,
    updateAnchor,
    relocateAnchor,
    needsRelocation
} from '../markdown-comments';

// Create anchor for selected text
const anchor = createAnchor(
    startLine,
    endLine,
    selectedText,
    documentContent
);

// Check if relocation is needed after edit
const needsMove = needsRelocation(anchor, newContent);

// Relocate anchor
if (needsMove) {
    const newAnchor = relocateAnchor(anchor, newContent);
    if (newAnchor) {
        console.log(`Relocated to lines ${newAnchor.startLine}-${newAnchor.endLine}`);
    }
}
```

### MarkdownCommentsTreeDataProvider

Tree view showing comments organized by file.

```typescript
import { MarkdownCommentsTreeDataProvider } from '../markdown-comments';

const treeProvider = new MarkdownCommentsTreeDataProvider(commentsManager);

vscode.window.createTreeView('workspaceShortcuts.markdownComments', {
    treeDataProvider: treeProvider
});

// Refresh on comment changes
commentsManager.onDidChangeComments(() => {
    treeProvider.refresh();
});
```

### PromptGenerator

Generates AI prompts from markdown comments.

```typescript
import { PromptGenerator } from '../markdown-comments';

const generator = new PromptGenerator();

// Generate prompt for single comment
const prompt = generator.generate(comment, documentContent, {
    includeContext: true,
    contextLines: 5,
    format: 'clarification'
});

// Generate prompt for all comments in file
const batchPrompt = generator.generateBatch(comments, documentContent);
```

## Webview Architecture

### Webview Logic (Extension Side)

```typescript
// webview-logic/
import { 
    extractCommentState,
    getSelectedContent,
    manageCursorPosition 
} from '../markdown-comments/webview-logic';

// Extract state for comment panel
const state = extractCommentState(selection, documentContent);

// Get selected content with context
const content = getSelectedContent(selection, lines, contextLines);
```

### Webview Scripts (Browser Side)

```typescript
// webview-scripts/
// These run in the webview (browser context)

// main.ts - Entry point
// render.ts - Markdown rendering
// selection-handler.ts - Text selection
// panel-manager.ts - Comment panel UI
// code-block-handlers.ts - Code highlighting
// mermaid-handlers.ts - Diagram rendering
```

## Usage Examples

### Example 1: Opening Review Editor

```typescript
// Open markdown file with review editor
await vscode.commands.executeCommand(
    'vscode.openWith',
    vscode.Uri.file('/path/to/document.md'),
    'shortcuts.markdownReviewEditor'
);
```

### Example 2: Adding Comments Programmatically

```typescript
import { CommentsManager, MarkdownComment } from '../markdown-comments';

async function addReviewComment(
    manager: CommentsManager,
    documentUri: vscode.Uri,
    selection: { startLine: number; endLine: number; text: string }
) {
    const documentContent = await readDocument(documentUri);
    
    const anchor = createAnchor(
        selection.startLine,
        selection.endLine,
        selection.text,
        documentContent
    );
    
    return manager.addComment({
        documentUri,
        anchor,
        text: 'Review comment text'
    });
}
```

### Example 3: AI Clarification Flow

```typescript
import { 
    buildClarificationPrompt,
    validateAndTruncatePrompt,
    parseCopilotOutput 
} from '../markdown-comments';

async function getAIClarification(
    comment: MarkdownComment,
    documentContent: string
) {
    // Build prompt
    let prompt = buildClarificationPrompt(
        comment,
        documentContent,
        'Explain this section in detail'
    );
    
    // Validate and truncate if needed
    prompt = validateAndTruncatePrompt(prompt);
    
    // Invoke AI
    const response = await invokeCopilotCLI(prompt, workspaceRoot);
    
    // Parse response
    if (response.success) {
        const parsed = parseCopilotOutput(response.stdout);
        return parsed;
    }
    
    throw new Error(response.error);
}
```

### Example 4: Custom Markdown Rendering

```typescript
// In webview script
import { renderMarkdown } from './render';
import { setupCodeBlocks } from './code-block-handlers';
import { setupMermaid } from './mermaid-handlers';

async function initializeRenderer(content: string) {
    // Render markdown to HTML
    const html = renderMarkdown(content);
    
    // Set up code block highlighting
    setupCodeBlocks();
    
    // Initialize mermaid diagrams
    await setupMermaid();
    
    return html;
}
```

## Types

### MarkdownComment

```typescript
interface MarkdownComment {
    /** Unique comment ID */
    id: string;
    /** Document URI */
    documentUri: vscode.Uri;
    /** Position anchor */
    anchor: CommentAnchor;
    /** Comment text */
    text: string;
    /** Creation timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
    /** Optional AI response */
    aiResponse?: string;
}
```

### CommentAnchor

```typescript
interface CommentAnchor {
    /** Start line number (1-based) */
    startLine: number;
    /** End line number (1-based) */
    endLine: number;
    /** The selected text */
    selectedText: string;
    /** Hash of content for relocation */
    contentHash: string;
    /** Character offsets (optional) */
    startCharacter?: number;
    endCharacter?: number;
}
```

### WebviewMessage

```typescript
// Extension to Webview
type ExtToWebviewMessage =
    | { type: 'updateContent'; content: string }
    | { type: 'updateComments'; comments: MarkdownComment[] }
    | { type: 'highlightComment'; commentId: string }
    | { type: 'setTheme'; theme: 'light' | 'dark' };

// Webview to Extension
type WebviewToExtMessage =
    | { type: 'addComment'; anchor: CommentAnchor; text: string }
    | { type: 'editComment'; commentId: string; text: string }
    | { type: 'deleteComment'; commentId: string }
    | { type: 'requestClarification'; commentId: string; question: string }
    | { type: 'copyPrompt'; commentId: string };
```

## Storage Format

Comments are stored in JSON files under `.vscode/comments/`:

```json
{
  "version": 1,
  "documentUri": "file:///path/to/document.md",
  "documentHash": "abc123",
  "comments": [
    {
      "id": "comment-1",
      "anchor": {
        "startLine": 10,
        "endLine": 15,
        "selectedText": "Important text",
        "contentHash": "def456"
      },
      "text": "This needs review",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

## Keyboard Shortcuts

| Shortcut | Command | Description |
|----------|---------|-------------|
| `Ctrl+Shift+M` / `Cmd+Shift+M` | Add Comment | Add comment on selected text |
| `Escape` | Close Panel | Close comment panel |

## Best Practices

1. **Anchor carefully**: Use sufficient context for reliable relocation.

2. **Handle orphans**: Detect comments that can no longer be positioned.

3. **Theme support**: Respect VSCode theme in webview rendering.

4. **Performance**: Lazy-load heavy dependencies (mermaid, highlight.js).

5. **Selection handling**: Handle edge cases in text selection.

6. **Sync with file**: Update comments when document is saved.

## See Also

- `src/shortcuts/shared/AGENTS.md` - Shared utilities (anchor, prompt generator base)
- `src/shortcuts/git-diff-comments/AGENTS.md` - Similar feature for Git diffs
- `docs/MARKDOWN_COMMENTS_REQUIREMENTS.md` - Requirements documentation
- `docs/MARKDOWN_VIEWER_DESIGN.md` - Design documentation
