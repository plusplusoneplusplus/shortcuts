/**
 * toolGroupUtils — category types, classification helpers, and the
 * groupConsecutiveToolChunks algorithm for compact tool-call display.
 */

export type ToolGroupCategory = 'read' | 'write' | 'shell';

/**
 * Maps each known tool name to its grouping category.
 * Tools not listed here return null from getToolGroupCategory and are never grouped.
 */
export const CATEGORY_MAP: Record<string, ToolGroupCategory> = {
    view:       'read',
    glob:       'read',
    grep:       'read',
    edit:       'write',
    create:     'write',
    powershell: 'shell',
    shell:      'shell',
};

export const CATEGORY_ICONS: Record<ToolGroupCategory, string> = {
    read:  '📖',
    write: '✏️',
    shell: '🖥️',
};

export function getToolGroupCategory(toolName: string): ToolGroupCategory | null {
    return CATEGORY_MAP[toolName] ?? null;
}

/**
 * Produces a human-readable summary string, e.g. `"4 read operations (glob×1, view×3)"`.
 * @param category - the group category
 * @param counts   - map of toolName → occurrence count within the group
 */
export function getCategoryLabel(
    category: ToolGroupCategory,
    counts: Record<string, number>
): string {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    const detail = Object.entries(counts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, n]) => `${name}×${n}`)
        .join(', ');
    const noun = category === 'shell' ? 'shell operations' : `${category} operations`;
    return detail ? `${total} ${noun} (${detail})` : `${total} ${noun}`;
}

/**
 * Derives the status icon and an optional summary string for a tool group.
 * Partial failure (some failed + some succeeded) → ❓ with counts.
 */
export interface ToolGroupStatus {
    icon: string;
    summary: string | null;
}

export function getToolGroupStatus(
    statuses: (string | undefined)[]
): ToolGroupStatus {
    const failedCount = statuses.filter(s => s === 'failed').length;
    const succeededCount = statuses.filter(s => s === 'completed').length;

    if (failedCount > 0 && succeededCount > 0) {
        return {
            icon: '❓',
            summary: `${failedCount} failed, ${succeededCount} succeeded`,
        };
    }
    if (failedCount > 0) {
        return { icon: '❌', summary: null };
    }
    if (succeededCount === statuses.length && statuses.length > 0) {
        return { icon: '✅', summary: null };
    }
    return { icon: '🔄', summary: null };
}

interface ToolLike {
    toolName: string;
    status?: string;
    startTime?: string;
    endTime?: string;
}

interface ToolChunk {
    kind: string;
    key: string;
    toolId?: string;
    parentToolId?: string;
    [key: string]: unknown;
}

interface ToolGroupChunk {
    kind: 'tool-group';
    key: string;
    category: ToolGroupCategory;
    toolIds: string[];
    startTime?: number;
    endTime?: number;
    allSucceeded: boolean;
    parentToolId?: string;
}

function parseMs(iso: string): number {
    return new Date(iso).getTime();
}

/**
 * Collapses runs of same-category sibling tool chunks into single `tool-group` chunks.
 *
 * Grouping rules:
 * - Only `kind === 'tool'` chunks are candidates.
 * - A tool chunk is eligible if its toolId resolves in toolById, the tool's name maps to
 *   a non-null category, and the tool's id is NOT in parentToolIds (no children).
 * - Adjacent eligible chunks form a run only if they share the same category AND parentToolId.
 * - A run of length ≥ 2 is collapsed; a run of 1 is emitted as-is.
 */
export function groupConsecutiveToolChunks(
    chunks: ToolChunk[],
    toolById: Map<string, ToolLike>,
    parentToolIds: Set<string>
): (ToolChunk | ToolGroupChunk)[] {
    const result: (ToolChunk | ToolGroupChunk)[] = [];
    let i = 0;

    while (i < chunks.length) {
        const chunk = chunks[i];

        if (chunk.kind !== 'tool' || !chunk.toolId) {
            result.push(chunk);
            i++;
            continue;
        }

        const tool = toolById.get(chunk.toolId);
        if (!tool || parentToolIds.has(chunk.toolId)) {
            result.push(chunk);
            i++;
            continue;
        }

        const category = getToolGroupCategory(tool.toolName);
        if (!category) {
            result.push(chunk);
            i++;
            continue;
        }

        // Start a run
        const run: ToolChunk[] = [chunk];
        let j = i + 1;

        while (j < chunks.length) {
            const next = chunks[j];
            if (next.kind !== 'tool' || !next.toolId) break;
            const nextTool = toolById.get(next.toolId);
            if (!nextTool || parentToolIds.has(next.toolId)) break;
            const nextCat = getToolGroupCategory(nextTool.toolName);
            if (nextCat !== category) break;
            if (next.parentToolId !== chunk.parentToolId) break;
            run.push(next);
            j++;
        }

        if (run.length < 2) {
            result.push(chunk);
            i++;
            continue;
        }

        // Build group chunk
        const toolIds = run.map(c => c.toolId as string);
        const tools = toolIds.map(id => toolById.get(id)!);

        const startTimes = tools.flatMap(t => t.startTime ? [parseMs(t.startTime)] : []);
        const endTimes   = tools.flatMap(t => t.endTime   ? [parseMs(t.endTime)]   : []);
        const allEnded   = tools.every(t => t.endTime);

        result.push({
            kind:         'tool-group',
            key:          `group-${run[0].key}`,
            category,
            toolIds,
            startTime:    startTimes.length ? Math.min(...startTimes) : undefined,
            endTime:      allEnded && endTimes.length ? Math.max(...endTimes) : undefined,
            allSucceeded: tools.every(t => t.status === 'completed'),
            parentToolId: chunk.parentToolId,
        });
        i = j;
    }

    return result;
}
