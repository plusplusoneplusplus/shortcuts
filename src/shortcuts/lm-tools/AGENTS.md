# Language Model Tools Module - Developer Reference

This module provides tools that can be invoked by GitHub Copilot Chat. These tools extend Copilot's capabilities with extension-specific functionality.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Copilot Chat                          │
│              (User asks questions in chat)                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Invokes tools
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Language Model Tools Module                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              registerLanguageModelTools                     ││
│  │  - Registers tools with VSCode LM API                       ││
│  │  - Sets up tool schemas and handlers                        ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              ResolveCommentsTool                            ││
│  │  - Resolves markdown/diff comments                          ││
│  │  - Returns comment context to Copilot                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Accesses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│     Comments Managers (Markdown & Git Diff)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### registerLanguageModelTools

Registers all language model tools with VSCode.

```typescript
import { registerLanguageModelTools } from '../lm-tools';

// Register tools during extension activation
export function activate(context: vscode.ExtensionContext) {
    const disposables = registerLanguageModelTools(
        context,
        markdownCommentsManager,
        diffCommentsManager
    );
    
    context.subscriptions.push(...disposables);
}
```

### ResolveCommentsTool

Tool that allows Copilot to access and resolve review comments. Implements `vscode.LanguageModelTool<ResolveCommentsInput>` and supports both markdown and git diff comments.

```typescript
import { ResolveCommentsTool, ResolveCommentsInput } from '../lm-tools';

// Create the tool
const tool = new ResolveCommentsTool(
    markdownCommentsManager,
    diffCommentsManager
);

// The tool implements vscode.LanguageModelTool interface
class ResolveCommentsTool implements vscode.LanguageModelTool<ResolveCommentsInput> {
    readonly name = 'resolveComments';
    readonly description = 'Get review comments from the workspace';
    readonly parametersSchema = { /* ... */ };
    
    // prepareInvocation provides user confirmation before execution
    async prepareInvocation(
        input: ResolveCommentsInput,
        token: vscode.CancellationToken,
        context: vscode.LanguageModelToolContext
    ): Promise<vscode.LanguageModelToolInvocation> {
        // Show confirmation dialog
        const confirmed = await vscode.window.showInformationMessage(
            `Resolve comments with filters: ${JSON.stringify(input)}`,
            'Continue',
            'Cancel'
        );
        
        if (confirmed !== 'Continue') {
            throw new vscode.CancellationError();
        }
        
        return {
            toolCallId: context.toolCallId,
            toolName: this.name,
            arguments: input
        };
    }
    
    async invoke(
        input: ResolveCommentsInput,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        // Implementation
    }
}

// Register the tool with VSCode
vscode.lm.registerTool('resolveComments', tool);

// The tool is invoked by Copilot with input like:
const input: ResolveCommentsInput = {
    filePattern: '*.ts',        // Optional: filter by file pattern
    includeResolved: false,     // Optional: include resolved comments
    category: 'bug'             // Optional: filter by category
};
```

## Tool Schemas

### ResolveCommentsTool Schema

```typescript
const schema = {
    name: 'resolveComments',
    description: 'Get review comments from the workspace',
    parameters: {
        type: 'object',
        properties: {
            filePattern: {
                type: 'string',
                description: 'Glob pattern to filter files (e.g., "*.ts", "src/**/*.js")'
            },
            includeResolved: {
                type: 'boolean',
                description: 'Whether to include resolved comments',
                default: false
            },
            category: {
                type: 'string',
                description: 'Filter by comment category (bug, suggestion, question, etc.)',
                enum: ['bug', 'suggestion', 'question', 'nitpick', 'security', 'performance', 'general']
            }
        }
    }
};
```

## Usage Examples

### Example 1: User Interaction with Copilot

When a user asks Copilot about review comments, the tool is invoked:

```
User: "What are the unresolved bugs in my code review?"

Copilot: [Invokes resolveComments tool with { category: 'bug', includeResolved: false }]

Copilot: "I found 3 unresolved bug comments:
1. src/auth/login.ts:45 - Potential null pointer
2. src/api/handler.ts:120 - Race condition
3. src/utils/parser.ts:89 - Buffer overflow"
```

### Example 2: Adding a New Tool

```typescript
// my-new-tool.ts
import * as vscode from 'vscode';

export interface MyToolInput {
    param1: string;
    param2?: number;
}

export class MyNewTool implements vscode.LanguageModelTool<MyToolInput> {
    readonly name = 'myNewTool';
    
    readonly description = 'Description of what this tool does';
    
    readonly parametersSchema = {
        type: 'object',
        properties: {
            param1: {
                type: 'string',
                description: 'First parameter'
            },
            param2: {
                type: 'number',
                description: 'Optional second parameter'
            }
        },
        required: ['param1']
    };

    constructor(private readonly someService: SomeService) {}

    async invoke(
        input: MyToolInput,
        token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        // Implement tool logic
        const result = await this.someService.doSomething(input.param1);
        
        return {
            content: [
                {
                    type: 'text',
                    value: JSON.stringify(result)
                }
            ]
        };
    }
}

// Register in register-tools.ts
export function registerLanguageModelTools(
    context: vscode.ExtensionContext,
    // ... dependencies
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    
    // ... existing tools ...
    
    // Register new tool
    const myTool = new MyNewTool(someService);
    disposables.push(
        vscode.lm.registerTool(myTool.name, myTool)
    );
    
    return disposables;
}
```

### Example 3: Tool with Complex Output

```typescript
async invoke(
    input: ResolveCommentsInput,
    token: vscode.CancellationToken
): Promise<vscode.LanguageModelToolResult> {
    const comments = await this.getComments(input);
    
    // Return structured content
    return {
        content: [
            {
                type: 'text',
                value: `Found ${comments.length} comments:`
            },
            ...comments.map(comment => ({
                type: 'text',
                value: `\n- [${comment.category}] ${comment.filePath}:${comment.line}\n  ${comment.text}`
            }))
        ]
    };
}
```

## Types

### ResolveCommentsInput

```typescript
interface ResolveCommentsInput {
    /** Glob pattern to filter files */
    filePattern?: string;
    /** Include resolved comments */
    includeResolved?: boolean;
    /** Filter by category */
    category?: CommentCategory;
}
```

### LanguageModelToolResult

```typescript
interface LanguageModelToolResult {
    /** Content to return to the language model */
    content: Array<{
        type: 'text' | 'json';
        value: string;
    }>;
}
```

## Best Practices

1. **Clear descriptions**: Tools should have clear, descriptive names and descriptions.

2. **Schema validation**: Define complete parameter schemas for type safety.

3. **Handle cancellation**: Respect the cancellation token for long operations.

4. **Structured output**: Return structured data that Copilot can interpret.

5. **Error handling**: Return meaningful error messages when operations fail.

6. **Minimal permissions**: Only access the data the tool needs.

## Debugging Tools

Tools can be tested using the VSCode Language Model API:

```typescript
// In a test or debug command
const tools = vscode.lm.tools;
const resolveTool = tools.find(t => t.name === 'resolveComments');

if (resolveTool) {
    const result = await resolveTool.invoke({
        category: 'bug',
        includeResolved: false
    }, new vscode.CancellationTokenSource().token);
    
    console.log('Tool result:', result);
}
```

## Module Files

| File | Purpose |
|------|---------|
| `resolve-comments-tool.ts` | `ResolveCommentsTool` implements `vscode.LanguageModelTool`: filters and returns review comments |
| `register-tools.ts` | `registerLanguageModelTools()`: registers all LM tools with VS Code API |
| `types.ts` | Input types and schemas for tool parameters |
| `index.ts` | Module exports |

## See Also

- `src/shortcuts/markdown-comments/AGENTS.md` - Markdown comments feature
- `src/shortcuts/git-diff-comments/AGENTS.md` - Diff comments feature
- VSCode Language Model API documentation
- GitHub Copilot Extension Guide
