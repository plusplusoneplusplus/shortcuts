# Language Model Tools Module - Developer Reference

This module provides tools that can be invoked by GitHub Copilot Chat. These tools extend Copilot's capabilities with extension-specific functionality.

## Architecture Overview

```
GitHub Copilot Chat (User asks questions in chat)
  │ Invokes tools
  ▼
Language Model Tools Module
  ├── registerLanguageModelTools - Registers tools with VSCode LM API
  └── ResolveCommentsTool - Resolves markdown/diff comments by ID
  │ Accesses
  ▼
Comments Managers (Markdown & Git Diff)
```

## Key Components

### registerLanguageModelTools

```typescript
import { registerLanguageModelTools } from '../lm-tools';

export function activate(context: vscode.ExtensionContext) {
    const disposables = registerLanguageModelTools(
        context, markdownCommentsManager, diffCommentsManager
    );
    context.subscriptions.push(...disposables);
}
```

### ResolveCommentsTool

Implements `vscode.LanguageModelTool<ResolveCommentsInput>`. Registered as `'workspace-shortcuts_resolveComments'`.

```typescript
import { ResolveCommentsTool, ResolveCommentsInput } from '../lm-tools';

const tool = new ResolveCommentsTool(markdownCommentsManager, diffCommentsManager);

// invoke() signature — receives options wrapper, not raw input
async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ResolveCommentsInput>,
    token: vscode.CancellationToken
): Promise<vscode.LanguageModelToolResult> {
    const input = options.input;
    // Resolves comments by ID, returns LanguageModelToolResult with text
}

// prepareInvocation() — shows confirmation before execution
async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ResolveCommentsInput>,
    token: vscode.CancellationToken
): Promise<vscode.PreparedToolInvocation | undefined> {
    return {
        invocationMessage: `Resolving ${count} ${typeLabel} comment(s)...`,
        confirmationMessages: { title: 'Resolve Comments', message: markdownString }
    };
}
```

## Types

### ResolveCommentsInput

```typescript
interface ResolveCommentsInput {
    /** Type of comments to resolve: 'markdown' or 'diff' */
    commentType: 'markdown' | 'diff';
    /** Comment ID(s) to resolve */
    commentIds: string[];
}
```

### ResolveCommentsResult (internal)

```typescript
interface ResolveCommentsResult {
    success: boolean;
    resolvedCount: number;
    resolvedIds: string[];
    errors: string[];
}
```

## Usage Example

```
User: "Please resolve the comment about the null pointer in my review"
Copilot: [Invokes workspace-shortcuts_resolveComments with { commentType: 'markdown', commentIds: ['comment-abc123'] }]
Copilot: "Successfully resolved 1 comment(s)."
```

## Adding a New Tool

1. Create a class implementing `vscode.LanguageModelTool<YourInput>`
2. Implement `invoke(options, token)` and optionally `prepareInvocation(options, token)`
3. Register in `register-tools.ts` via `vscode.lm.registerTool('namespace_toolName', tool)`

## Best Practices

1. **Handle cancellation**: Respect the cancellation token for long operations.
2. **Structured output**: Return `LanguageModelToolResult` with `LanguageModelTextPart`.
3. **Error handling**: Return meaningful error messages when operations fail.
4. **Confirmation**: Use `prepareInvocation` to show confirmation before destructive operations.

## Module Files

| File | Purpose |
|------|---------|
| `resolve-comments-tool.ts` | `ResolveCommentsTool`: resolves review comments by ID |
| `register-tools.ts` | `registerLanguageModelTools()`: registers tools with VS Code LM API |
| `index.ts` | Exports: `ResolveCommentsTool`, `ResolveCommentsInput`, `registerLanguageModelTools` |

## See Also

- `src/shortcuts/markdown-comments/AGENTS.md` - Markdown comments feature
- `src/shortcuts/git-diff-comments/AGENTS.md` - Diff comments feature
- VSCode Language Model API documentation
