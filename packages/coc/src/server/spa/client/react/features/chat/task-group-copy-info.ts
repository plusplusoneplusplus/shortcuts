/**
 * task-group-copy-info — pure builders for the "Copy run/session info"
 * context-menu actions on task-group rows in the chat list.
 */

import type { ForEachRunGroup } from './for-each-run-grouping';
import type { MapReduceRunGroup } from './map-reduce-run-grouping';
import type { RalphSession } from './ralph-session-grouping';

export function buildForEachRunCopyInfo(group: ForEachRunGroup, processIds: string[]): string {
    return [
        `For Each run ${group.runId}`,
        `Status: ${group.run.status}`,
        `Items: ${group.run.itemCount}`,
        `Updated: ${group.run.updatedAt ?? group.run.completedAt ?? group.run.createdAt}`,
        'Processes:',
        ...processIds.map(id => `  - ${id}`),
    ].join('\n');
}

export function buildMapReduceRunCopyInfo(group: MapReduceRunGroup, processIds: string[]): string {
    return [
        `Map Reduce run ${group.runId}`,
        `Status: ${group.run.status}`,
        `Map items: ${group.run.itemCount}`,
        `Reduce: ${group.run.reduceStatus}`,
        `Updated: ${group.run.updatedAt ?? group.run.completedAt ?? group.run.createdAt}`,
        'Processes:',
        ...processIds.map(id => `  - ${id}`),
    ].join('\n');
}

export function buildRalphSessionCopyInfo(session: RalphSession, processIds: string[]): string {
    return [
        `Ralph session ${session.sessionId}`,
        `Phase: ${session.phase}`,
        `Iterations: ${session.iterations.length}`,
        `Updated: ${session.latestTimestamp ? new Date(session.latestTimestamp).toISOString() : 'unknown'}`,
        'Processes:',
        ...processIds.map(id => `  - ${id}`),
    ].join('\n');
}
