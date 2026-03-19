# Discovery Module - Developer Reference

This module provides AI-powered feature discovery that automatically finds and organizes files, documentation, and commits related to a specific feature or topic.

## Architecture Overview

```
User Interface (Discovery command, Quick Pick, Webview Preview)
  │ Feature description
  ▼
Discovery Module
  ├── AIDiscoveryEngine (Primary) - Semantic search via Copilot SDK/CLI
  ├── DiscoveryEngine (Orchestrator) - Defaults to AI, keyword fallback
  ├── KeywordExtractor - Term extraction, search pattern generation
  ├── RelevanceScorer - Deduplication, type grouping, score filtering
  ├── SearchProviders - FileSearchProvider, GitSearchProvider
  └── DiscoveryPreviewPanel - Webview for interactive result selection
```

## Key Components

### AIDiscoveryEngine & createAIDiscoveryRequest

```typescript
import { AIDiscoveryEngine, createAIDiscoveryRequest } from '../discovery';

const engine = new AIDiscoveryEngine();
const request = createAIDiscoveryRequest('User authentication', workspaceRoot, {
    keywords: ['oauth', 'login'],
    scope: { includeSourceFiles: true, includeDocs: true, includeGitHistory: true, maxCommits: 50 }
});
const process = await engine.discover(request);

// Listen for progress
engine.onDidChangeProcess((event) => {
    console.log(`${event.type}: ${event.process.phase} ${event.process.progress}%`);
});
```

**Exports from `ai-discovery-engine.ts`:** `AIDiscoveryEngine`, `createAIDiscoveryRequest`, `parseDiscoveryResponse`, `buildExistingItemsSection`, `AIDiscoveryConfig`, `DEFAULT_AI_DISCOVERY_CONFIG`, `AIDiscoveryItem`, `AIDiscoveryResponse`

### DiscoveryEngine (Orchestrator)

```typescript
import { DiscoveryEngine } from '../discovery';

const engine = new DiscoveryEngine({ forceMode: 'keyword' }); // or 'ai' or 'auto'
const process = await engine.discover(request);
```

### keyword-extractor.ts

**Exports:** `extractKeywords`, `combineKeywords`, `generateSearchPatterns`, `calculateKeywordMatchScore`

```typescript
const keywords = extractKeywords('User authentication with OAuth');
const patterns = generateSearchPatterns(keywords);
const score = calculateKeywordMatchScore('auth login handler', keywords);
```

### relevance-scorer.ts

**Exports:** `deduplicateResults`, `groupResultsByType`, `filterByScore`, `getRelevanceLevel`

```typescript
const unique = deduplicateResults(results);
const grouped = groupResultsByType(results); // Map<DiscoverySourceType, DiscoveryResult[]>
const highQuality = filterByScore(results, 70);
const level = getRelevanceLevel(85); // 'high' | 'medium' | 'low'
```

### Search Providers

```typescript
import { FileSearchProvider, GitSearchProvider } from '../discovery/search-providers';
const fileResults = await new FileSearchProvider().search(keywords, options);
const commitResults = await new GitSearchProvider().search(keywords, options);
```

### DiscoveryPreviewPanel

```typescript
import { DiscoveryPreviewPanel } from '../discovery/discovery-webview';
DiscoveryPreviewPanel.createOrShow(extensionUri, discoveryEngine, configManager, taskManager);
```

## Configuration

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

## Usage: Excluding Existing Group Items

```typescript
const request = createAIDiscoveryRequest('authentication', workspaceRoot, {
    existingGroupSnapshot: {
        name: 'Auth Feature',
        items: [{ type: 'file', path: 'src/auth/login.ts' }]
    }
});
```

## Module Files

| File | Purpose |
|------|---------|
| `discovery-engine.ts` | `DiscoveryEngine`: orchestrator, defaults to AI with keyword fallback |
| `ai-discovery-engine.ts` | `AIDiscoveryEngine`: Copilot SDK/CLI semantic search, prompt construction, response parsing |
| `keyword-extractor.ts` | NLP utilities: keyword extraction, search pattern generation |
| `relevance-scorer.ts` | Heuristic utilities: deduplication, type grouping, score filtering, relevance levels |
| `discovery-commands.ts` | VS Code commands: discover globally or for a specific group |
| `search-providers/` | Pluggable search providers for files and git history |
| `discovery-webview/` | `DiscoveryPreviewPanel`: webview panel for interactive result selection and filtering |
| `types.ts` | All types: requests, results, process states, scoring config |
| `index.ts` | Exports from: types, keyword-extractor, relevance-scorer, discovery-engine, ai-discovery-engine, discovery-commands, search-providers, discovery-webview |

## Best Practices

1. **Provide clear descriptions**: More specific feature descriptions yield better AI results.
2. **Use focus areas**: Set `focusAreas` to prioritize relevant directories.
3. **Handle cancellation**: Allow users to cancel long-running discovery processes.
4. **Fallback gracefully**: Use keyword-based discovery when AI is unavailable.

## See Also

- `src/shortcuts/ai-service/AGENTS.md` - AI process tracking
- `docs/designs/ai-discovery-design.md` - Detailed design documentation
