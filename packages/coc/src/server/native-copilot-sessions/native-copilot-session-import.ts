/**
 * Explicit import of a native Copilot CLI session into a workspace's CoC chat
 * list. The import snapshots the reconstructed transcript into a new, idle
 * `chat` process bound to the native session id, so follow-ups resume that
 * native session through the normal per-turn resume path. Native data in
 * `~/.copilot` is only read, never modified.
 */

import type {
    AIProcess,
    ConversationTurn,
    ProcessStore,
    TimelineItem,
    ToolCall,
} from '@plusplusoneplusplus/forge';
import { generateTaskId, toQueueProcessId } from '@plusplusoneplusplus/forge';
import type {
    NativeCopilotSessionDetail,
    ReconstructedConversationTurn,
    ReconstructedTimelineItem,
    ReconstructedToolCall,
} from '@plusplusoneplusplus/coc-client';

/** Provenance recorded on an imported chat as `metadata.importedFrom`. */
export interface ImportedFromMetadata {
    provider: 'copilot';
    nativeSessionId: string;
    importedAt: string;
}

const PREVIEW_MAX = 80;

function truncate(text: string, max = PREVIEW_MAX): string {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > max ? `${trimmed.substring(0, max - 3)}...` : trimmed;
}

function toDate(value: string | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function toArgs(args: unknown): Record<string, unknown> {
    return args && typeof args === 'object' && !Array.isArray(args)
        ? args as Record<string, unknown>
        : args === undefined ? {} : { value: args };
}

function toToolCall(call: ReconstructedToolCall, fallback: Date): ToolCall {
    return {
        id: call.id,
        name: call.toolName,
        status: call.status,
        startTime: toDate(call.startTime, fallback),
        ...(call.endTime ? { endTime: toDate(call.endTime, fallback) } : {}),
        args: toArgs(call.args),
        ...(call.result !== undefined ? { result: call.result } : {}),
        ...(call.error !== undefined ? { error: call.error } : {}),
    };
}

function toTimelineItem(item: ReconstructedTimelineItem, fallback: Date): TimelineItem {
    return {
        type: item.type,
        timestamp: toDate(item.timestamp, fallback),
        ...(item.content !== undefined ? { content: item.content } : {}),
        ...(item.toolCall ? { toolCall: toToolCall(item.toolCall, fallback) } : {}),
    };
}

/**
 * Readable reasoning rendered as a markdown blockquote. CoC turns have no
 * reasoning slot, so it is folded into the assistant content stream — the same
 * shape the read-only Native Sessions detail view renders.
 */
function thinkingToMarkdown(thinking: string): string {
    const quoted = thinking
        .split('\n')
        .map(line => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n');
    return `> 🧠 **Reasoning**\n>\n${quoted}\n\n`;
}

/** Convert the parser's reconstructed turns into persisted CoC conversation turns. */
export function toImportedConversationTurns(
    conversation: ReconstructedConversationTurn[],
    fallbackTime: Date,
): ConversationTurn[] {
    let lastTime = fallbackTime;
    return conversation.map((turn, index) => {
        const timestamp = toDate(turn.timestamp, lastTime);
        lastTime = timestamp;
        const timeline = (turn.timeline ?? []).map(item => toTimelineItem(item, timestamp));
        let content = turn.content ?? '';
        if (turn.role === 'assistant' && turn.thinking) {
            const reasoning = thinkingToMarkdown(turn.thinking);
            timeline.unshift({ type: 'content', timestamp, content: reasoning });
            content = `${reasoning}${content}`;
        }
        return {
            role: turn.role,
            content,
            timestamp,
            turnIndex: index,
            timeline,
            provider: 'copilot',
            ...(turn.toolCalls && turn.toolCalls.length > 0
                ? { toolCalls: turn.toolCalls.map(call => toToolCall(call, timestamp)) }
                : {}),
            ...(turn.images && turn.images.length > 0 ? { images: turn.images } : {}),
            ...(turn.model ? { model: turn.model } : {}),
        };
    });
}

export interface BuildImportedChatProcessInput {
    workspaceId: string;
    /** Target workspace root; the imported chat runs follow-ups here. */
    workingDirectory?: string;
    session: NativeCopilotSessionDetail;
    now?: Date;
    processId?: string;
}

/** Build the idle, completed `chat` process that represents an imported session. */
export function buildImportedCopilotChatProcess(input: BuildImportedChatProcessInput): AIProcess {
    const now = input.now ?? new Date();
    const { session } = input;
    const turns = toImportedConversationTurns(session.conversation ?? [], now);
    const firstUser = turns.find(turn => turn.role === 'user')?.content ?? '';
    const lastModel = [...turns].reverse().find(turn => turn.model)?.model;
    const summary = session.summary?.trim() || firstUser || `Copilot session ${session.id}`;
    const startTime = toDate(session.createdAt ?? undefined, turns[0]?.timestamp ?? now);
    const endTime = toDate(session.updatedAt ?? undefined, turns[turns.length - 1]?.timestamp ?? now);
    const importedFrom: ImportedFromMetadata = {
        provider: 'copilot',
        nativeSessionId: session.id,
        importedAt: now.toISOString(),
    };
    return {
        id: input.processId ?? toQueueProcessId(generateTaskId()),
        type: 'chat',
        promptPreview: truncate(firstUser || summary),
        fullPrompt: firstUser,
        status: 'completed',
        startTime,
        endTime,
        title: truncate(summary),
        ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
        sdkSessionId: session.id,
        activeProviderSession: {
            provider: 'copilot',
            sessionId: session.id,
            segmentId: `import-${session.id}`,
            firstTurnIndex: 0,
            boundAt: now.toISOString(),
        },
        conversationTurns: turns,
        metadata: {
            type: 'chat',
            workspaceId: input.workspaceId,
            provider: 'copilot',
            ...(lastModel ? { model: lastModel } : {}),
            importedFrom,
        },
    };
}

/**
 * Map native session id -> CoC process id for chats in one workspace that
 * already represent a native session: explicit imports (`metadata.importedFrom`)
 * and chats CoC itself ran on that session (`sdkSessionId`). Scoped to the
 * workspace so the same native session can be imported into several repos.
 */
export async function getImportedNativeSessionProcessIds(
    store: ProcessStore,
    workspaceId: string,
): Promise<Map<string, string>> {
    const processes = await store.getAllProcesses({ workspaceId, exclude: ['conversation'] });
    const byNativeId = new Map<string, string>();
    for (const proc of processes) {
        if ((proc.metadata?.workspaceId ?? workspaceId) !== workspaceId) continue;
        const importedFrom = proc.metadata?.importedFrom as Partial<ImportedFromMetadata> | undefined;
        const nativeId = typeof importedFrom?.nativeSessionId === 'string'
            ? importedFrom.nativeSessionId
            : undefined;
        if (nativeId) {
            byNativeId.set(nativeId, proc.id);
        }
    }
    // Explicit imports win over CoC-run chats sharing the same session id.
    for (const proc of processes) {
        if ((proc.metadata?.workspaceId ?? workspaceId) !== workspaceId) continue;
        if (proc.sdkSessionId && !byNativeId.has(proc.sdkSessionId)) {
            byNativeId.set(proc.sdkSessionId, proc.id);
        }
    }
    return byNativeId;
}
