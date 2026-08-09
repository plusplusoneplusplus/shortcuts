/**
 * Filter matching for the Dev Tools panel — pure, no React.
 *
 * A tool matches when the (trimmed, lowercased) query is a substring of its
 * name, its description, or any of its keywords. An empty query matches
 * everything.
 */

export interface FilterableTool {
    id: string;
    name: string;
    description: string;
    keywords: string[];
}

export function toolMatchesQuery(tool: FilterableTool, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (tool.name.toLowerCase().includes(q)) return true;
    if (tool.description.toLowerCase().includes(q)) return true;
    return tool.keywords.some(k => k.toLowerCase().includes(q));
}

export function filterTools<T extends FilterableTool>(tools: readonly T[], query: string): T[] {
    return tools.filter(tool => toolMatchesQuery(tool, query));
}
