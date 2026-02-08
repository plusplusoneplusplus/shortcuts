# Discovery Module - Developer Reference

This module provides AI-powered feature discovery that automatically finds and organizes files, documentation, and commits related to a specific feature or topic. It uses Copilot CLI for semantic search capabilities.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Interface                             │
│  (Discovery command, Quick Pick, Webview Preview)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Feature description
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Discovery Module                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              AIDiscoveryEngine (Primary)                    ││
│  │  - Semantic search via Copilot CLI                          ││
│  │  - Understands context and code relationships               ││
│  │  - Searches files, docs, tests, and git history             ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              DiscoveryEngine (Fallback)                     ││
│  │  - Keyword-based search for non-AI environments             ││
│  │  - Uses grep, glob, and git log                             ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ KeywordExtractor│  │ RelevanceScorer │  │ SearchProviders │ │
│  │ (Term analysis) │  │ (Result ranking)│  │ (File/Git/etc.) │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Results
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Discovery Webview Preview                          │
│  (Interactive selection and preview of discovered items)        │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### AIDiscoveryEngine

The primary discovery engine using AI for semantic search.

```typescript
import { AIDiscoveryEngine, createAIDiscoveryRequest } from '../discovery';

// Create the engine
const engine = new AIDiscoveryEngine();

// Create a discovery request
const request = createAIDiscoveryRequest(
    'User authentication with OAuth',
    workspaceRoot,
    {
        keywords: ['oauth', 'authentication', 'login'],
        targetGroupPath: 'Authentication Feature',
        scope: {
            includeSourceFiles: true,
            includeDocs: true,
            includeGitHistory: true,
            maxCommits: 50
        }
    }
);

// Run discovery
const process = await engine.discover(request);

// Check results
if (process.status === 'completed') {
    console.log(`Found ${process.results?.length} items`);
    for (const result of process.results || []) {
        console.log(`- ${result.name} (${result.type}): ${result.relevanceScore}%`);
    }
}
```

### ai-discovery-engine.ts

AI-powered search engine using Copilot SDK/CLI with prompt construction, response parsing, and process cancellation support.

```typescript
import {
    AIDiscoveryEngine,
    buildDiscoveryPrompt,
    parseDiscoveryResponse,
    cancelDiscoveryProcess
} from '../discovery/ai-discovery-engine';

const engine = new AIDiscoveryEngine();

// Build discovery prompt with feature description and keywords
const prompt = buildDiscoveryPrompt(
    'User authentication with OAuth',
    ['oauth', 'authentication', 'login'],
    { includeSourceFiles: true, includeDocs: true }
);

// Parse AI response into structured discovery results
const results = parseDiscoveryResponse(aiOutput, featureDescription);

// Cancel a running discovery process
await cancelDiscoveryProcess(processId);
```

### keyword-extractor.ts

NLP utilities for extracting keywords, filtering stop words, and generating search patterns. Used as fallback when AI is unavailable.

```typescript
import {
    extractKeywords,
    filterStopWords,
    generateSearchPatterns,
    tokenizeText
} from '../discovery/keyword-extractor';

// Extract keywords from feature description
const keywords = extractKeywords('User authentication with OAuth');
// Returns: ['user', 'authentication', 'oauth']

// Filter out common stop words
const filtered = filterStopWords(['the', 'user', 'authentication', 'with', 'oauth']);
// Returns: ['user', 'authentication', 'oauth']

// Generate search patterns for grep/glob
const patterns = generateSearchPatterns(['auth', 'login', 'session']);
// Returns: ['*auth*', '*login*', '*session*']

// Tokenize text for analysis
const tokens = tokenizeText('User authentication system');
// Returns: ['user', 'authentication', 'system']
```

### relevance-scorer.ts

Scoring system with heuristics: keyword matches, directory relevance, deduplication, and grouping by type.

```typescript
import {
    RelevanceScorer,
    scoreResult,
    calculateKeywordMatches,
    calculateDirectoryRelevance,
    deduplicateResults,
    groupByType
} from '../discovery/relevance-scorer';

const scorer = new RelevanceScorer();

// Score a discovery result
const score = scoreResult(
    result,
    featureDescription,
    keywords
);
// Returns: 0-100 relevance score

// Calculate keyword match score
const keywordScore = calculateKeywordMatches(
    result,
    keywords
);

// Calculate directory relevance (e.g., src/ more relevant than docs/)
const dirScore = calculateDirectoryRelevance(
    result.path,
    focusAreas
);

// Deduplicate results by path/content
const unique = deduplicateResults(results);

// Group results by type (file, doc, commit)
const grouped = groupByType(results);
// Returns: { files: [...], docs: [...], commits: [...] }
```

### DiscoveryEngine (Keyword-based Fallback)

Used when AI is not available or disabled.

```typescript
import { DiscoveryEngine } from '../discovery';

const engine = new DiscoveryEngine(searchProviders);

// Run keyword-based discovery
const results = await engine.discover({
    featureDescription: 'authentication',
    keywords: ['auth', 'login', 'session'],
    scope: {
        includeSourceFiles: true,
        includeDocs: true
    },
    repositoryRoot: workspaceRoot
});
```

### Search Providers

Pluggable providers for different search types.

```typescript
import { FileSearchProvider, GitSearchProvider } from '../discovery/search-providers';

// File search provider
const fileProvider = new FileSearchProvider();
const fileResults = await fileProvider.search(keywords, options);

// Git search provider
const gitProvider = new GitSearchProvider();
const commitResults = await gitProvider.search(keywords, options);
```

### Discovery Webview

Interactive preview for selecting discovered items.

```typescript
import { DiscoveryPreviewProvider } from '../discovery/discovery-webview';

const previewProvider = new DiscoveryPreviewProvider(context);

// Show discovery results in webview
await previewProvider.showPreview({
    featureDescription: 'authentication',
    results: discoveryResults,
    targetGroup: 'Auth Feature'
});

// Listen for user selections
previewProvider.onDidSelectItems((selectedItems) => {
    // Add selected items to group
});
```

## Configuration

The module reads configuration from VSCode settings:

```json
{
  "workspaceShortcuts.discovery.enabled": true,
  "workspaceShortcuts.discovery.aiTimeout": 120,
  "workspaceShortcuts.discovery.maxResults": 30,
  "workspaceShortcuts.discovery.minRelevance": 40,
  "workspaceShortcuts.discovery.focusAreas": ["src/", "docs/"],
  "workspaceShortcuts.discovery.excludePatterns": ["**/node_modules/**", "**/dist/**"]
}
```

## Discovery Process Lifecycle

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Initializing │ ──▶ │  Extracting  │ ──▶ │  Scanning    │
│              │     │   Keywords   │     │    Files     │
└──────────────┘     └──────────────┘     └──────────────┘
                                                │
                                                ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Completed   │ ◀── │   Scoring    │ ◀── │  Searching   │
│              │     │  Relevance   │     │  Git History │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Usage Examples

### Example 1: Basic Feature Discovery

```typescript
import { AIDiscoveryEngine, createAIDiscoveryRequest } from '../discovery';

async function discoverFeature(description: string, workspaceRoot: string) {
    const engine = new AIDiscoveryEngine();
    
    const request = createAIDiscoveryRequest(description, workspaceRoot);
    
    const process = await engine.discover(request);
    
    if (process.status === 'completed' && process.results) {
        return process.results.filter(r => r.relevanceScore >= 70);
    }
    
    return [];
}

// Usage
const authFiles = await discoverFeature('user authentication', '/path/to/project');
```

### Example 2: Discovery with Progress Tracking

```typescript
const engine = new AIDiscoveryEngine();

// Listen for progress updates
engine.onDidChangeProcess((event) => {
    switch (event.type) {
        case 'process-started':
            console.log('Discovery started');
            break;
        case 'process-updated':
            console.log(`Phase: ${event.process.phase}, Progress: ${event.process.progress}%`);
            break;
        case 'process-completed':
            console.log(`Found ${event.process.results?.length} items`);
            break;
        case 'process-failed':
            console.error(`Discovery failed: ${event.process.error}`);
            break;
    }
});

await engine.discover(request);
```

### Example 3: Excluding Existing Group Items

```typescript
// When augmenting an existing group, exclude items already in the group
const request = createAIDiscoveryRequest(
    'authentication',
    workspaceRoot,
    {
        existingGroupSnapshot: {
            name: 'Auth Feature',
            items: [
                { type: 'file', path: 'src/auth/login.ts' },
                { type: 'commit', commitHash: 'abc123' }
            ]
        }
    }
);

// AI will not include already-added items
const process = await engine.discover(request);
```

### Example 4: Custom Relevance Filtering

```typescript
import { RelevanceScorer } from '../discovery';

const scorer = new RelevanceScorer();

// Score results against feature description
const scoredResults = results.map(result => ({
    ...result,
    relevanceScore: scorer.score(result, featureDescription, keywords)
}));

// Filter by custom threshold
const highRelevance = scoredResults.filter(r => r.relevanceScore >= 80);
const mediumRelevance = scoredResults.filter(r => 
    r.relevanceScore >= 50 && r.relevanceScore < 80
);
```

## Types

### DiscoveryRequest

```typescript
interface DiscoveryRequest {
    /** Natural language description of the feature */
    featureDescription: string;
    /** Optional explicit keywords to search for */
    keywords?: string[];
    /** Search scope configuration */
    scope: {
        includeSourceFiles: boolean;
        includeDocs: boolean;
        includeConfigFiles: boolean;
        includeGitHistory: boolean;
        maxCommits: number;
        excludePatterns: string[];
    };
    /** Target group path for organizing results */
    targetGroupPath?: string;
    /** Repository root path */
    repositoryRoot: string;
    /** Existing items to exclude from results */
    existingGroupSnapshot?: ExistingGroupSnapshot;
}
```

### DiscoveryResult

```typescript
interface DiscoveryResult {
    /** Unique identifier */
    id: string;
    /** Type: 'file', 'doc', 'commit' */
    type: DiscoverySourceType;
    /** Display name */
    name: string;
    /** File path (for file/doc types) */
    path?: string;
    /** Commit info (for commit type) */
    commit?: DiscoveryCommitInfo;
    /** Relevance score (0-100) */
    relevanceScore: number;
    /** Keywords that matched */
    matchedKeywords: string[];
    /** Human-readable relevance explanation */
    relevanceReason?: string;
    /** Whether user selected this item */
    selected: boolean;
}
```

### DiscoveryProcess

```typescript
interface DiscoveryProcess {
    /** Unique process ID */
    id: string;
    /** Current status */
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    /** Feature being searched for */
    featureDescription: string;
    /** Current phase */
    phase: DiscoveryPhase;
    /** Progress percentage (0-100) */
    progress: number;
    /** Start time */
    startTime: Date;
    /** End time (when completed) */
    endTime?: Date;
    /** Results (when completed) */
    results?: DiscoveryResult[];
    /** Error message (when failed) */
    error?: string;
}
```

## Best Practices

1. **Provide clear descriptions**: More specific feature descriptions yield better AI results.

2. **Use focus areas**: Set `focusAreas` to prioritize relevant directories.

3. **Set reasonable limits**: Use `maxResults` and `minRelevance` to control result quality.

4. **Handle cancellation**: Allow users to cancel long-running discovery processes.

5. **Cache results**: Consider caching discovery results for repeated queries.

6. **Fallback gracefully**: Use keyword-based discovery when AI is unavailable.

## Module Files

| File | Purpose |
|------|---------|
| `discovery-engine.ts` | `DiscoveryEngine`: primary orchestrator, defaults to AI with keyword fallback |
| `ai-discovery-engine.ts` | `AIDiscoveryEngine`: Copilot SDK/CLI semantic search, prompt construction, response parsing |
| `keyword-extractor.ts` | NLP utilities: stop words, keyword extraction, search pattern generation |
| `relevance-scorer.ts` | Heuristic scoring: keyword matches, directory relevance, deduplication, grouping |
| `discovery-commands.ts` | VS Code commands: discover globally or for a specific group |
| `search-providers/` | Pluggable search providers for files and git history |
| `discovery-webview/` | Webview preview panel for interactive result selection |
| `types.ts` | All types: requests, results, process states, scoring config |
| `index.ts` | Module exports |

## See Also

- `src/shortcuts/ai-service/AGENTS.md` - AI process tracking
- `docs/designs/ai-discovery-design.md` - Detailed design documentation
- `src/shortcuts/discovery/discovery-webview/` - Webview preview components
