import type { ClientConversationTurn, ClientTimelineItem } from '../../../types/dashboard';

export interface ConversationSection {
    key: string;
    turn: ClientConversationTurn;
    /** The canonical response remains the target of turn-level actions. */
    logicalTurn: ClientConversationTurn;
}

/**
 * Steering splits presentation, not conversation turns. Tool lifecycles stay
 * with their original card even when their completion arrives after a steer.
 */
export function projectSteeringSections(turns: readonly ClientConversationTurn[]): ConversationSection[] {
    const users = new Map(turns.filter(turn => turn.role === 'user' && turn.optimisticId)
        .map(turn => [turn.optimisticId!, turn]));
    const claimed = new Set<string>();
    for (const turn of turns) {
        if (turn.role !== 'assistant') continue;
        for (const item of turn.timeline ?? []) {
            if (item.type === 'steering' && item.steeringId && users.has(item.steeringId)) {
                claimed.add(item.steeringId);
            }
        }
    }

    return turns.flatMap((turn, index): ConversationSection[] => {
        if (turn.role === 'user' && turn.optimisticId && claimed.has(turn.optimisticId)) return [];
        const key = `${turn.turnIndex ?? index}`;
        if (turn.role !== 'assistant' || !turn.timeline?.some(item =>
            item.type === 'steering' && item.steeringId && claimed.has(item.steeringId))) {
            return [{ key, turn, logicalTurn: turn }];
        }

        const timelines: ClientTimelineItem[][] = [[]];
        const steers: ClientConversationTurn[] = [];
        const seen = new Set<string>();
        const toolSections = new Map<string, number>();
        const taskStack: Array<{ id: string; section: number }> = [];
        const timelineWithContent = turn.content && !turn.timeline.some(item => item.type === 'content' && item.content)
            ? [...turn.timeline, { type: 'content' as const, content: turn.content, timestamp: turn.timestamp ?? '' }]
            : turn.timeline;
        for (const item of timelineWithContent) {
            if (item.type === 'steering') {
                if (item.steeringId && claimed.has(item.steeringId) && !seen.has(item.steeringId)) {
                    seen.add(item.steeringId);
                    steers.push(users.get(item.steeringId)!);
                    timelines.push([]);
                }
                continue;
            }
            let section = timelines.length - 1;
            const tool = item.toolCall;
            if (tool) {
                section = toolSections.get(tool.id)
                    ?? (tool.parentToolCallId ? toolSections.get(tool.parentToolCallId) : undefined)
                    ?? taskStack.at(-1)?.section ?? section;
                toolSections.set(tool.id, section);
                if (tool.toolName === 'task' || tool.toolName === 'read_agent') {
                    if (item.type === 'tool-start') taskStack.push({ id: tool.id, section });
                    else if (item.type === 'tool-complete' || item.type === 'tool-failed') {
                        const taskIndex = taskStack.findIndex(task => task.id === tool.id);
                        if (taskIndex !== -1) taskStack.splice(taskIndex, 1);
                    }
                }
            } else if (item.type === 'content' && taskStack.length) {
                section = taskStack.at(-1)!.section;
            }
            timelines[section].push(item);
        }

        const result: ConversationSection[] = [];
        let lastAssistantSection = timelines.length - 1;
        if (!turn.streaming) {
            while (lastAssistantSection > 0 && !timelines[lastAssistantSection].length) lastAssistantSection--;
        }
        timelines.forEach((timeline, section) => {
            if (section > 0) {
                const user = steers[section - 1];
                result.push({ key: `steer-${user.optimisticId}`, turn: { ...user, steered: true }, logicalTurn: user });
            }
            const last = section === lastAssistantSection;
            const content = timeline.filter(item => item.type === 'content').map(item => item.content ?? '').join('');
            if (!timeline.length && !(last && turn.streaming)) return;
            result.push({
                key: `${key}-section-${section === 0 ? 'start' : steers[section - 1].optimisticId}`,
                logicalTurn: turn,
                turn: {
                    ...turn,
                    content,
                    timeline,
                    toolCalls: turn.toolCalls?.filter(tool =>
                        (toolSections.get(tool.id) ?? lastAssistantSection) === section),
                    streaming: last && turn.streaming,
                    tokenUsage: last ? turn.tokenUsage : undefined,
                    costTimeMs: last ? turn.costTimeMs : undefined,
                    interrupted: last && turn.interrupted,
                    isError: last && turn.isError,
                },
            });
        });
        return result;
    });
}
