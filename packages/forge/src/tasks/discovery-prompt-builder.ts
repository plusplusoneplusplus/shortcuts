/**
 * Discovery Prompt Builder
 *
 * Pure-Node prompt builder for feature-folder discovery.
 * Builds a discovery request prompt from a feature description,
 * keywords, and scope parameters — no VS Code dependencies.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Input parameters for building a discovery prompt.
 */
export interface DiscoveryPromptInput {
    /** Description of the feature to discover related items for */
    featureDescription: string;
    /** Optional keywords to guide the search */
    keywords?: string[];
    /** Optional scope restricting which areas to search */
    scope?: DiscoveryScope;
    /** Workspace root path for context */
    workspaceRoot: string;
}

/**
 * Scope for discovery — which areas of the codebase to search.
 */
export interface DiscoveryScope {
    includeSourceFiles?: boolean;
    includeDocs?: boolean;
    includeConfigFiles?: boolean;
    includeGitHistory?: boolean;
    maxCommits?: number;
}

/**
 * A single discovered related item.
 */
export interface DiscoveredItem {
    name: string;
    path?: string;
    type: 'file' | 'commit';
    category: 'source' | 'test' | 'doc' | 'config' | 'commit';
    relevance: number;
    reason: string;
    hash?: string;
}

// ============================================================================
// Default scope
// ============================================================================

const DEFAULT_SCOPE: Required<DiscoveryScope> = {
    includeSourceFiles: true,
    includeDocs: true,
    includeConfigFiles: false,
    includeGitHistory: false,
    maxCommits: 50,
};

// ============================================================================
// Prompt Builder
// ============================================================================

/**
 * Build a discovery prompt for finding related files and commits.
 *
 * @param input - Discovery request parameters
 * @returns The prompt string to send to the AI
 */
export function buildDiscoveryPrompt(input: DiscoveryPromptInput): string {
    const scope = { ...DEFAULT_SCOPE, ...input.scope };

    const scopeParts: string[] = [];
    if (scope.includeSourceFiles) { scopeParts.push('source code files'); }
    if (scope.includeDocs) { scopeParts.push('documentation files'); }
    if (scope.includeConfigFiles) { scopeParts.push('configuration files'); }
    if (scope.includeGitHistory) { scopeParts.push(`recent git commits (up to ${scope.maxCommits})`); }

    const keywordsSection = input.keywords && input.keywords.length > 0
        ? `\nKeywords to guide the search: ${input.keywords.join(', ')}`
        : '';

    return `Discover files and commits related to this feature in the workspace at "${input.workspaceRoot}".

Feature description: ${input.featureDescription}${keywordsSection}

Search scope: ${scopeParts.join(', ') || 'source code files'}

For each related item found, return a JSON array with objects containing:
- "name": display name
- "path": file path relative to workspace root (for files) or null (for commits)
- "type": "file" or "commit"
- "category": one of "source", "test", "doc", "config", "commit"
- "relevance": 0-100 score
- "reason": one-sentence explanation of relevance
- "hash": commit hash (for commits only, null for files)

Return ONLY the JSON array, no other text.`;
}

/**
 * Parse discovery results from an AI response.
 *
 * @param response - Raw AI response string
 * @returns Array of discovered items (empty array on parse failure)
 */
export function parseDiscoveryResponse(response: string): DiscoveredItem[] {
    if (!response) {
        return [];
    }

    try {
        // Strip markdown code fences if present
        let cleaned = response.trim();
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.substring('```json'.length);
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.substring(3);
        }
        if (cleaned.endsWith('```')) {
            cleaned = cleaned.substring(0, cleaned.length - 3);
        }
        cleaned = cleaned.trim();

        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter(
                (item: any) =>
                    item &&
                    typeof item.name === 'string' &&
                    typeof item.type === 'string' &&
                    (item.type === 'file' || item.type === 'commit')
            )
            .map((item: any) => ({
                name: item.name,
                path: item.path ?? undefined,
                type: item.type as 'file' | 'commit',
                category: item.category ?? (item.type === 'commit' ? 'commit' : 'source'),
                relevance: typeof item.relevance === 'number' ? item.relevance : 50,
                reason: item.reason ?? '',
                hash: item.hash ?? undefined,
            }));
    } catch {
        return [];
    }
}
