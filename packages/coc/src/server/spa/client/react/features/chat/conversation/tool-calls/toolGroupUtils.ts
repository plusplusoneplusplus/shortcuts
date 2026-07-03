/**
 * toolGroupUtils — category types, classification helpers, and the
 * groupConsecutiveToolChunks algorithm for compact tool-call display.
 */
import type { DetectedCommit } from '../commitDetection';
import { detectCommitsInToolGroup } from '../commitDetection';
import { detectPullRequestsInToolGroup, type DetectedPullRequest } from '../pullRequestDetection';
import { detectPushesInToolGroup, type DetectedPush } from '../pushDetection';
import { getApplyPatchText, parseApplyPatchFileChanges } from '../../../../utils/applyPatchParser';
import { getCodexFileChanges, normalizeToolName } from './toolNormalization';

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
    apply_patch: 'write',
    powershell: 'shell',
    shell:      'shell',
    bash:       'shell',
};

export const CATEGORY_ICONS: Record<ToolGroupCategory, string> = {
    read:  '📖',
    write: '✏️',
    shell: '🖥️',
    agent: '🤖',
};

export function getToolGroupCategory(
    toolName: string,
    args?: unknown,
): ToolGroupCategory | null {
    const canonicalName = normalizeToolName(toolName);
    if (canonicalName === 'read_agent' && isRecord(args) && args.agent_id) return 'agent';
    return CATEGORY_MAP[canonicalName] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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
    args?: unknown;
    result?: string;
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
    /** Git commits detected in tool call results. */
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

function isVisibleAskUserTool(tool: ToolLike | undefined): boolean {
    if (!tool) return false;
    return normalizeToolName(tool.toolName) === 'ask_user'
        && (tool.status === 'completed' || tool.result !== undefined);
}

/**
 * Tools that may appear between the content chunks of a single trailing
 * assistant message without splitting it into separate messages. These are
 * either hidden at render time (suggest_follow_ups renders as chips,
 * report_intent renders as a pill) or are terminal markers (task_complete,
 * ask_user). When walking back to capture the final message in whisper mode,
 * we step over these instead of treating them as a message boundary.
 */
function isNonBreakingTrailingTool(tool: ToolLike | undefined): boolean {
    if (!tool) return false;
    const name = normalizeToolName(tool.toolName);
    return name === 'suggest_follow_ups'
        || name === 'report_intent'
        || name === 'task_complete'
        || name === 'ask_user';
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
            ? String(isRecord(tool.args) ? tool.args.agent_id ?? '' : '')
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
                    const nextAgentId = String(isRecord(nextTool.args) ? nextTool.args.agent_id ?? '' : '');
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
                                const afterAgentId = String(isRecord(afterTool.args) ? afterTool.args.agent_id ?? '' : '');
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

// ---------------------------------------------------------------------------
// Net diff computation — counts only actually changed lines via simple LCS
// ---------------------------------------------------------------------------

const NET_DIFF_LINE_LIMIT = 500;

/**
 * Computes the net insertions and deletions between two strings using a
 * line-level LCS diff. Unlike counting raw `old_str`/`new_str` line counts,
 * unchanged context lines are excluded from both counters.
 *
 * Falls back to raw line counts when either input exceeds `NET_DIFF_LINE_LIMIT`.
 */
export function computeNetDiff(
    oldStr: string,
    newStr: string,
): { insertions: number; deletions: number } {
    const oldLines = oldStr ? oldStr.split('\n') : [];
    const newLines = newStr ? newStr.split('\n') : [];

    // Fallback for very large blocks
    if (oldLines.length > NET_DIFF_LINE_LIMIT || newLines.length > NET_DIFF_LINE_LIMIT) {
        return { insertions: newLines.length, deletions: oldLines.length };
    }

    // Compute LCS length using Hunt-Szymanski style DP (O(n*m) space but fine for ≤500 lines)
    const m = oldLines.length;
    const n = newLines.length;
    // Use a 1D rolling DP to save memory
    const prev = new Array<number>(n + 1).fill(0);
    const curr = new Array<number>(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                curr[j] = prev[j - 1] + 1;
            } else {
                curr[j] = Math.max(prev[j], curr[j - 1]);
            }
        }
        for (let j = 0; j <= n; j++) {
            prev[j] = curr[j];
            curr[j] = 0;
        }
    }
    const lcsLen = prev[n];

    return {
        insertions: n - lcsLen,
        deletions: m - lcsLen,
    };
}

/**
 * Returns aggregate totals across an array of FileEdit entries.
 */
export function computeFileEditTotals(
    fileEdits: FileEdit[],
): { totalInsertions: number; totalDeletions: number } {
    let totalInsertions = 0;
    let totalDeletions = 0;
    for (const fe of fileEdits) {
        totalInsertions += fe.netInsertions ?? fe.insertions;
        totalDeletions += fe.netDeletions ?? fe.deletions;
    }
    return { totalInsertions, totalDeletions };
}

// ---------------------------------------------------------------------------
// Shell-command file-deletion detection
// ---------------------------------------------------------------------------

/** Normalize a path for matching: strip quotes, leading ./, convert backslashes. */
function normalizeForMatch(p: string): string {
    return p.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Extracts file paths targeted by common deletion commands in a shell command string.
 * Handles chained commands (&&, ||, ;) and skips flags.
 */
export function extractDeletedPathsFromCommand(command: string): string[] {
    const paths: string[] = [];
    // Split on common shell operators to handle chained commands
    const segments = command.split(/\s*(?:&&|\|\||[;|])\s*/);

    for (const seg of segments) {
        const trimmed = seg.trim();
        // Match common delete commands
        const match = trimmed.match(
            /^\s*(?:sudo\s+)?(?:rm|git\s+rm|del|Remove-Item|unlink)\s+(.*)/i,
        );
        if (!match) continue;

        // Tokenize the argument string, respecting quotes
        const argStr = match[1];
        const tokens = argStr.match(/(?:"[^"]*"|'[^']*'|\S)+/g) ?? [];
        for (const token of tokens) {
            const clean = token.replace(/^['"]|['"]$/g, '').trim();
            if (!clean) continue;
            // Skip flags: -f, --force, -rf, /f, /q, -Force, -Recurse, etc.
            if (/^-/.test(clean)) continue;
            if (/^\/[a-zA-Z]$/.test(clean)) continue;
            paths.push(normalizeForMatch(clean));
        }
    }
    return paths;
}

/**
 * Checks whether a path extracted from a delete command matches a tracked file path.
 * Uses suffix matching to handle relative vs absolute differences.
 */
export function isDeletePathMatch(deletedPath: string, trackedPath: string): boolean {
    const d = normalizeForMatch(deletedPath);
    const t = normalizeForMatch(trackedPath);
    if (!d || !t) return false;
    return t === d || t.endsWith('/' + d) || d.endsWith('/' + t);
}

/** Per-file edit/create statistics collected from tool calls. */
export interface FileEdit {
    path: string;
    /** @deprecated Use netInsertions for accurate counts */
    insertions: number;
    /** @deprecated Use netDeletions for accurate counts */
    deletions: number;
    /** Net changed lines (excluding unchanged context) — insertions. */
    netInsertions: number;
    /** Net changed lines (excluding unchanged context) — deletions. */
    netDeletions: number;
    isCreate: boolean;
    /** True when a subsequent shell command likely deleted this file. */
    isDeleted: boolean;
}

interface FileEditStats {
    insertions: number;
    deletions: number;
    netInsertions: number;
    netDeletions: number;
    hasCreate: boolean;
    hasEdit: boolean;
}

function getFileEditStats(fileMap: Map<string, FileEditStats>, filePath: string): FileEditStats {
    const existing = fileMap.get(filePath);
    if (existing) {
        return existing;
    }
    const entry = {
        insertions: 0,
        deletions: 0,
        netInsertions: 0,
        netDeletions: 0,
        hasCreate: false,
        hasEdit: false,
    };
    fileMap.set(filePath, entry);
    return entry;
}

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
    /** Non-fixup commits detected across all collapsed tool calls. */
    commits?: DetectedCommit[];
    /** Fixup/squash/amend commits detected across all collapsed tool calls. */
    fixupCommits?: DetectedCommit[];
    /** Number of pull requests detected across all collapsed tool calls. */
    prCount?: number;
    /** Pull requests detected across all collapsed tool calls. */
    pullRequests?: DetectedPullRequest[];
    /** Number of successful git pushes detected across all collapsed tool calls. */
    pushCount?: number;
    /** Successful git pushes detected across all collapsed tool calls. */
    pushes?: DetectedPush[];
    /** Number of unique skill invocations. */
    skillCount?: number;
    /** Names of unique skills invoked. */
    skillNames?: string[];
    /** Number of memory tool invocations. */
    memoryCount?: number;
    /** Details of memory tool invocations. */
    memoryActions?: Array<{ action: string; target: string; content?: string }>;
    /** Number of unique files edited or created. */
    fileEditCount?: number;
    /** Per-file edit/create statistics. */
    fileEdits?: FileEdit[];
    /** Number of files that were created/edited but later deleted. */
    deletedFileCount?: number;
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
 * plus the "tail" items (the final assistant message + any task_complete tool
 * calls).
 *
 * The final message is the last `content` chunk, plus any earlier content
 * chunks that are separated from it only by non-breaking trailing tools
 * (suggest_follow_ups, report_intent, task_complete, ask_user). This keeps a
 * rich final answer visible even when a hidden tool call (e.g.
 * suggest_follow_ups) splits it from a trivial closing line.
 *
 * Returns the original array unchanged if there are no preceding items to collapse.
 */
export function filterWhisperChunks(
    chunks: ToolChunk[],
    toolById: Map<string, ToolLike>,
): (ToolChunk | WhisperGroupChunk)[] {
    if (chunks.length === 0) return [];

    // Identify tail items:
    //  - The final assistant message (see below)
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
            if (tool && (tool.toolName === 'task_complete' || isVisibleAskUserTool(tool))) {
                taskCompleteIndices.add(i);
            }
        }
    }

    // Capture the whole final message: starting from the last content chunk,
    // walk backward absorbing additional content chunks, stepping over
    // non-breaking trailing tools, and stop at the first substantive tool /
    // tool-group (e.g. edit, shell) which marks the start of the final message.
    const finalMessageIndices = new Set<number>();
    if (lastContentIndex >= 0) {
        finalMessageIndices.add(lastContentIndex);
        for (let i = lastContentIndex - 1; i >= 0; i--) {
            const c = chunks[i];
            if (c.kind === 'content' && c.html) {
                finalMessageIndices.add(i);
                continue;
            }
            if (c.kind === 'tool' && c.toolId && isNonBreakingTrailingTool(toolById.get(c.toolId))) {
                continue;
            }
            break;
        }
    }

    const tailIndices = new Set<number>(taskCompleteIndices);
    for (const i of finalMessageIndices) tailIndices.add(i);

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
    const allToolCalls: Array<{ id: string; toolName: string; args?: unknown; result?: string; status?: string }> = [];
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
    const pullRequests = detectPullRequestsInToolGroup(allToolCalls);
    const prCount = pullRequests.length;
    const pushes = detectPushesInToolGroup(allToolCalls);
    const pushCount = pushes.length;

    // Count unique skill invocations
    const skillNameSet = new Set<string>();
    for (const tc of allToolCalls) {
        if (tc.toolName === 'skill' && isRecord(tc.args)) {
            const name = tc.args.skill || tc.args.name || tc.args.skill_name;
            if (typeof name === 'string' && name) {
                skillNameSet.add(name);
            }
        }
    }

    // Collect memory tool invocations
    const memoryActions: Array<{ action: string; target: string; content?: string }> = [];
    for (const tc of allToolCalls) {
        if (tc.toolName === 'memory' && isRecord(tc.args)) {
            const actionArg = tc.args.action;
            const targetArg = tc.args.target;
            const contentArg = tc.args.content ?? tc.args.old_text;
            const action = typeof actionArg === 'string' && actionArg ? actionArg : 'add';
            const target = typeof targetArg === 'string' && targetArg ? targetArg : 'memory';
            const content = typeof contentArg === 'string' ? contentArg : '';
            memoryActions.push({ action, target, ...(content ? { content } : {}) });
        }
    }

    // Count file edits/creates
    const fileMap = new Map<string, FileEditStats>();
    for (const tc of allToolCalls) {
        const toolName = normalizeToolName(tc.toolName);
        if (toolName === 'edit' && isRecord(tc.args)) {
            const pathArg = tc.args.path;
            const filePathArg = tc.args.filePath;
            const filePath = typeof pathArg === 'string' ? pathArg : (typeof filePathArg === 'string' ? filePathArg : '');
            if (filePath) {
                const entry = getFileEditStats(fileMap, filePath);
                entry.hasEdit = true;
                const oldArg = tc.args.old_str ?? tc.args.old_string;
                const newArg = tc.args.new_str ?? tc.args.new_string;
                const oldStr = typeof oldArg === 'string' ? oldArg : '';
                const newStr = typeof newArg === 'string' ? newArg : '';
                if (oldStr) entry.deletions += oldStr.split('\n').length;
                if (newStr) entry.insertions += newStr.split('\n').length;
                const net = computeNetDiff(oldStr, newStr);
                entry.netInsertions += net.insertions;
                entry.netDeletions += net.deletions;
            }
        } else if (toolName === 'create' && isRecord(tc.args)) {
            const pathArg = tc.args.path;
            const filePathArg = tc.args.filePath;
            const filePath = typeof pathArg === 'string' ? pathArg : (typeof filePathArg === 'string' ? filePathArg : '');
            if (filePath) {
                const entry = getFileEditStats(fileMap, filePath);
                entry.hasCreate = true;
                const fileText = typeof tc.args.file_text === 'string' ? tc.args.file_text : '';
                const lineCount = fileText ? fileText.split('\n').length : 0;
                entry.insertions += lineCount;
                entry.netInsertions += lineCount;
            }
        } else if (toolName === 'apply_patch') {
            const patchText = getApplyPatchText(tc.args);
            const patchChanges = patchText ? parseApplyPatchFileChanges(patchText) : [];
            if (patchChanges.length > 0) {
                for (const change of patchChanges) {
                    const entry = getFileEditStats(fileMap, change.path);
                    entry.insertions += change.insertions;
                    entry.deletions += change.deletions;
                    entry.netInsertions += change.insertions;
                    entry.netDeletions += change.deletions;
                    if (change.isCreate) {
                        entry.hasCreate = true;
                    } else {
                        entry.hasEdit = true;
                    }
                }
            } else {
                for (const change of getCodexFileChanges(tc.args)) {
                    const entry = getFileEditStats(fileMap, change.path);
                    if (change.kind === 'add') {
                        entry.hasCreate = true;
                    } else {
                        entry.hasEdit = true;
                    }
                }
            }
        }
    }

    // Detect file deletions from shell commands
    const deletedPaths = new Set<string>();
    if (fileMap.size > 0) {
        const trackedPaths = [...fileMap.keys()];
        for (const tc of allToolCalls) {
            const toolName = normalizeToolName(tc.toolName);
            if ((toolName === 'powershell' || toolName === 'shell' || toolName === 'bash') && tc.args) {
                const cmd = (tc.args.command || tc.args.cmd || '') as string;
                if (!cmd) continue;
                const extracted = extractDeletedPathsFromCommand(cmd);
                for (const dp of extracted) {
                    for (const tp of trackedPaths) {
                        if (isDeletePathMatch(dp, tp)) {
                            deletedPaths.add(tp);
                        }
                    }
                }
            }
        }
    }

    const fileEdits: FileEdit[] = [...fileMap.entries()]
        .map(([path, e]) => ({
            path,
            insertions: e.insertions,
            deletions: e.deletions,
            netInsertions: e.netInsertions,
            netDeletions: e.netDeletions,
            isCreate: e.hasCreate && !e.hasEdit,
            isDeleted: deletedPaths.has(path),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));

    const deletedFileCount = fileEdits.filter(f => f.isDeleted).length;

    const summary: WhisperSummary = {
        toolCallCount,
        messageCount,
        ...(commitCount > 0 ? { commitCount, commits: regularCommits } : {}),
        ...(fixupCommitCount > 0 ? { fixupCommitCount, fixupCommits } : {}),
        ...(prCount > 0 ? { prCount, pullRequests } : {}),
        ...(pushCount > 0 ? { pushCount, pushes } : {}),
        ...(skillNameSet.size > 0 ? { skillCount: skillNameSet.size, skillNames: [...skillNameSet].sort() } : {}),
        ...(memoryActions.length > 0 ? { memoryCount: memoryActions.length, memoryActions } : {}),
        ...(fileEdits.length > 0 ? { fileEditCount: fileEdits.length, fileEdits } : {}),
        ...(deletedFileCount > 0 ? { deletedFileCount } : {}),
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
