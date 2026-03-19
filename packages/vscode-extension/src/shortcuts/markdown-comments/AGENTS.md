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

## Supporting Files

### base-types.ts

Generic base interfaces for reuse across comment systems (markdown and git diff).

```typescript
import { CommentAnchor, CommentBase } from '../markdown-comments/base-types';

// Base comment interface
interface CommentBase {
    id: string;
    text: string;
    createdAt: Date;
    updatedAt: Date;
}

// Anchor interface for positioning
interface CommentAnchor {
    startLine: number;
    endLine: number;
    selectedText: string;
    contentHash: string;
}
```

### markdown-parser.ts

Comprehensive markdown parsing utilities that handle code blocks, mermaid diagrams, tables, headings, links, images, and other markdown elements.

```typescript
import {
    parseMarkdown,
    extractCodeBlocks,
    extractMermaidDiagrams,
    extractTables,
    extractHeadings,
    extractLinks,
    extractImages
} from '../markdown-comments/markdown-parser';

// Parse markdown content
const parsed = parseMarkdown(content);

// Extract specific elements
const codeBlocks = extractCodeBlocks(content);
const mermaidDiagrams = extractMermaidDiagrams(content);
const tables = extractTables(content);
const headings = extractHeadings(content);
const links = extractLinks(content);
const images = extractImages(content);
```

### file-path-utils.ts

File path resolution utilities for resolving file paths from markdown links.

```typescript
import {
    resolveMarkdownLink,
    resolveRelativePath,
    normalizePath
} from '../markdown-comments/file-path-utils';

// Resolve markdown link to absolute path
const absolutePath = resolveMarkdownLink('[Link Text](./file.md)', basePath);

// Resolve relative path
const resolved = resolveRelativePath('../other/file.md', currentPath);

// Normalize path
const normalized = normalizePath('path/to/../file.md');
```

### line-change-tracker.ts

Line-level change detection between text versions. Tracks insertions, deletions, and modifications.

```typescript
import {
    trackLineChanges,
    calculateLineMapping,
    mapLineNumber
} from '../markdown-comments/line-change-tracker';

// Track changes between two versions
const changes = trackLineChanges(oldContent, newContent);

// Calculate line number mapping
const mapping = calculateLineMapping(oldContent, newContent);

// Map old line number to new line number
const newLine = mapLineNumber(oldLine, mapping);
```

### code-block-themes.ts

Syntax highlighting themes for code blocks (dark/light theme support).

```typescript
import {
    getCodeBlockTheme,
    applySyntaxHighlighting,
    getThemeCSS
} from '../markdown-comments/code-block-themes';

// Get theme CSS for current VSCode theme
const themeCSS = getCodeBlockTheme(vscode.window.activeColorTheme.kind);

// Apply syntax highlighting to code block
const highlighted = applySyntaxHighlighting(code, language, theme);

// Get theme-specific CSS
const css = getThemeCSS('dark'); // or 'light'
```

### comments-manager-base.ts

Abstract base class for comment managers, providing common CRUD operations and event handling.

```typescript
import { CommentsManagerBase } from '../markdown-comments/comments-manager-base';

class MyCommentsManager extends CommentsManagerBase {
    // Implement abstract methods
    protected async loadComments(uri: vscode.Uri): Promise<Comment[]> {
        // Load implementation
    }
    
    protected async saveComments(uri: vscode.Uri, comments: Comment[]): Promise<void> {
        // Save implementation
    }
}

// Base class provides:
// - addComment(), updateComment(), deleteComment()
// - getComments(), getAllComments()
// - onDidChangeComments event emitter
// - Comment storage abstraction
```

### webview-content.ts

HTML generation for ReviewEditor webview. Creates the complete HTML structure with styles, scripts, and content.

```typescript
import {
    generateWebviewContent,
    generateHTML,
    generateStyles,
    generateScripts
} from '../markdown-comments/webview-content';

// Generate complete webview HTML
const html = generateWebviewContent({
    content: markdownContent,
    comments: commentList,
    theme: 'dark',
    nonce: securityNonce
});

// Generate individual components
const htmlContent = generateHTML(markdownContent);
const styles = generateStyles(theme);
const scripts = generateScripts(nonce);
```

### webview-utils.ts

Line number calculation utilities for tables and code blocks. Handles complex markdown structures.

```typescript
import {
    calculateLineNumber,
    getLineNumberForElement,
    calculateTableLineNumbers,
    calculateCodeBlockLineNumbers
} from '../markdown-comments/webview-utils';

// Calculate line number for a DOM element
const lineNumber = getLineNumberForElement(element, documentContent);

// Calculate line numbers for table rows
const tableLineNumbers = calculateTableLineNumbers(tableElement, content);

// Calculate line numbers for code blocks
const codeBlockLines = calculateCodeBlockLineNumbers(codeBlock, content);
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

## Module Files

| File | Purpose |
|------|---------|
| `review-editor-view-provider.ts` | CustomTextEditorProvider for markdown with inline comments, AI, image resolution |
| `comments-manager.ts` | `CommentsManager` (extends `CommentsManagerBase`): CRUD, persistence, anchor relocation |
| `comments-manager-base.ts` | Abstract base class for comment managers: loading/saving JSON, ID generation, events |
| `comments-tree-provider.ts` | `MarkdownCommentsTreeDataProvider` (extends `CommentsTreeProviderBase`): tree view |
| `comment-anchor.ts` | Anchor creation, relocation, batch operations, content-based position tracking |
| `prompt-generator.ts` | `PromptGenerator` (extends `PromptGeneratorBase`): AI prompt generation from comments |
| `comments-commands.ts` | `MarkdownCommentsCommands`: resolve, reopen, delete, generate prompt, go to comment |
| `ai-clarification-handler.ts` | AI clarification workflow for selected markdown text |
| `markdown-parser.ts` | Comprehensive markdown parsing: code blocks, mermaid, tables, headings, links, images |
| `file-path-utils.ts` | File path resolution from markdown links (absolute, relative, workspace-relative) |
| `line-change-tracker.ts` | Line-level change detection between text versions for visual indicators |
| `webview-content.ts` | HTML generation for ReviewEditor webview panel |
| `webview-utils.ts` | Line number calculation utilities for tables and code blocks |
| `code-block-themes.ts` | Syntax highlighting themes (dark/light) with CSS generation |
| `base-types.ts` | Generic base interfaces reused across comment systems |
| `types.ts` | All types: comment, anchor, status, events, config, AI clarification |
| `index.ts` | Module exports |

## See Also

- `src/shortcuts/shared/AGENTS.md` - Shared utilities (anchor, prompt generator base)
- `src/shortcuts/git-diff-comments/AGENTS.md` - Similar feature for Git diffs
- `docs/MARKDOWN_COMMENTS_REQUIREMENTS.md` - Requirements documentation
- `docs/MARKDOWN_VIEWER_DESIGN.md` - Design documentation
