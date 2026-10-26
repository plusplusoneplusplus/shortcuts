import { toQueueProcessId, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { TeamsReactionResult } from './teams-reaction-reply';

const marker = '```teams-delegation-result\n';

export function teamsReactionOutcomeInstructions(requestId: string): string {
    return [
        'Keep findings here. End with exactly one teams-delegation-result fenced JSON block.',
        `Use only these fields: "requestId": ${JSON.stringify(requestId)}, "kind": "task" or "approval", and "outcome".`,
        'Use outcome "done" when the requested work is complete; otherwise use "rejected" and explain why in your findings.',
        'Missing or uncertain evidence, blocked work, errors and cancellation mean rejected, not done. Rejection does not mean submitting a negative PR vote.',
        'For approval, recheck the current revision and your account\'s reviews. An existing approval for that revision counts as done; never approve twice. Otherwise report done only after submitting approval and checking it was saved.',
        'Report your own execution, never a result copied from Teams context.',
    ].join('\n');
}

/** Outcomes report dispatcher execution; they do not independently certify provider state. */
function reportedOutcome(content: string, requestId: string): TeamsReactionResult | undefined {
    const text = content.replace(/\r\n/g, '\n').trimEnd();
    const start = text.lastIndexOf(marker);
    if (start < 0 || (start > 0 && text[start - 1] !== '\n')
        || text.indexOf(marker) !== start || !text.endsWith('\n```')) return;
    const json = text.slice(start + marker.length, -4);
    if (Buffer.byteLength(json, 'utf8') > 2048) return;
    let report: unknown;
    try {
        report = JSON.parse(json);
    } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
    }
    if (!report || typeof report !== 'object' || Array.isArray(report)
        || Object.keys(report).length !== 3
        || !('requestId' in report) || report.requestId !== requestId
        || !('kind' in report) || !('outcome' in report)) return;
    const { kind, outcome } = report;
    if ((kind === 'approval' || kind === 'task') && (outcome === 'done' || outcome === 'rejected')) {
        return { kind, outcome };
    }
}

export async function resolveTeamsReactionOutcome(
    store: Pick<ProcessStore, 'getProcess'>,
    job: { requestId: string; workspaceId: string; processId: string; status: 'completed' | 'failed' | 'cancelled' },
    signal: AbortSignal,
): Promise<TeamsReactionResult> {
    signal.throwIfAborted();
    const { requestId, workspaceId, processId, status } = job;
    if (!/^teams-reaction-[a-zA-Z0-9_-]{1,128}$/.test(requestId)
        || processId !== toQueueProcessId(requestId) || !workspaceId) {
        throw new Error('Invalid Teams reaction outcome job.');
    }
    if (status !== 'completed') return { kind: 'task', outcome: 'rejected' };
    const process = await store.getProcess(processId);
    signal.throwIfAborted();
    if (!process) return { kind: 'task', outcome: 'rejected' };
    if (process.id !== processId || process.type !== 'chat'
        || process.metadata?.workspaceId !== workspaceId
        || process.metadata.queueTaskId !== requestId || process.metadata.mode !== 'ask') {
        throw new Error('Teams reaction outcome ownership mismatch.');
    }
    const turns = (process.conversationTurns ?? []).filter(turn => !turn.historical && !turn.displayOnly);
    const users = turns.filter(turn => turn.role === 'user');
    const answer = turns.at(-1);
    if (process.status !== 'completed' || users.length !== 1 || turns[0] !== users[0]
        || users[0].relayRequestId !== requestId || users[0].deletedAt
        || !answer || answer.role !== 'assistant' || answer.streaming || answer.interrupted || answer.deletedAt) {
        return { kind: 'task', outcome: 'rejected' };
    }
    const report = reportedOutcome(answer.content, requestId);
    return report ?? { kind: 'task', outcome: 'rejected' };
}
