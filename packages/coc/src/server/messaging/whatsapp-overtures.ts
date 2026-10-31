/** Read-only, bounded overture summaries for WhatsApp topic lists. */
import { isDeliveredSentinelOverture, zonedTriggerTime } from '@plusplusoneplusplus/coc-client';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { TriggerStore } from '../triggers/trigger-store';
import type { Trigger } from '../triggers/trigger-types';
import type { SentinelTodoStore } from '../sentinel-todos/sentinel-todo-store';

export type WhatsAppOvertureReader = Pick<TriggerStore, 'getByWorkspace'>;
const LIMIT = 5;

function compact(text: string, max = 40): string {
    const chars = Array.from(text.replace(/[\r\n\t*_`~]/g, ' ').replace(/\s+/g, ' ').trim());
    return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

function condition(trigger: Trigger): string {
    const event = trigger.event;
    if (event.type === 'date-time') {
        try { return `At ${zonedTriggerTime(event.firesAt, event.timeZone)} (${compact(event.timeZone)})`; }
        catch { return 'Date/time unavailable'; }
    }
    if (event.monitor === 'pr-merged') {
        return `PR merged · ${compact(event.pr.repoPath)} #${event.pr.number}${event.lastSeenTitle ? ` · ${compact(event.lastSeenTitle)}` : ''}`;
    }
    return `CI failure · PR #${compact(event.prId)}${event.repairScope === 'ci-and-conflicts' ? ' · conflicts too' : ''}`;
}

function status(trigger: Trigger): string {
    const result = trigger.outcome ?? trigger.status;
    return [result, trigger.inFlight ? 'in progress' : '',
        trigger.delivery ? `delivery ${trigger.delivery.state}` : '',
        trigger.event.monitor === 'pr-merged' && trigger.event.lastError
            ? `read error${trigger.status === 'active' ? '; retrying' : ''}` : '',
    ].filter(Boolean).join(' · ');
}

/** Undefined workspaces mean a remote browse: never fall back to local trigger data. */
export async function whatsappOverturesReply(
    workspaces: readonly { id: string; name?: string }[] | undefined,
    reader: WhatsAppOvertureReader | undefined,
    store: Pick<ProcessStore, 'getProcess'>,
    todos?: Pick<SentinelTodoStore, 'get'>,
    verbose?: boolean,
): Promise<string> {
    if (!workspaces) return '*Overtures*\nUnavailable from this remote server.';
    if (!reader) return '*Overtures · all local repos*\nData unavailable.';
    const triggers: Trigger[] = [];
    const unavailable: string[] = [];
    for (const workspace of workspaces) {
        try {
            triggers.push(...reader.getByWorkspace(workspace.id).filter(trigger =>
                trigger.workspaceId === workspace.id && trigger.action.processId === trigger.processId
                && !trigger.binding?.removedAt && !trigger.binding?.delegatedPr && !isDeliveredSentinelOverture(trigger)));
        } catch { unavailable.push(compact(workspace.name ?? workspace.id)); }
    }
    // Active rules precede history; stable ordering keeps the phone-sized cap predictable.
    triggers.sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active')
        || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const lines = ['*Overtures · all local repos*'];
    for (const trigger of triggers.slice(0, LIMIT)) {
        const workspace = workspaces.find(ws => ws.id === trigger.workspaceId)!;
        const process = await store.getProcess(trigger.processId, trigger.workspaceId).catch(() => undefined);
        const ownsProcess = process?.id === trigger.processId && process.metadata?.workspaceId === trigger.workspaceId;
        const owner = ownsProcess
            ? compact(process.title ?? process.customTitle ?? process.id) : 'Chat unavailable';
        let itemTitle: string | undefined;
        if (trigger.binding && todos && ownsProcess) {
            // Read the persisted ledger only; service.list can refresh dependency actions.
            try {
                itemTitle = todos.get({ workspaceId: trigger.workspaceId, processId: trigger.processId })
                    .items.find(item => item.id === trigger.binding!.itemId)?.title;
            } catch { /* The saved condition and chat remain useful without an item title. */ }
        }
        lines.push(`• ${compact(workspace.name ?? workspace.id)} · ${owner}${itemTitle ? ` · ${compact(itemTitle)}` : ''}`,
            `  ${condition(trigger)} · ${status(trigger)}`);
        if (verbose) lines.push(`  ${trigger.workspaceId}/${trigger.id}`);
    }
    if (!triggers.length && !unavailable.length) lines.push('No overtures.');
    if (triggers.length > LIMIT) lines.push(`…${triggers.length - LIMIT} more in CoC.`);
    if (unavailable.length) lines.push(`Data unavailable: ${unavailable.slice(0, LIMIT).join(', ')}${unavailable.length > LIMIT ? ', …' : ''}.`);
    return lines.join('\n');
}
