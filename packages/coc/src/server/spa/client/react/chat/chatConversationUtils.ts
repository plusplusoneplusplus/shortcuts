import type { ClientConversationTurn } from '../types/dashboard';

/**
 * Extract conversation turns from a process/queue API response.
 *
 * Checks multiple response shapes in priority order:
 *   1. process.conversationTurns
 *   2. data.conversation
 *   3. data.turns
 *   4. Synthetic turns from process.fullPrompt / process.result
 *   5. Fallback from task.payload.prompt
 */
export function getConversationTurns(data: any, task?: any): ClientConversationTurn[] {
    const process = data?.process;
    if (process?.conversationTurns && Array.isArray(process.conversationTurns) && process.conversationTurns.length > 0) {
        return process.conversationTurns;
    }
    if (Array.isArray(data?.conversation) && data.conversation.length > 0) {
        return data.conversation;
    }
    if (Array.isArray(data?.turns) && data.turns.length > 0) {
        return data.turns;
    }
    if (process) {
        const synthetic: ClientConversationTurn[] = [];
        const userContent = process.fullPrompt || process.promptPreview;
        if (userContent) {
            synthetic.push({ role: 'user', content: userContent, timestamp: process.startTime || undefined, timeline: [] });
        }
        if (process.result) {
            synthetic.push({ role: 'assistant', content: process.result, timestamp: process.endTime || undefined, timeline: [] });
        }
        return synthetic;
    }
    if (task?.payload?.prompt) {
        return [{ role: 'user', content: task.payload.prompt, timeline: [] }];
    }
    return [];
}
