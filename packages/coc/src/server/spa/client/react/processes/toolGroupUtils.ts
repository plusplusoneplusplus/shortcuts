/**
 * toolGroupUtils — category types, classification helpers, and the
 * groupConsecutiveToolChunks algorithm for compact tool-call display.
 */
import type { DetectedCommit } from './commitDetection';
import { detectCommitsInToolGroup } from './commitDetection';

export type ToolGroupCategory = 'read' | 'write' | 'shell' | 'agent';

export interface GroupContentItem {
    key: string;
    html: string;
}

/** A single item in the interleaved rendering order of a tool group. */
export type GroupOrderedItem =
    | { type: 'tool'; toolId: string }
    | { type: 'content'; key: string; html: string };

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
    agent: '🤖',
};

export function getToolGroupCategory(
    toolName: string,
    args?: Record<string, unknown>,
): ToolGroupCategory | null {
    if (toolName === 'read_agent' && args?.agent_id) return 'agent';
    return CATEGORY_MAP[toolName] ?? null;
}

/**
 * Produces a human-readable summary string, e.g. `"4 read operations (glob×1, view×3)"`.
 * @param category - the group category
 * @param counts   - map of toolName → occurrence count within the group
 */
export function getCategoryLabel(
    category: ToolGroupCategory,
    counts: Record<string, number>,
    agentId?: string,
): string {
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    if (category === 'agent') {
        const id = agentId ?? 'unknown';
        return `${total} poll${total !== 1 ? 's' : ''} → ${id}`;
    }
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
    args?: Record<string, unknown>;
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
    /** Absorbed single-line content messages (rendered inline when expanded). */
    contentItems: GroupContentItem[];
    /** Interleaved order of tools and absorbed content for faithful rendering. */
    orderedItems: GroupOrderedItem[];
    startTime?: number;
    endTime?: number;
    allSucceeded: boolean;
    parentToolId?: string;
    /** Set when category === 'agent' — the shared agent_id for the group. */
    agentId?: string;
    /** Git commits detected in shell tool call results. */
    commits?: DetectedCommit[];
}

function parseMs(iso: string): number {
    return new Date(iso).getTime();
}

/**
 * Returns true when the HTML represents a single visual line of content.
 * Strips tags and checks that the remaining text contains no newlines.
 */
export function isSingleLineHtml(html: string | undefined): boolean {
    if (!html) return false;
    const text = html.replace(/<[^>]*>/g, '').trim();
    return text.length > 0 && !text.includes('\n');
}

export interface GroupOptions {
    groupSingleLineMessages?: boolean;
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
    parentToolIds: Set<string>,
    options?: GroupOptions
): (ToolChunk | ToolGroupChunk)[] {
    const result: (ToolChunk | ToolGroupChunk)[] = [];
    const groupMessages = options?.groupSingleLineMessages ?? false;
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

        const category = getToolGroupCategory(tool.toolName, tool.args);
        if (!category) {
            result.push(chunk);
            i++;
            continue;
        }

        // For agent polling groups, track the shared agent_id
        const runAgentId = category === 'agent'
            ? String(tool.args?.agent_id ?? '')
            : undefined;

        // Start a run
        const run: ToolChunk[] = [chunk];
        const absorbedContent: GroupContentItem[] = [];
        const orderedItems: GroupOrderedItem[] = [{ type: 'tool', toolId: chunk.toolId }];
        let j = i + 1;

        while (j < chunks.length) {
            const next = chunks[j];

            // Same-category tool — extend the run
            if (next.kind === 'tool' && next.toolId) {
                const nextTool = toolById.get(next.toolId);
                if (!nextTool || parentToolIds.has(next.toolId)) break;
                const nextCat = getToolGroupCategory(nextTool.toolName, nextTool.args);
                if (nextCat !== category) break;
                if (next.parentToolId !== chunk.parentToolId) break;
                // For agent groups, also require matching agent_id
                if (category === 'agent') {
                    const nextAgentId = String(nextTool.args?.agent_id ?? '');
                    if (nextAgentId !== runAgentId) break;
                }
                run.push(next);
                orderedItems.push({ type: 'tool', toolId: next.toolId });
                j++;
                continue;
            }

            // Single-line content between same-category tools — try to absorb
            if (
                groupMessages &&
                next.kind === 'content' &&
                next.html &&
                isSingleLineHtml(next.html)
            ) {
                const afterIdx = j + 1;
                if (afterIdx < chunks.length) {
                    const after = chunks[afterIdx];
                    if (after.kind === 'tool' && after.toolId) {
                        const afterTool = toolById.get(after.toolId);
                        if (
                            afterTool &&
                            !parentToolIds.has(after.toolId) &&
                            getToolGroupCategory(afterTool.toolName, afterTool.args) === category &&
                            after.parentToolId === chunk.parentToolId
                        ) {
                            // For agent groups, also require matching agent_id
                            if (category === 'agent') {
                                const afterAgentId = String(afterTool.args?.agent_id ?? '');
                                if (afterAgentId !== runAgentId) break;
                            }
                            const contentItem = { key: next.key, html: next.html as string };
                            absorbedContent.push(contentItem);
                            orderedItems.push({ type: 'content', ...contentItem });
                            run.push(after);
                            orderedItems.push({ type: 'tool', toolId: after.toolId });
                            j = afterIdx + 1;
                            continue;
                        }
                    }
                }
            }

            break;
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
            kind:           'tool-group',
            key:            `group-${run[0].key}`,
            category,
            toolIds,
            contentItems:   absorbedContent,
            orderedItems,
            startTime:      startTimes.length ? Math.min(...startTimes) : undefined,
            endTime:        allEnded && endTimes.length ? Math.max(...endTimes) : undefined,
            allSucceeded:   tools.every(t => t.status === 'completed'),
            parentToolId:   chunk.parentToolId,
            ...(runAgentId ? { agentId: runAgentId } : {}),
        });
        i = j;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Whisper-level (level 3) filtering
// ---------------------------------------------------------------------------

/**
 * Summary of the "preceding" chunks that Whisper mode collapses.
 */
export interface WhisperSummary {
    toolCallCount: number;
    messageCount: number;
    /** Number of non-fixup commits detected across all collapsed tool calls. */
    commitCount?: number;
    /** Number of fixup/squash/amend commits detected. */
    fixupCommitCount?: number;
    /** Number of unique skill invocations. */
    skillCount?: number;
    /** Names of unique skills invoked. */
    skillNames?: string[];
    /** Epoch ms — earliest startTime among all tool calls. */
    startTime?: number;
    /** Epoch ms — latest endTime among all tool calls (undefined if any still running). */
    endTime?: number;
}

export interface WhisperGroupChunk {
    kind: 'whisper-group';
    key: string;
    /** Chunks hidden behind the collapsed summary. */
    precedingChunks: ToolChunk[];
    summary: WhisperSummary;
}

/**
 * Partitions an array of chunks into a single collapsed Whisper summary group
 * plus the "tail" items (last content chunk + any task_complete tool calls).
 *
 * Returns the original array unchanged if there are no preceding items to collapse.
 */
export function filterWhisperChunks(
    chunks: ToolChunk[],
    toolById: Map<string, ToolLike>,
): (ToolChunk | WhisperGroupChunk)[] {
    if (chunks.length === 0) return [];

    // Identify tail items:
    //  - The last chunk with kind === 'content' and non-empty html
    //  - Any chunk whose tool is task_complete
    let lastContentIndex = -1;
    const taskCompleteIndices = new Set<number>();

    for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        if (c.kind === 'content' && c.html && lastContentIndex === -1) {
            lastContentIndex = i;
        }
        if (c.kind === 'tool' && c.toolId) {
            const tool = toolById.get(c.toolId);
            if (tool && tool.toolName === 'task_complete') {
                taskCompleteIndices.add(i);
            }
        }
    }

    const tailIndices = new Set<number>(taskCompleteIndices);
    if (lastContentIndex >= 0) tailIndices.add(lastContentIndex);

    const preceding: ToolChunk[] = [];
    const tail: ToolChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
        if (tailIndices.has(i)) {
            tail.push(chunks[i]);
        } else {
            preceding.push(chunks[i]);
        }
    }

    // Nothing to collapse — return tail as-is
    if (preceding.length === 0) return tail;

    // Build summary counts
    let toolCallCount = 0;
    let messageCount = 0;
    const startTimes: number[] = [];
    const endTimes: number[] = [];
    let allEnded = true;

    for (const c of preceding) {
        if (c.kind === 'content' && c.html) {
            messageCount++;
        } else if (c.kind === 'tool' && c.toolId) {
            toolCallCount++;
            const tool = toolById.get(c.toolId);
            if (tool?.startTime) startTimes.push(new Date(tool.startTime).getTime());
            if (tool?.endTime) endTimes.push(new Date(tool.endTime).getTime());
            else allEnded = false;
        } else if (c.kind === 'tool-group' && (c as any).toolIds) {
            const ids = (c as any).toolIds as string[];
            toolCallCount += ids.length;
            for (const id of ids) {
                const tool = toolById.get(id);
                if (tool?.startTime) startTimes.push(new Date(tool.startTime).getTime());
                if (tool?.endTime) endTimes.push(new Date(tool.endTime).getTime());
                else allEnded = false;
            }
        }
    }

    // Count unique commits across all preceding tool calls
    const allToolCalls: Array<{ id: string; toolName: string; args?: any; result?: string; status?: string }> = [];
    for (const c of preceding) {
        if (c.kind === 'tool' && c.toolId) {
            const tool = toolById.get(c.toolId);
            if (tool) {
                allToolCalls.push({
                    id: c.toolId,
                    toolName: tool.toolName,
                    args: tool.args,
                    result: tool.result,
                    status: tool.status,
                });
            }
        } else if (c.kind === 'tool-group' && (c as any).toolIds) {
            for (const id of (c as any).toolIds as string[]) {
                const tool = toolById.get(id);
                if (tool) {
                    allToolCalls.push({
                        id,
                        toolName: tool.toolName,
                        args: tool.args,
                        result: tool.result,
                        status: tool.status,
                    });
                }
            }
        }
    }
    const detectedCommits = detectCommitsInToolGroup(allToolCalls);
    const regularCommits = detectedCommits.filter(c => !c.isFixup);
    const fixupCommits = detectedCommits.filter(c => c.isFixup);
    const commitCount = regularCommits.length;
    const fixupCommitCount = fixupCommits.length;

    // Count unique skill invocations
    const skillNameSet = new Set<string>();
    for (const tc of allToolCalls) {
        if (tc.toolName === 'skill' && tc.args) {
            const name = tc.args.skill || tc.args.name || tc.args.skill_name;
            if (typeof name === 'string' && name) {
                skillNameSet.add(name);
            }
        }
    }

    const summary: WhisperSummary = {
        toolCallCount,
        messageCount,
        ...(commitCount > 0 ? { commitCount } : {}),
        ...(fixupCommitCount > 0 ? { fixupCommitCount } : {}),
        ...(skillNameSet.size > 0 ? { skillCount: skillNameSet.size, skillNames: [...skillNameSet].sort() } : {}),
        startTime: startTimes.length ? Math.min(...startTimes) : undefined,
        endTime: allEnded && endTimes.length ? Math.max(...endTimes) : undefined,
    };

    const whisperGroup: WhisperGroupChunk = {
        kind: 'whisper-group',
        key: 'whisper-group-0',
        precedingChunks: preceding,
        summary,
    };

    return [whisperGroup, ...tail];
}
