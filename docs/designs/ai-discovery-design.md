# AI-Powered Feature Discovery

## Overview

Replace keyword-based discovery with true AI-powered semantic search to find all documentation, source code, tests, and recent commits related to a feature.

## Current State

The existing "Auto AI Discovery" uses:
- Regex-based keyword extraction
- File glob/grep matching
- Git log grep
- Heuristic scoring

**Limitations:**
- Misses semantically related files (e.g., "auth" won't find "login", "session", "JWT")
- No understanding of code structure or relationships
- Can't reason about what's actually relevant

---

## Proposed Architecture (Simplified)

Copilot CLI (Claude Code) has built-in tools for file search, grep, git, etc.
Instead of orchestrating multiple phases, we delegate everything to a single AI call.

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Input                                │
│           "Find everything related to RocksDB integration"       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Single Copilot CLI Call                       │
│                                                                  │
│  The AI agent autonomously:                                      │
│                                                                  │
│  1. Understands the feature semantically                         │
│  2. Decides what search terms/patterns to use                    │
│  3. Runs glob/grep to find source files                         │
│  4. Runs git log/git show to find commits                       │
│  5. Reads and analyzes relevant files                           │
│  6. Ranks results by actual relevance                           │
│  7. Returns structured JSON                                      │
│                                                                  │
│  Built-in tools available to Copilot CLI:                       │
│  - Glob: find files by pattern                                  │
│  - Grep: search file contents                                   │
│  - Read: read file contents                                     │
│  - Bash: run git commands                                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Structured JSON Response                    │
│                                                                  │
│  {                                                               │
│    "feature": "RocksDB integration",                            │
│    "summary": "Found 15 related items across storage module",   │
│    "results": [                                                  │
│      {                                                           │
│        "type": "source",                                        │
│        "path": "src/storage/rocks.rs",                          │
│        "relevance": 95,                                         │
│        "reason": "Core RocksDB wrapper implementation",         │
│        "highlights": ["impl RocksDB", "fn open_db"]            │
│      },                                                          │
│      {                                                           │
│        "type": "test",                                          │
│        "path": "tests/storage_test.rs",                         │
│        "relevance": 88,                                         │
│        "reason": "Integration tests for storage layer"         │
│      },                                                          │
│      {                                                           │
│        "type": "commit",                                        │
│        "hash": "abc1234",                                       │
│        "message": "feat: add RocksDB compaction config",        │
│        "relevance": 90,                                         │
│        "reason": "Recent feature addition to RocksDB setup"    │
│      }                                                           │
│    ]                                                             │
│  }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Extension Displays Results                    │
│                                                                  │
│  📁 Source Files (5)                                            │
│     src/storage/rocks.rs (95%) - Core RocksDB wrapper           │
│     src/storage/config.rs (85%) - DB configuration              │
│                                                                  │
│  🧪 Tests (3)                                                   │
│     tests/storage_test.rs (88%) - Integration tests             │
│                                                                  │
│  📝 Commits (4)                                                 │
│     abc1234 (90%) - feat: add RocksDB compaction config         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why This Is Better

| Multi-Phase (Original) | Single AI Call (Simplified) |
|------------------------|----------------------------|
| 4-6 separate AI calls | 1 AI call |
| We orchestrate tool use | AI orchestrates itself |
| Fixed search strategy | AI adapts strategy to feature |
| Parse multiple responses | Parse one JSON response |
| Complex error handling | Simple error handling |
| ~$0.20, 15-40s | ~$0.10-0.30, 20-60s |

## Detailed Design

### The Prompt

```typescript
const DISCOVERY_PROMPT = `
You are a code exploration agent. Find all files and commits related to a feature.

## Feature to find
{{featureDescription}}

## Instructions

1. First, think about what search terms would find this feature:
   - Direct terms (exact matches)
   - Semantic terms (related concepts)
   - Code patterns (function names, types, modules)

2. Search the codebase:
   - Use Grep to search for relevant terms in source files
   - Use Glob to find files in likely locations
   - Use Bash to run: git log --oneline -n 50 --grep="<term>"
   - Read promising files to verify relevance

3. For each result, assess:
   - How directly related is it? (core implementation vs tangential)
   - What role does it play? (source, test, doc, config, commit)

4. Return ONLY a JSON object (no markdown, no explanation):

{
  "feature": "{{featureDescription}}",
  "summary": "Brief summary of what you found",
  "results": [
    {
      "type": "source|test|doc|config|commit",
      "path": "relative/path/to/file.rs",
      "hash": "abc1234",  // only for commits
      "message": "commit message",  // only for commits
      "relevance": 95,  // 0-100
      "reason": "Why this is relevant (1 sentence)",
      "category": "core|supporting|related|tangential"
    }
  ]
}

## Constraints
- Maximum 30 results
- Minimum relevance score: 40
- Sort by relevance (highest first)
- Include at least: source files, tests (if found), recent commits
`;
```

### Implementation

```typescript
// src/shortcuts/discovery/ai-discovery-engine.ts

import { invokeCopilotCLI } from '../ai-service';

interface AIDiscoveryResult {
    feature: string;
    summary: string;
    results: DiscoveryItem[];
}

interface DiscoveryItem {
    type: 'source' | 'test' | 'doc' | 'config' | 'commit';
    path?: string;
    hash?: string;
    message?: string;
    relevance: number;
    reason: string;
    category: 'core' | 'supporting' | 'related' | 'tangential';
}

export async function discoverWithAI(
    featureDescription: string,
    workspaceRoot: string,
    processManager: AIProcessManager
): Promise<AIDiscoveryResult> {
    // Build prompt
    const prompt = DISCOVERY_PROMPT.replace(
        /\{\{featureDescription\}\}/g,
        featureDescription
    );

    // Register process for tracking
    const processId = processManager.registerDiscoveryProcess({
        featureDescription,
        keywords: undefined,  // AI extracts its own
        targetGroupPath: undefined,
        scope: { includeSourceFiles: true, includeDocs: true,
                 includeConfigFiles: true, includeGitHistory: true }
    });

    try {
        // Single AI call - it handles all searching internally
        const result = await invokeCopilotCLI(prompt, workspaceRoot);

        if (!result.success) {
            throw new Error(result.error || 'AI discovery failed');
        }

        // Parse JSON from response
        const parsed = parseDiscoveryResponse(result.response);

        // Update process as completed
        processManager.completeDiscoveryProcess(
            processId,
            parsed.results.length,
            parsed.summary
        );

        return parsed;

    } catch (error) {
        processManager.failProcess(processId, String(error));
        throw error;
    }
}

function parseDiscoveryResponse(response: string): AIDiscoveryResult {
    // Extract JSON from response (handle markdown code blocks if present)
    let jsonStr = response;

    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
        jsonStr = jsonMatch[1];
    }

    // Try to find JSON object
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
        throw new Error('No JSON object found in AI response');
    }

    return JSON.parse(objectMatch[0]);
}
```

### Invoking Copilot CLI with Tool Access

The key insight: Copilot CLI runs as an agent with access to:
- `Glob` - find files by pattern
- `Grep` - search file contents
- `Read` - read file contents
- `Bash` - run shell commands (git log, etc.)

When we call `copilot -p "prompt"`, the AI can use these tools multiple times before returning.

```typescript
// Current implementation in copilot-cli-invoker.ts
function buildCopilotCommand(prompt: string): string {
    const escapedPrompt = escapeShellArg(prompt);
    const model = getAIModelSetting();

    if (model) {
        return `copilot --allow-all-tools --model ${model} -p ${escapedPrompt}`;
    }

    // --allow-all-tools lets the AI use grep, glob, bash, etc.
    return `copilot --allow-all-tools -p ${escapedPrompt}`;
}
```

### Progress Tracking

Since it's a single long-running call, we can't show detailed phase progress.
Options:

1. **Simple spinner**: "AI is exploring the codebase..."
2. **Timeout warning**: Show elapsed time, warn if taking too long
3. **Streaming output**: Parse tool calls from stdout to show progress (advanced)

```typescript
// Option 1: Simple progress
vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'AI Discovery',
    cancellable: true
}, async (progress, token) => {
    progress.report({ message: 'Exploring codebase...' });

    const result = await discoverWithAI(feature, workspaceRoot, processManager);

    progress.report({ message: `Found ${result.results.length} items` });
    return result;
});
```

## Configuration Options

```typescript
interface AIDiscoveryConfig {
    // AI Settings
    enabled: boolean;                 // Feature flag
    model?: string;                   // Model to use (optional)
    timeout: number;                  // Max wait time (default: 120s)

    // Result Settings
    maxResults: number;               // Cap on results (default: 30)
    minRelevance: number;             // Filter threshold (default: 40)

    // Scope Hints (passed to AI in prompt)
    focusAreas?: string[];            // Directories to prioritize
    excludePatterns?: string[];       // Patterns to skip
}
```

## Cost & Performance

| Metric | Estimate |
|--------|----------|
| AI calls | 1 |
| Tool calls by AI | 10-30 (grep, glob, read, bash) |
| Tokens | 10K-50K (depends on codebase) |
| Cost | $0.10-0.50 |
| Duration | 30-120s |

## Comparison: Current vs AI-Powered

| Aspect | Current (Keyword) | AI-Powered |
|--------|-------------------|------------|
| Search strategy | Fixed regex | AI-determined |
| Semantic understanding | None | Full |
| "auth" finds "login" | No | Yes |
| Relevance scoring | Heuristic | AI reasoning |
| Explanation | None | Per-result |
| Speed | 1-3s | 30-120s |
| Cost | $0 | $0.10-0.50 |
| Accuracy | Low-Medium | High |

## Implementation Checklist

- [ ] Create `ai-discovery-engine.ts` with simplified implementation
- [ ] Add JSON parsing with error recovery
- [ ] Add configuration options
- [ ] Update progress UI for long-running single call
- [ ] Add timeout handling
- [ ] Update preview panel to show AI explanations
- [ ] Add "retry" option if AI returns poor results
- [ ] Consider streaming output parsing for progress

## Open Questions

1. **Fallback**: If AI discovery fails/times out, should we fall back to keyword search?

2. **Caching**: Should we cache results? For how long? Invalidate on file changes?

3. **Cost visibility**: Show estimated cost before running? Track cumulative usage?

4. **Hybrid mode**: Quick keyword search first, then AI refinement?
