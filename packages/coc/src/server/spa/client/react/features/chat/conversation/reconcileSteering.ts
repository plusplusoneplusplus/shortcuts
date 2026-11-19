import type { MessageSteeringPayload, SteeringBoundary } from '@plusplusoneplusplus/coc-client';
import type { ClientConversationTurn, ClientTimelineItem } from '../../../types/dashboard';
import { mergeConsecutiveContentItems } from './timeline-utils';

export function insertSteeringBoundary(
    turn: ClientConversationTurn,
    boundary: SteeringBoundary,
): ClientConversationTurn {
    if (turn.timeline.some(item => item.type === 'steering' && item.steeringId === boundary.steeringId)) return turn;
    if (boundary.contentOffset > turn.content.length) return turn;
    const newMarker: ClientTimelineItem = { type: 'steering', ...boundary };
    const markers = [...turn.timeline.filter(item =>
        item.type === 'steering' && item.contentOffset != null && item.timelineIndex != null),
    newMarker].sort((a, b) => a.timelineIndex! - b.timelineIndex!);
    const timeline = mergeConsecutiveContentItems(turn.timeline.filter(item => !markers.includes(item)));
    // Rebuild known cuts in server order: HTTP acknowledgements can overtake SSE.
    for (const marker of markers) {
        let offset = 0;
        for (let index = 0; index < timeline.length; index++) {
            const item = timeline[index];
            if (item.type !== 'content') continue;
            const end = offset + (item.content?.length ?? 0);
            if (marker.contentOffset! > offset && marker.contentOffset! < end) {
                const cut = marker.contentOffset! - offset;
                timeline.splice(index, 1, { ...item, content: item.content!.slice(0, cut) },
                    { ...item, content: item.content!.slice(cut) });
                break;
            }
            offset = end;
        }
        let textOffset = 0;
        let eventOffset = 0;
        const positions: number[] = [];
        for (let index = 0; index <= timeline.length; index++) {
            if (textOffset === marker.contentOffset
                && (marker.eventOffset == null || marker.eventOffset === eventOffset)) positions.push(index);
            if (timeline[index]?.type === 'content') textOffset += timeline[index].content?.length ?? 0;
            else if (timeline[index] && timeline[index].type !== 'steering') eventOffset++;
        }
        if (!positions.length) continue;
        const first = positions[0];
        const last = positions.at(-1)!;
        timeline.splice(Math.max(first, Math.min(marker.timelineIndex!, last)), 0, marker);
    }
    if (!timeline.some(item => item.steeringId === boundary.steeringId)) return turn;
    return { ...turn, timeline };
}

/** Reconciles HTTP and SSE acknowledgements against the same optimistic identity. */
export function reconcileSteering(
    turns: ClientConversationTurn[],
    payload: MessageSteeringPayload,
    assistantTurnIndex?: number,
): ClientConversationTurn[] {
    const id = payload.boundary?.steeringId ?? payload.optimisticId;
    const matched = turns.find(turn => turn.role === 'user'
        && (id ? turn.optimisticId === id : turn.turnIndex === payload.turnIndex));
    const user = payload.userTurn;
    let next = turns;
    if (matched || user?.role === 'user') {
        const accepted: ClientConversationTurn = {
            ...matched,
            ...user,
            role: 'user',
            content: user?.content ?? matched?.content ?? '',
            timestamp: user?.timestamp instanceof Date ? user.timestamp.toISOString() : user?.timestamp ?? matched?.timestamp,
            turnIndex: payload.turnIndex,
            optimisticId: id,
            steered: true,
            timeline: payload.boundary ? [{ type: 'steering', ...payload.boundary }] : matched?.timeline ?? [],
        };
        const matchIndex = next.indexOf(matched!);
        next = next.filter(turn => turn !== matched
            && !(turn.role === 'user' && ((id && turn.optimisticId === id)
                || (!turn.optimisticId && turn.turnIndex === payload.turnIndex))));
        next.splice(matchIndex < 0 ? next.length : Math.min(matchIndex, next.length), 0, accepted);
    }
    if (payload.boundary) {
        const boundary = payload.boundary;
        next = next.map(turn => turn.role === 'assistant'
            && (assistantTurnIndex != null ? turn.turnIndex === assistantTurnIndex
                : turn.streaming && (turn.turnIndex ?? -1) <= payload.turnIndex)
            ? insertSteeringBoundary(turn, boundary) : turn);
    }
    return next;
}

export function applyAcceptedSteering(
    turn: ClientConversationTurn,
    turns: ClientConversationTurn[],
): ClientConversationTurn {
    let result = turn;
    for (const user of turns) {
        if (user.role !== 'user' || !user.steered) continue;
        if ((user.turnIndex ?? -1) < (turn.turnIndex ?? -1) && turns.some(other =>
            (other.role !== 'assistant' || other.turnIndex !== turn.turnIndex)
            && (other.turnIndex ?? -1) > (user.turnIndex ?? -1)
            && (other.turnIndex ?? -1) <= (turn.turnIndex ?? -1)
            && (other.role === 'assistant' || !other.steered))) continue;
        for (const item of user.timeline) {
            if (item.type === 'steering' && item.steeringId && item.contentOffset != null && item.timelineIndex != null) {
                if (turns.some(other => other.turnIndex !== turn.turnIndex && other.role === 'assistant'
                    && other.timeline.some(marker => marker.steeringId === item.steeringId))) continue;
                result = insertSteeringBoundary(result, {
                    steeringId: item.steeringId,
                    contentOffset: item.contentOffset,
                    timelineIndex: item.timelineIndex,
                    eventOffset: item.eventOffset,
                    timestamp: item.timestamp,
                });
            }
        }
    }
    return result;
}
