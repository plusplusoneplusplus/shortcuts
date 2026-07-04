/**
 * whisperGroupModel — pure model construction for a WhisperCollapsedGroup.
 *
 * Turns a WhisperSummary into the ordered header parts (and their plain-text
 * form + duration) the collapsed header renders, and flattens the group's
 * preceding chunks into the reconstructable tool calls that back the file-diff
 * panels. Keeping this out of JSX makes the audit-critical counts (file edits,
 * deleted files, commits/fixups/pushes/PRs) and the diff replay source testable
 * without rendering the component.
 */

import type { WhisperSummary } from './toolGroupUtils';
import type { WhisperDiffToolCall } from './buildWhisperFileDiff';

export type WhisperHeaderPartKind =
    | 'commit' | 'fixup' | 'pr' | 'push' | 'file' | 'removed-file' | 'skill' | 'memory';

export interface WhisperHeaderPart {
    text: string;
    kind?: WhisperHeaderPartKind;
}

/** Minimal tool shape needed to reconstruct a group's diff source. */
export interface WhisperGroupTool {
    toolName: string;
    args?: Record<string, unknown>;
}

/** Minimal chunk shape needed to walk a group's captured tool calls. */
export interface WhisperGroupChunkLike {
    kind: string;
    toolId?: string;
    [key: string]: unknown;
}

/** Duration between two epoch-ms timestamps ('' when either is missing). */
export function formatWhisperDuration(startTime?: number, endTime?: number): string {
    if (startTime == null || endTime == null) return '';
    const ms = endTime - startTime;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Builds the ordered header parts for a collapsed group. Order is significant —
 * it is the reading order of the collapsed header — and mirrors the historical
 * inline construction exactly (tool calls · messages · files · removed ·
 * commits · fixups · PRs · pushed · skills · memories).
 */
export function buildWhisperHeaderParts(summary: WhisperSummary): WhisperHeaderPart[] {
    const parts: WhisperHeaderPart[] = [];
    if (summary.toolCallCount > 0) {
        parts.push({ text: `${summary.toolCallCount} tool call${summary.toolCallCount !== 1 ? 's' : ''}` });
    }
    if (summary.messageCount > 0) {
        parts.push({ text: `${summary.messageCount} message${summary.messageCount !== 1 ? 's' : ''}` });
    }
    if (summary.fileEditCount && summary.fileEditCount > 0) {
        const activeCount = summary.fileEditCount - (summary.deletedFileCount ?? 0);
        if (activeCount > 0) {
            parts.push({ text: `${activeCount} file${activeCount !== 1 ? 's' : ''}`, kind: 'file' });
        }
        if (summary.deletedFileCount && summary.deletedFileCount > 0) {
            parts.push({ text: `${summary.deletedFileCount} removed`, kind: 'removed-file' });
        }
    }
    if (summary.commitCount && summary.commitCount > 0) {
        parts.push({ text: `${summary.commitCount} commit${summary.commitCount !== 1 ? 's' : ''}`, kind: 'commit' });
    }
    if (summary.fixupCommitCount && summary.fixupCommitCount > 0) {
        parts.push({ text: `${summary.fixupCommitCount} fixup${summary.fixupCommitCount !== 1 ? 's' : ''}`, kind: 'fixup' });
    }
    if (summary.prCount && summary.prCount > 0) {
        parts.push({ text: `${summary.prCount} PR${summary.prCount !== 1 ? 's' : ''}`, kind: 'pr' });
    }
    if (summary.pushCount && summary.pushCount > 0) {
        parts.push({ text: `${summary.pushCount} pushed`, kind: 'push' });
    }
    if (summary.skillCount && summary.skillCount > 0) {
        parts.push({ text: `${summary.skillCount} skill${summary.skillCount !== 1 ? 's' : ''}`, kind: 'skill' });
    }
    if (summary.memoryCount && summary.memoryCount > 0) {
        parts.push({ text: `${summary.memoryCount} memor${summary.memoryCount !== 1 ? 'ies' : 'y'}`, kind: 'memory' });
    }
    return parts;
}

export interface WhisperGroupModel {
    /** Ordered summary chips shown in the collapsed header. */
    headerParts: WhisperHeaderPart[];
    /** Plain-text header (chips joined by ' · ' + optional duration) for the title attribute. */
    headerTextPlain: string;
    /** Formatted group duration ('' when unavailable). */
    duration: string;
}

/** Assemble the header model (parts + plain text + duration) for a group. */
export function buildWhisperGroupModel(summary: WhisperSummary): WhisperGroupModel {
    const headerParts = buildWhisperHeaderParts(summary);
    const duration = formatWhisperDuration(summary.startTime, summary.endTime);
    const headerTextPlain = headerParts.map(p => p.text).join(' · ') + (duration ? ` (${duration})` : '');
    return { headerParts, headerTextPlain, duration };
}

/**
 * Flattens a group's preceding chunks into the reconstructable tool calls used
 * as the primary diff source when a file row is clicked. Walks both standalone
 * `tool` chunks and `tool-group` chunks (via their `toolIds`), preserving order.
 */
export function collectGroupToolCalls(
    precedingChunks: readonly WhisperGroupChunkLike[],
    toolById: Map<string, WhisperGroupTool>,
): WhisperDiffToolCall[] {
    const calls: WhisperDiffToolCall[] = [];
    for (const c of precedingChunks) {
        if (c.kind === 'tool' && c.toolId) {
            const tool = toolById.get(c.toolId);
            if (tool) calls.push({ toolName: tool.toolName, args: tool.args });
        } else if (c.kind === 'tool-group' && Array.isArray((c as any).toolIds)) {
            for (const id of (c as any).toolIds as string[]) {
                const tool = toolById.get(id);
                if (tool) calls.push({ toolName: tool.toolName, args: tool.args });
            }
        }
    }
    return calls;
}
