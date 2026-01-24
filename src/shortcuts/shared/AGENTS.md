# Shared Module - Developer Reference

This module contains shared utilities used by multiple features across the extension. It reduces code duplication and ensures consistent behavior.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Feature Modules                              │
│  (markdown-comments, git-diff-comments, ai-service, etc.)       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Import shared utilities
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Shared Module                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Text Matching   │  │ HTML Lines      │  │  Glob Utils     │ │
│  │ (Anchor utils)  │  │ (Line parsing)  │  │  (File search)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │TreeProviderBase │  │PromptGenBase    │  │AIHandlerBase    │ │
│  │ (Comments tree) │  │(Prompt building)│  │(AI integration) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              ExtensionLogger                                ││
│  │  - Unified logging across the extension                     ││
│  │  - Categories, levels, structured output                    ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Webview Utilities (./webview)                  ││
│  │  - Content generation, theme handling, message protocols    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### Tree Data Provider Base Classes

**Refactored in 2026-01** to eliminate code duplication across tree data providers. These base classes provide common functionality and reduce boilerplate by ~60-70 lines per provider.

#### BaseTreeDataProvider

Foundation base class for all tree data providers in the extension. Provides common functionality including EventEmitter setup, refresh mechanism, disposal pattern, and error handling.

**Features:**
- Automatic EventEmitter setup (`onDidChangeTreeData`)
- Built-in `refresh()` method with optional element parameter
- Error handling with logging and user notifications
- Disposable management (`dispose()` method automatically called)
- Eliminates ~40-50 lines of boilerplate per provider

**Usage:**

```typescript
import { BaseTreeDataProvider } from '../shared/base-tree-data-provider';

class MyTreeProvider extends BaseTreeDataProvider<vscode.TreeItem> {
    constructor() {
        super();
    }
    
    // Implement required methods
    protected async getChildrenImpl(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            return await this.getRootItems();
        }
        return [];
    }
    
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
    
    // Optional: Override to use specific log category
    protected getLogCategory(): LogCategory {
        return LogCategory.EXTENSION;
    }
}
```

**Key Features:**
- Automatic EventEmitter setup (`onDidChangeTreeData`)
- Built-in `refresh()` method with optional element parameter
- Error handling with logging and user notifications
- Disposable management (`dispose()` method automatically called)
- Eliminates ~40-50 lines of boilerplate per provider

**Providers using BaseTreeDataProvider (as of 2026-01):**
- GlobalNotesTreeDataProvider

#### FilterableTreeDataProvider

Extends BaseTreeDataProvider with filtering/search capabilities. Perfect for tree views that need text-based filtering.

**Features:**
- All features from BaseTreeDataProvider
- Automatic filter state management (lowercase storage)
- Case-insensitive filtering by default
- Helper method `matchesFilter(...fields)` for multi-field matching
- `hasFilter` property to check if filter is active
- Auto-refresh on filter changes
- Eliminates ~60-70 lines of boilerplate per provider

**Providers using FilterableTreeDataProvider (as of 2026-01):**
- TasksTreeDataProvider
- PipelinesTreeDataProvider
- LogicalTreeDataProvider

**Usage:**

```typescript
import { FilterableTreeDataProvider } from '../shared/filterable-tree-data-provider';

class MyFilterableProvider extends FilterableTreeDataProvider<vscode.TreeItem> {
    protected async getChildrenImpl(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        let items = await this.getAllItems();
        
        // Use base class filter helpers
        if (this.hasFilter) {
            items = items.filter(item =>
                this.matchesFilter(item.name, item.description, item.path)
            );
        }
        
        return items;
    }
    
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }
}

// Usage
provider.setFilter('search text');  // Sets filter and auto-refreshes
provider.clearFilter();             // Clears filter and auto-refreshes
const current = provider.getFilter(); // Gets current filter
const isActive = provider.hasFilter; // Check if filter is active
```

**Key Features:**
- All features from BaseTreeDataProvider
- Automatic filter state management (lowercase storage)
- Case-insensitive filtering by default
- Helper method `matchesFilter(...fields)` for multi-field matching
- `hasFilter` property to check if filter is active
- Auto-refresh on filter changes
- Eliminates ~60-70 lines of boilerplate per provider

**Providers using FilterableTreeDataProvider:**
- TasksTreeDataProvider
- PipelinesTreeDataProvider
- LogicalTreeDataProvider

**Key Features:**
- All features from BaseTreeDataProvider
- Automatic filter state management (lowercase storage)
- Case-insensitive filtering by default
- Helper method `matchesFilter(...fields)` for multi-field matching
- `hasFilter` property to check if filter is active
- Auto-refresh on filter changes
- Eliminates ~60-70 lines of boilerplate per provider

**Providers using FilterableTreeDataProvider:**
- TasksTreeDataProvider
- PipelinesTreeDataProvider
- LogicalTreeDataProvider

### ExtensionLogger

Unified logging framework for the extension.

```typescript
import { getExtensionLogger, LogCategory, LogLevel } from '../shared';

const logger = getExtensionLogger();

// Log at different levels
logger.debug(LogCategory.AI_SERVICE, 'Starting process', { processId: '123' });
logger.info(LogCategory.GIT, 'Repository detected', { path: '/repo' });
logger.warn(LogCategory.CONFIG, 'Deprecated setting used');
logger.error(LogCategory.SYNC, 'Sync failed', error, { attempt: 3 });

// Operation logging helpers
logger.logOperationStart(LogCategory.DISCOVERY, 'Feature discovery', { feature: 'auth' });
logger.logOperationComplete(LogCategory.DISCOVERY, 'Feature discovery', 1500, { itemsFound: 15 });
logger.logOperationFailed(LogCategory.DISCOVERY, 'Feature discovery', error, { reason: 'timeout' });
```

### Text Matching Utilities

Utilities for fuzzy text matching and anchor relocation.

```typescript
import {
    calculateSimilarity,
    findFuzzyMatch,
    levenshteinDistance,
    normalizeText
} from '../shared';

// Calculate similarity between strings (0-1)
const similarity = calculateSimilarity('hello world', 'hello word');
// 0.91...

// Find fuzzy match in content
const match = findFuzzyMatch(searchText, fullContent, {
    threshold: 0.8,
    maxDistance: 50
});

if (match) {
    console.log(`Found at line ${match.line}, similarity: ${match.similarity}`);
}

// Levenshtein distance
const distance = levenshteinDistance('kitten', 'sitting');
// 3

// Normalize text for comparison
const normalized = normalizeText('  Hello\n  World  ');
// 'hello world'
```

### HTML Lines Utilities

Utilities for splitting and processing HTML content with line information.

```typescript
import { splitHTMLIntoLines, getHighlightedHTMLLines } from '../shared';

// Split HTML content preserving line info
const lines = splitHTMLIntoLines(htmlContent);
// [{ lineNumber: 1, content: '<p>Hello</p>' }, ...]

// Get highlighted lines for selection
const highlighted = getHighlightedHTMLLines(
    htmlContent,
    startLine,
    endLine,
    'highlight-class'
);
```

### Tree Provider Utility Modules

**Added in 2026-01 refactoring** to centralize common tree provider functionality.

#### Tree Filter Utils

Utilities for filter matching operations in tree data providers.

```typescript
import { FilterMatcher } from '../shared/tree-filter-utils';

// Create filter matcher
const matcher = new FilterMatcher('search text');

// Check if fields match filter (case-insensitive)
const matches = matcher.matches('My Item', 'Description text');
// true if any field contains 'search text'

// Check object properties
const objectMatches = matcher.matchesObject(
    { name: 'Task 1', description: 'Do something' },
    'name', 'description'
);

// Get the filter text (lowercase)
const filterText = matcher.getFilterText();
```

#### Tree Icon Utils

Centralized icon constants and mapping functions for tree providers. **Added in 2026-01** to eliminate icon duplication.

```typescript
import {
    PROCESS_STATUS_ICONS,
    GIT_STATUS_ICONS,
    DOCUMENT_TYPE_ICONS,
    getDocumentIcon,
    getArchivedIcon,
    getProcessStatusIcon,
    getGitStageIcon
} from '../shared/tree-icon-utils';

// Get process status icon
const icon = getProcessStatusIcon('running');
// Returns: ThemeIcon('sync~spin', blue color)

// Get git stage icon
const stageIcon = getGitStageIcon('staged');
// Returns: ThemeIcon('check', green color)

// Get document type icon
const docIcon = getDocumentIcon('plan');
// Returns: ThemeIcon('checklist')

// Get archived item icon
const archivedIcon = getArchivedIcon();
// Returns: ThemeIcon('archive', gray color)

// Use constant maps directly
const customIcon = PROCESS_STATUS_ICONS['completed'];
```

**Available Icon Constants:**
- `PROCESS_STATUS_ICONS` - running, completed, failed, cancelled
- `GIT_STATUS_ICONS` - staged, unstaged, untracked
- `DOCUMENT_TYPE_ICONS` - plan, spec, test, notes, todo, readme, design, impl, review, etc. (18+ types)

#### Tree Error Handler

Utilities for consistent error handling in tree data providers. **Added in 2026-01** to standardize error handling patterns.

```typescript
import { TreeErrorHandler } from '../shared/tree-error-handler';

// Create error handler
const errorHandler = new TreeErrorHandler('MyProvider', LogCategory.EXTENSION);

// Handle error (logs and shows notification)
try {
    await someOperation();
} catch (error) {
    errorHandler.handle(error);
}

// Wrap async function with error handling
const result = await errorHandler.wrap(
    async () => await riskyOperation(),
    [] // fallback value on error
);

// Normalize unknown errors to Error objects
const normalizedError = TreeErrorHandler.normalize(unknownError);
```

**Benefits of 2026-01 Refactoring:**
- Eliminated ~210 lines of code duplication across 4 tree providers
- Consistent behavior for refresh, dispose, error handling
- Centralized icon management
- Simplified filter implementation
- All 5690 tests passing
- 100% backward compatible

### CommentsTreeProviderBase

Base class for comment tree data providers.

```typescript
import { CommentsTreeProviderBase } from '../shared';

class MyCommentsTreeProvider extends CommentsTreeProviderBase<MyComment> {
    constructor(manager: MyCommentsManager) {
        super(manager);
    }
    
    protected getCommentsForElement(element: TreeItem): MyComment[] {
        // Implement to return comments for this element
        return this.manager.getCommentsForFile(element.resourceUri);
    }
    
    protected createCommentItem(comment: MyComment): vscode.TreeItem {
        // Implement to create tree item for comment
        return new vscode.TreeItem(comment.text);
    }
}
```

### PromptGeneratorBase

Base class for generating AI prompts from comments.

```typescript
import { PromptGeneratorBase, DEFAULT_BASE_PROMPT_OPTIONS } from '../shared';

class MyPromptGenerator extends PromptGeneratorBase<MyComment, MyDocument> {
    protected formatComment(comment: MyComment): string {
        return `[${comment.category}] ${comment.text}`;
    }
    
    protected getContext(
        comment: MyComment,
        document: MyDocument,
        contextLines: number
    ): string {
        // Extract context around the comment
        return extractLines(document.content, comment.line, contextLines);
    }
}

// Usage
const generator = new MyPromptGenerator();
const prompt = generator.generate(comment, document, {
    ...DEFAULT_BASE_PROMPT_OPTIONS,
    includeContext: true,
    contextLines: 5
});
```

### AI Clarification Handler Base

Base utilities for AI clarification features.

```typescript
import {
    handleAIClarificationBase,
    validateAndTruncatePromptBase,
    MAX_PROMPT_SIZE,
    getCommentType,
    getResponseLabel
} from '../shared';

// Validate and truncate long prompts
const safePrompt = validateAndTruncatePromptBase(prompt, MAX_PROMPT_SIZE);

// Get comment type for categorization
const type = getCommentType(comment);
// 'markdown' | 'diff'

// Get label for AI response
const label = getResponseLabel(type);
// 'AI Response' | 'AI Analysis'

// Handle full clarification flow
const result = await handleAIClarificationBase({
    comment,
    context: documentContent,
    question: 'Explain this in detail',
    processManager,
    workspaceRoot
});
```

### Glob Utilities

File pattern matching utilities.

```typescript
import { glob, getFilesWithExtension } from '../shared';

// Find files matching pattern
const files = glob('**/*.ts', workspaceRoot);

// Get files with specific extension
const tsFiles = getFilesWithExtension(workspaceRoot, '.ts', {
    exclude: ['**/node_modules/**', '**/dist/**']
});
```

## Webview Utilities

Shared utilities for webview components (in `./webview` subdirectory).

```typescript
import {
    generateWebviewContent,
    getNonce,
    getWebviewUri,
    handleWebviewMessage
} from '../shared/webview';

// Generate nonce for CSP
const nonce = getNonce();

// Get webview URI for resources
const styleUri = getWebviewUri(webview, extensionUri, ['media', 'styles', 'main.css']);

// Generate base webview HTML
const html = generateWebviewContent({
    webview,
    extensionUri,
    nonce,
    title: 'My Webview',
    stylesheets: ['main.css'],
    scripts: ['main.js']
});
```

## Usage Examples

### Example 1: Using Logger in a Service

```typescript
import { getExtensionLogger, LogCategory } from '../shared';

export class MyService {
    private readonly logger = getExtensionLogger();
    
    async doSomething(input: string): Promise<Result> {
        this.logger.logOperationStart(LogCategory.AI_SERVICE, 'Processing', { input });
        
        try {
            const startTime = Date.now();
            const result = await this.process(input);
            
            this.logger.logOperationComplete(
                LogCategory.AI_SERVICE,
                'Processing',
                Date.now() - startTime,
                { resultSize: result.length }
            );
            
            return result;
        } catch (error) {
            this.logger.logOperationFailed(
                LogCategory.AI_SERVICE,
                'Processing',
                error instanceof Error ? error : undefined,
                { input }
            );
            throw error;
        }
    }
}
```

### Example 2: Implementing Comment Anchor Relocation

```typescript
import { calculateSimilarity, findFuzzyMatch, normalizeText } from '../shared';

function relocateAnchor(
    anchor: Anchor,
    newContent: string
): Anchor | null {
    const normalizedSearch = normalizeText(anchor.selectedText);
    
    // Try exact match first
    const exactIndex = newContent.indexOf(anchor.selectedText);
    if (exactIndex !== -1) {
        return createAnchorAtIndex(newContent, exactIndex, anchor.selectedText.length);
    }
    
    // Try fuzzy match
    const fuzzyMatch = findFuzzyMatch(anchor.selectedText, newContent, {
        threshold: 0.8
    });
    
    if (fuzzyMatch) {
        return createAnchorAtIndex(newContent, fuzzyMatch.index, fuzzyMatch.length);
    }
    
    return null; // Could not relocate
}
```

### Example 3: Creating a Custom Tree Provider

```typescript
import { CommentsTreeProviderBase } from '../shared';

export class ReviewCommentsTreeProvider extends CommentsTreeProviderBase<ReviewComment> {
    constructor(
        private readonly manager: ReviewCommentsManager
    ) {
        super();
    }
    
    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }
    
    async getChildren(element?: TreeItem): Promise<TreeItem[]> {
        if (!element) {
            // Root level - return files with comments
            return this.getFilesWithComments();
        }
        
        if (element instanceof FileItem) {
            // File level - return comments
            return this.getCommentsForFile(element.uri);
        }
        
        return [];
    }
    
    protected getCommentsForFile(uri: vscode.Uri): ReviewComment[] {
        return this.manager.getComments(uri);
    }
}
```

## Types

### LogCategory

```typescript
enum LogCategory {
    EXTENSION = 'Extension',
    CONFIG = 'Config',
    GIT = 'Git',
    AI_SERVICE = 'AI-Service',
    DISCOVERY = 'Discovery',
    SYNC = 'Sync',
    COMMENTS = 'Comments',
    TREE = 'Tree',
    WEBVIEW = 'Webview'
}
```

### LogLevel

```typescript
enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
```

### LogEntry

```typescript
interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    category: LogCategory;
    message: string;
    data?: Record<string, unknown>;
    error?: Error;
}
```

### BasePromptGenerationOptions

```typescript
interface BasePromptGenerationOptions {
    /** Include surrounding context */
    includeContext: boolean;
    /** Number of context lines */
    contextLines: number;
    /** Include comment metadata */
    includeMetadata: boolean;
    /** Maximum prompt length */
    maxLength: number;
}
```

## Best Practices

1. **Use the logger**: Always use ExtensionLogger for consistent logging.

2. **Import from index**: Import from `'../shared'` not individual files.

3. **Extend base classes**: Use base classes for consistent behavior.

4. **Share constants**: Put shared constants in the shared module.

5. **Keep it general**: Shared utilities should be domain-agnostic.

6. **Document dependencies**: Note which features depend on shared utilities.

## Module Organization

```
shared/
├── index.ts                          # Main exports
├── extension-logger.ts               # Logging framework
├── base-tree-data-provider.ts        # Base class for tree providers
├── filterable-tree-data-provider.ts  # Base with filtering support
├── tree-filter-utils.ts              # Filter matching utilities
├── tree-icon-utils.ts                # Icon constants and helpers
├── tree-error-handler.ts             # Error handling utilities
├── text-matching.ts                  # String similarity utilities
├── highlighted-html-lines.ts         # HTML line processing
├── anchor-utils.ts                   # Anchor creation/relocation
├── glob-utils.ts                     # File pattern matching
├── comments-tree-provider-base.ts    # Tree provider base for comments
├── prompt-generator-base.ts          # Prompt generator base
├── ai-clarification-handler-base.ts  # AI handler base
└── webview/                          # Webview utilities
    ├── index.ts
    ├── content-generator.ts
    ├── message-handler.ts
    └── theme-utils.ts
```

## See Also

- `src/shortcuts/markdown-comments/AGENTS.md` - Uses shared anchor/prompt utilities
- `src/shortcuts/git-diff-comments/AGENTS.md` - Uses shared anchor/prompt utilities
- `src/shortcuts/ai-service/AGENTS.md` - Uses shared logging utilities
