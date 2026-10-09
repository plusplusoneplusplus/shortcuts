import { decodeGraphHtmlEntities, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { formatLabeledWhatsAppChunks, formatWhatsAppAnswer } from './whatsapp-answer-format';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { formatTeamsOutbound } from './teams-outbound-format';
import { TeamsMessageNotSentError, type TeamsMessagingManager } from './teams-messaging-manager';
import { WhatsAppNotConnectedError, type WhatsAppMessagingManager } from './whatsapp-messaging-manager';
import type { WhatsAppBindings } from './whatsapp-bindings';
import type { SentinelMirrorDestination, SentinelMirrorEntry } from './sentinel-mirror-outbox';

export interface SentinelMirrorOwner { workspaceId: string; processId: string }
export interface SentinelMirrorAdapter {
    connector: 'whatsapp' | 'teams';
    ready?(): Promise<void>;
    destinations(owner: SentinelMirrorOwner): SentinelMirrorDestination[];
    availability(entry: SentinelMirrorEntry): 'ready' | 'offline' | 'unbound';
    format(entry: SentinelMirrorEntry): string[];
    send(destination: SentinelMirrorDestination, chunk: string): Promise<string>;
    record(destination: SentinelMirrorDestination, messageId: string): void;
}

export function sameMirrorDestination(a: SentinelMirrorDestination, b: SentinelMirrorDestination): boolean {
    return a.bindingId === b.bindingId && a.connector === b.connector
        && a.chatKey === b.chatKey && a.threadId === b.threadId;
}

export function mirrorSendOutcome(error: unknown): 'not-attempted' | 'rejected' | 'unknown' {
    if (error instanceof WhatsAppNotConnectedError || error instanceof TeamsMessageNotSentError) return 'not-attempted';
    if (error instanceof TeamsOperationError) return error.outcome;
    return 'unknown';
}

export function mirrorRetryAfterMs(error: unknown): number {
    const delay = error instanceof TeamsOperationError ? error.retryAfterMs : undefined;
    return typeof delay === 'number' && Number.isFinite(delay) && delay > 0 ? delay : 0;
}

export function mirrorEchoText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

export function mirrorChunkEchoMatches(connector: SentinelMirrorAdapter['connector'], chunk: string, text: string): boolean {
    const incoming = mirrorEchoText(text);
    const sent = connector === 'teams' ? formatTeamsOutbound(chunk, 'html') : chunk;
    if (incoming === mirrorEchoText(sent)) return true;
    if (connector === 'whatsapp') return false;
    const plain = sent.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '');
    const flat = sent.replace(/<[^>]*>/g, '');
    return [plain, flat, decodeGraphHtmlEntities(plain), decodeGraphHtmlEntities(flat)]
        .some(value => mirrorEchoText(value) === incoming);
}

function whatsappMirrorChunks(entry: SentinelMirrorEntry): string[] {
    const header = (part: number, total: number) =>
        `CoC · Desktop ${entry.role} · Request ${entry.requestId} · Part ${part}/${total}\n\n`;
    return formatLabeledWhatsAppChunks(formatWhatsAppAnswer(entry.content), header);
}

export function createWhatsAppMirrorAdapter(
    manager: WhatsAppMessagingManager, bindings: WhatsAppBindings, ready?: () => Promise<void>,
): SentinelMirrorAdapter {
    const receipts = (owner: SentinelMirrorOwner) => bindings.sentinelMirrorBindings(owner.workspaceId, owner.processId);
    const destinations = (owner: SentinelMirrorOwner): SentinelMirrorDestination[] => {
        const account = manager.getMirrorAccountKey();
        const status = manager.getStatus();
        if (!status.enabled) return [];
        const bound = receipts(owner).filter(row => row.groupJid === status.groupJid);
        if (bound.length && !account) throw new Error('Captured messaging account identity is unavailable');
        return bound.map(row => ({
            connector: 'whatsapp', chatKey: row.groupJid, threadId: row.inboundId,
            bindingId: `${account}:${row.inboundId}`,
        }));
    };
    return {
        connector: 'whatsapp', destinations,
        ready: async () => { if (manager.getStatus().enabled) await ready?.(); },
        availability: entry => {
            const status = manager.getStatus();
            if (!status.enabled || status.groupJid !== entry.destination.chatKey) return 'unbound';
            if (status.status !== 'connected') return 'offline';
            if (!receipts(entry).some(row => row.groupJid === entry.destination.chatKey
                    && row.inboundId === entry.destination.threadId
                    && entry.destination.bindingId.endsWith(`:${row.inboundId}`))) return 'unbound';
            return destinations(entry).some(dest => sameMirrorDestination(dest, entry.destination)) ? 'ready' : 'unbound';
        },
        format: whatsappMirrorChunks,
        send: (dest, chunk) => manager.sendTo(dest.chatKey, chunk, dest.threadId),
        record: (_dest, id) => bindings.recordOutbound(id),
    };
}

export function createTeamsMirrorAdapter(manager: TeamsMessagingManager): SentinelMirrorAdapter {
    const receipts = (owner: SentinelMirrorOwner) => manager.getSentinelMirrorBindings(owner.workspaceId, owner.processId);
    const destinations = (owner: SentinelMirrorOwner): SentinelMirrorDestination[] => {
        const account = manager.getMirrorAccountKey();
        if (!manager.getStatus().enabled) return [];
        const bound = receipts(owner);
        if (bound.length && !account) throw new Error('Captured messaging account identity is unavailable');
        return bound.map(row => ({
            connector: 'teams', chatKey: `${row.teamId}\0${row.channelId}`, threadId: row.rootId,
            bindingId: `${account}:${row.bindingId}`,
        }));
    };
    return {
        connector: 'teams', destinations,
        ready: async () => { if (manager.getStatus().enabled) await manager.waitForSentinelBindings(); },
        availability: entry => {
            const status = manager.getStatus();
            if (!status.enabled || entry.destination.chatKey !== `${status.teamId}\0${status.channelId}`) return 'unbound';
            if (status.status !== 'connected') return 'offline';
            if (!receipts(entry).some(row =>
                entry.destination.chatKey === `${row.teamId}\0${row.channelId}`
                && entry.destination.threadId === row.rootId
                && entry.destination.bindingId.endsWith(`:${row.bindingId}`))) return 'unbound';
            return destinations(entry).some(dest => sameMirrorDestination(dest, entry.destination)) ? 'ready' : 'unbound';
        },
        format: entry => formatTeamsAnswerChunks(entry.content, entry.requestId,
            `Desktop ${entry.role === 'user' ? 'user' : 'assistant'}`),
        send: (dest, chunk) => manager.sendMessage(chunk, dest.threadId, 'html'),
        record: (dest, id) => manager.recordMirrorOutbound(dest.chatKey, dest.threadId!, id),
    };
}
