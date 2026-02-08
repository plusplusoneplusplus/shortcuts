# Git Diff Comments Module - Developer Reference

This module provides inline commenting capability for Git diffs. Users can add, manage, and export comments on staged, unstaged, or committed changes.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    VSCode Custom Editor                         │
│            (Diff Review Editor - Side-by-side view)             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Renders
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Git Diff Comments Module                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │           DiffReviewEditorProvider                          ││
│  │  - Custom editor for diff review                            ││
│  │  - Webview with side-by-side diff rendering                 ││
│  │  - Comment panel for inline annotations                     ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │DiffCommentsMgr  │  │   DiffAnchor    │  │ DiffPromptGen   │ │
│  │ (CRUD + storage)│  │(Position track) │  │  (AI prompts)   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │         DiffCommentsTreeDataProvider                        ││
│  │  - Tree view showing all comments by category/file          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│           Git Module (diff content) & Shared Module             │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### DiffReviewEditorProvider

Custom editor provider for diff review with inline commenting.

```typescript
import { DiffReviewEditorProvider } from '../git-diff-comments';

// Register the custom editor
const provider = new DiffReviewEditorProvider(context, commentsManager);
context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
        'shortcuts.diffReviewEditor',
        provider,
        { webviewOptions: { retainContextWhenHidden: true } }
    )
);
```

### DiffCommentsManager

Manages comment storage and operations.

```typescript
import { DiffCommentsManager } from '../git-diff-comments';

const manager = new DiffCommentsManager(context);

// Add a comment
const comment = await manager.addComment({
    filePath: 'src/auth/login.ts',
    gitContext: { type: 'staged', commitHash: undefined },
    anchor: {
        startLine: 10,
        endLine: 15,
        selectedText: 'function login()',
        contentHash: 'abc123'
    },
    category: 'suggestion',
    text: 'Consider adding input validation here'
});

// Get comments for a file
const comments = manager.getCommentsForFile('src/auth/login.ts', gitContext);

// Update comment
await manager.updateComment(comment.id, { text: 'Updated text' });

// Delete comment
await manager.deleteComment(comment.id);

// Resolve/unresolve
await manager.resolveComment(comment.id);
await manager.unresolveComment(comment.id);
```

### DiffAnchor

Handles comment positioning and relocation when content changes.

```typescript
import {
    createDiffAnchor,
    updateDiffAnchor,
    relocateDiffAnchor,
    needsDiffRelocation
} from '../git-diff-comments';

// Create anchor for selected text
const anchor = createDiffAnchor(
    startLine,
    endLine,
    selectedText,
    fullContent
);

// Check if relocation is needed
const needsRelocation = needsDiffRelocation(anchor, newContent);

// Relocate anchor after content changes
if (needsRelocation) {
    const newAnchor = relocateDiffAnchor(anchor, newContent);
    if (newAnchor) {
        console.log(`Relocated to lines ${newAnchor.startLine}-${newAnchor.endLine}`);
    } else {
        console.log('Anchor could not be relocated');
    }
}
```

### DiffCommentsTreeDataProvider

Tree view showing comments organized by category and file.

```typescript
import { DiffCommentsTreeDataProvider } from '../git-diff-comments';

const treeProvider = new DiffCommentsTreeDataProvider(commentsManager);

vscode.window.createTreeView('workspaceShortcuts.diffComments', {
    treeDataProvider: treeProvider
});

// Refresh when comments change
commentsManager.onDidChangeComments(() => {
    treeProvider.refresh();
});
```

### DiffPromptGenerator

Generates AI prompts from diff comments.

```typescript
import { DiffPromptGenerator, DEFAULT_DIFF_PROMPT_OPTIONS } from '../git-diff-comments';

const generator = new DiffPromptGenerator();

// Generate prompt for single comment
const prompt = generator.generatePrompt(comment, diffContent, {
    includeContext: true,
    contextLines: 5
});

// Generate prompt for multiple comments
const batchPrompt = generator.generateBatchPrompt(comments, diffContent, {
    groupByCategory: true
});

// Copy to clipboard
await vscode.env.clipboard.writeText(prompt);
```

## Supporting Files

### diff-content-provider.ts

Fetches file contents at various Git refs (HEAD, index, working tree, commits) and generates diff content. Handles binary files gracefully.

```typescript
import {
    DiffContentProvider,
    getFileContentAtRef,
    generateDiffContent,
    isBinaryFile
} from '../git-diff-comments/diff-content-provider';

const provider = new DiffContentProvider(gitService);

// Get file content at specific Git ref
const content = await getFileContentAtRef(
    filePath,
    { type: 'commit', commitHash: 'abc123' },
    repoPath
);

// Generate diff content between two refs
const diff = await generateDiffContent(
    filePath,
    { type: 'staged' },
    repoPath
);

// Check if file is binary
if (isBinaryFile(filePath, content)) {
    // Handle binary file appropriately
}
```

### git-ref-utils.ts

Git reference URI parsing and commit hash shortening utilities.

```typescript
import {
    parseGitRefUri,
    shortenCommitHash,
    expandCommitHash,
    isValidCommitHash
} from '../git-diff-comments/git-ref-utils';

// Parse Git reference URI
const ref = parseGitRefUri('git-show:abc123def456/path/to/file.ts');
// Returns: { commitHash: 'abc123def456', filePath: 'path/to/file.ts' }

// Shorten commit hash (7 chars)
const short = shortenCommitHash('abc123def4567890123456789012345678901234');
// Returns: 'abc123d'

// Expand short hash to full hash
const full = await expandCommitHash('abc123d', repoPath);
// Returns: 'abc123def4567890123456789012345678901234'

// Validate commit hash format
if (isValidCommitHash('abc123')) {
    // Valid hash
}
```

## Comment Categories

Comments can be categorized for organization:

| Category | Description | Icon |
|----------|-------------|------|
| `bug` | Potential bugs or issues | 🐛 |
| `suggestion` | Improvement suggestions | 💡 |
| `question` | Questions for clarification | ❓ |
| `nitpick` | Minor style/formatting issues | 📝 |
| `security` | Security concerns | 🔒 |
| `performance` | Performance concerns | ⚡ |
| `general` | General comments | 💬 |

## Usage Examples

### Example 1: Opening Diff Review Editor

```typescript
// Open diff review for a staged file
await vscode.commands.executeCommand(
    'vscode.openWith',
    vscode.Uri.file('/path/to/file.ts'),
    'shortcuts.diffReviewEditor',
    { gitContext: { type: 'staged' } }
);

// Open diff review for a committed file
await vscode.commands.executeCommand(
    'vscode.openWith',
    vscode.Uri.file('/path/to/file.ts'),
    'shortcuts.diffReviewEditor',
    { gitContext: { type: 'commit', commitHash: 'abc123' } }
);
```

### Example 2: Working with Comments Programmatically

```typescript
import { DiffCommentsManager, DiffComment } from '../git-diff-comments';

async function reviewDiff(manager: DiffCommentsManager, filePath: string) {
    // Get all comments for a file
    const comments = manager.getCommentsForFile(filePath);
    
    // Filter by category
    const bugs = comments.filter(c => c.category === 'bug');
    const suggestions = comments.filter(c => c.category === 'suggestion');
    
    // Filter by resolved status
    const unresolved = comments.filter(c => !c.resolved);
    
    // Generate summary
    console.log(`
        Total comments: ${comments.length}
        Bugs: ${bugs.length}
        Suggestions: ${suggestions.length}
        Unresolved: ${unresolved.length}
    `);
    
    return { bugs, suggestions, unresolved };
}
```

### Example 3: AI Clarification on Comment

```typescript
import { handleDiffAIClarification, buildDiffClarificationPrompt } from '../git-diff-comments';

// Build prompt for AI clarification
const prompt = buildDiffClarificationPrompt(
    comment,
    diffContent,
    'Explain why this code change might cause issues'
);

// Handle full AI clarification flow
const result = await handleDiffAIClarification(
    comment,
    diffContent,
    processManager,
    workspaceRoot
);

if (result.success) {
    console.log('AI response:', result.response);
}
```

### Example 4: Batch Comment Operations

```typescript
import { DiffCommentsManager } from '../git-diff-comments';

async function resolveAllComments(
    manager: DiffCommentsManager,
    filePath: string,
    gitContext: GitContext
) {
    const comments = manager.getCommentsForFile(filePath, gitContext);
    
    for (const comment of comments) {
        if (!comment.resolved) {
            await manager.resolveComment(comment.id);
        }
    }
}

async function exportCommentsToMarkdown(
    manager: DiffCommentsManager,
    filePath: string
): Promise<string> {
    const comments = manager.getCommentsForFile(filePath);
    
    const lines = ['# Code Review Comments\n'];
    
    for (const comment of comments) {
        lines.push(`## ${comment.category.toUpperCase()}`);
        lines.push(`**File:** ${comment.filePath}`);
        lines.push(`**Lines:** ${comment.anchor.startLine}-${comment.anchor.endLine}`);
        lines.push(`**Status:** ${comment.resolved ? '✅ Resolved' : '⬜ Open'}`);
        lines.push('');
        lines.push(comment.text);
        lines.push('');
        lines.push('---\n');
    }
    
    return lines.join('\n');
}
```

## Types

### DiffComment

```typescript
interface DiffComment {
    /** Unique comment ID */
    id: string;
    /** File path relative to workspace */
    filePath: string;
    /** Git context (staged, unstaged, commit) */
    gitContext: DiffGitContext;
    /** Position anchor */
    anchor: DiffAnchor;
    /** Comment category */
    category: CommentCategory;
    /** Comment text */
    text: string;
    /** Whether comment is resolved */
    resolved: boolean;
    /** Creation timestamp */
    createdAt: Date;
    /** Last update timestamp */
    updatedAt: Date;
    /** Optional AI response */
    aiResponse?: string;
}
```

### DiffAnchor

```typescript
interface DiffAnchor {
    /** Start line number (1-based) */
    startLine: number;
    /** End line number (1-based) */
    endLine: number;
    /** The selected text content */
    selectedText: string;
    /** Hash of surrounding content for relocation */
    contentHash: string;
    /** Character offset within line */
    startCharacter?: number;
    /** Character offset for end */
    endCharacter?: number;
}
```

### DiffGitContext

```typescript
interface DiffGitContext {
    /** Type of diff */
    type: 'staged' | 'unstaged' | 'untracked' | 'commit';
    /** Commit hash (for commit type) */
    commitHash?: string;
    /** Repository root path */
    repositoryRoot?: string;
}
```

## Webview Communication

The diff review editor communicates with the webview via messages:

```typescript
// From extension to webview
webview.postMessage({ type: 'updateDiff', content: diffContent });
webview.postMessage({ type: 'updateComments', comments: commentList });
webview.postMessage({ type: 'highlightComment', commentId: id });

// From webview to extension
// (handled in DiffReviewEditorProvider.onDidReceiveMessage)
{ type: 'addComment', anchor: {...}, text: '...', category: '...' }
{ type: 'editComment', commentId: '...', text: '...' }
{ type: 'deleteComment', commentId: '...' }
{ type: 'resolveComment', commentId: '...' }
{ type: 'copyPrompt', commentId: '...' }
```

## Best Practices

1. **Anchor carefully**: Use sufficient context for reliable comment relocation.

2. **Category appropriately**: Use specific categories for better organization.

3. **Handle orphans**: Detect and handle comments that can't be relocated.

4. **Batch operations**: Use batch operations for bulk updates.

5. **Dispose properly**: Clean up event listeners and subscriptions.

## Module Files

| File | Purpose |
|------|---------|
| `diff-review-editor-provider.ts` | `DiffReviewEditorProvider` (CustomTextEditorProvider): side-by-side diff view with inline comments |
| `diff-comments-manager.ts` | `DiffCommentsManager` (extends `CommentsManagerBase`): CRUD, persistence, category support |
| `diff-comments-tree-provider.ts` | `DiffCommentsTreeDataProvider` (extends `CommentsTreeProviderBase`): tree by category/file |
| `diff-anchor.ts` | Diff-specific anchor creation and relocation for comment positioning |
| `diff-prompt-generator.ts` | `DiffPromptGenerator` (extends `PromptGeneratorBase`): AI prompt generation for diff comments |
| `diff-comments-commands.ts` | VS Code commands: add/edit/delete/resolve/reopen diff comments, generate prompt |
| `diff-content-provider.ts` | Provides diff content from Git for rendering in webview |
| `git-ref-utils.ts` | Git reference resolution utilities for commit/branch/tag refs |
| `types.ts` | All types: DiffComment, DiffAnchor, DiffGitContext, CommentCategory |
| `index.ts` | Module exports |

## See Also

- `src/shortcuts/git/AGENTS.md` - Git integration
- `src/shortcuts/markdown-comments/AGENTS.md` - Similar commenting for markdown
- `src/shortcuts/shared/AGENTS.md` - Shared anchor utilities
- `docs/DRAG_DROP_BEHAVIOR.md` - Drag and drop documentation
