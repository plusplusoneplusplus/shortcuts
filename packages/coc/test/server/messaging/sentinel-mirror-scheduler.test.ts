/**
 * Structural scheduler gates for the desktop Sentinel mirror: no polling,
 * real disabled-state quiescence, one retry deadline timer, coalesced
 * wakeups and bounded destination concurrency. Uses an in-memory narrow
 * store so any full-process read is impossible by construction.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedTask, RelayRequestProjection } from '@plusplusoneplusplus/forge';
import { SENTINEL_MIRROR_LIMITS, SentinelMirrorService, type SentinelMirrorProcessStore } from '../../../src/server/messaging/sentinel-mirror-service';
import { SentinelMirrorOutbox, type SentinelMirrorDestination, type SentinelMirrorEntry } from '../../../src/server/messaging/sentinel-mirror-outbox';
import type { SentinelMirrorAdapter } from '../../../src/server/messaging/sentinel-mirror-adapters';

interface Harness {
    mirror: SentinelMirrorService;
    outbox: SentinelMirrorOutbox;
    store: SentinelMirrorProcessStore & { answers: Map<string, RelayRequestProjection> };
    adapter: SentinelMirrorAdapter & { sends: Array<{ chatKey: string; chunk: string }> };
    queue: EventEmitter & { getAll(): QueuedTask[]; getTask(id: string): QueuedTask | undefined };
    setEnabled(value: boolean): void;
    capture(processId: string, content: string, workspaceId?: string): Promise<SentinelMirrorEntry>;
}

let directory: string;
const harnesses: Harness[] = [];

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mirror-scheduler-'));
});

afterEach(() => {
    for (const harness of harnesses.splice(0)) {
        harness.mirror.dispose();
        harness.outbox.close();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
});

function destinationFor(processId: string): SentinelMirrorDestination {
    // Processes named `<chat>/<n>` share the physical chat `<chat>`.
    return { connector: 'whatsapp', chatKey: processId.split('/')[0], threadId: processId, bindingId: `account:${processId}` };
}

function harness(options: { send?: (dest: SentinelMirrorDestination, chunk: string) => Promise<string> } = {}): Harness {
    let enabled = true;
    const answers = new Map<string, RelayRequestProjection>();
    const store = {
        answers,
        getWorkspaces: async () => [
            { id: 'workspace-a', name: 'A', rootPath: directory },
            { id: 'workspace-b', name: 'B', rootPath: path.join(directory, 'b') },
        ],
        appendConversationTurn: vi.fn(async () => undefined),
        getProcessOwnerProjection: vi.fn(async (id: string, workspaceId?: string) => ({
            id, workspaceId: workspaceId ?? 'workspace-a', mode: 'sentinel', status: 'running' as const,
        })),
        hasRelayRequestAdmission: vi.fn(async () => true),
        hasRelayReceiptTurn: vi.fn(async () => false),
        getRelayRequestProjection: vi.fn(async (_processId: string, requestId: string) =>
            answers.get(requestId) ?? { found: true, pending: false, closed: false }),
    };
    const tasks: QueuedTask[] = [];
    const queue = Object.assign(new EventEmitter(), {
        getAll: () => tasks,
        getTask: (id: string) => tasks.find(task => task.id === id),
    });
    let counter = 0;
    const sends: Array<{ chatKey: string; chunk: string }> = [];
    const adapter: Harness['adapter'] = {
        connector: 'whatsapp', sends,
        destinations: owner => [destinationFor(owner.processId)],
        availability: () => 'ready',
        format: entry => [entry.content],
        send: options.send ?? (async (dest, chunk) => {
            sends.push({ chatKey: dest.chatKey, chunk });
            return `out-${++counter}`;
        }),
        record: vi.fn(),
    };
    const outbox = new SentinelMirrorOutbox(directory);
    const mirror = new SentinelMirrorService({
        dataDir: directory, store, queue, enabled: () => enabled, adapters: [adapter], outbox,
    });
    const result: Harness = {
        mirror, outbox, store, adapter, queue,
        setEnabled: value => { enabled = value; },
        capture: async (processId, content, workspaceId = 'workspace-a') => {
            const entry = (await mirror.capture(workspaceId, processId, content))!;
            mirror.accepted(entry);
            return entry;
        },
    };
    harnesses.push(result);
    return result;
}

describe('Sentinel mirror scheduler', () => {
    it('has no polling timer: an idle worker with finished history arms nothing and reads no transcripts', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'setImmediate'] });
        const h = harness();
        const entry = await h.capture('chat/1', 'hello');
        await vi.runAllTimersAsync();
        await h.mirror.flush();
        expect(h.adapter.sends).toHaveLength(1);
        h.store.answers.set(entry.requestId, { found: true, pending: false, closed: true, answer: 'done' });
        h.queue.emit('completed', { id: 'task' });
        await h.mirror.flush();
        expect(h.adapter.sends).toHaveLength(2);
        expect(h.outbox.activeRequests(0, 32)).toEqual([]);
        h.store.getRelayRequestProjection.mockClear();
        h.store.getProcessOwnerProjection.mockClear();
        const list = vi.spyOn(h.outbox, 'list');
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        await h.mirror.flush();
        expect(h.store.getRelayRequestProjection).not.toHaveBeenCalled();
        expect(h.store.getProcessOwnerProjection).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(h.adapter.sends).toHaveLength(2);
    });

    it('disabled workers perform no mirror reads, timers or sends over 60 seconds and keep work paused', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'setImmediate'] });
        const h = harness();
        h.adapter.availability = () => 'offline';
        await h.capture('chat/1', 'paused work');
        await h.mirror.flush();
        h.setEnabled(false);
        const reads = ['activeRequests', 'headsAcrossWorkspaces', 'sending', 'unreported', 'nextRetryAt', 'get', 'receipts', 'list']
            .map(method => vi.spyOn(h.outbox, method as keyof SentinelMirrorOutbox));
        h.store.getRelayRequestProjection.mockClear();
        h.store.getProcessOwnerProjection.mockClear();
        h.adapter.availability = () => 'ready';
        for (let second = 0; second < 60; second++) {
            h.mirror.wake();
            h.queue.emit('completed', { id: `task-${second}` });
            await vi.advanceTimersByTimeAsync(1_000);
        }
        await h.mirror.flush();
        for (const read of reads) expect(read).not.toHaveBeenCalled();
        expect(h.store.getRelayRequestProjection).not.toHaveBeenCalled();
        expect(h.store.getProcessOwnerProjection).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        expect(h.adapter.sends).toHaveLength(0);
        for (const read of reads) read.mockRestore();
        expect(h.outbox.list('workspace-a')[0].state).toBe('pending');
        h.setEnabled(true);
        await h.mirror.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['paused work']);
    });

    it('retains a disabled connector wake and restores confirmed echo guards on re-enable', async () => {
        const h = harness();
        await h.capture('chat/1', 'confirmed');
        await h.mirror.flush();
        vi.mocked(h.adapter.record).mockClear();
        h.setEnabled(false);
        h.mirror.connectorReady('whatsapp');
        await h.mirror.flush();
        expect(h.adapter.record).not.toHaveBeenCalled();
        h.setEnabled(true);
        await h.mirror.flush();
        expect(h.adapter.record).toHaveBeenCalledWith(
            expect.objectContaining({ connector: 'whatsapp', chatKey: 'chat' }), 'out-1',
        );
        expect(h.adapter.sends).toHaveLength(1);
    });

    it('persists a late acknowledgement after disable and schedules no further parts', async () => {
        let release!: (id: string) => void;
        const h = harness({
            send: (dest, chunk) => {
                h.adapter.sends.push({ chatKey: dest.chatKey, chunk });
                return new Promise(resolve => { release = resolve; });
            },
        });
        h.adapter.format = () => ['part one', 'part two'];
        await h.capture('chat/1', 'two parts');
        const drain = h.mirror.flush();
        await vi.waitFor(() => expect(h.adapter.sends).toHaveLength(1));
        h.setEnabled(false);
        release('late-ack');
        await drain;
        expect(h.outbox.list('workspace-a')[0]).toMatchObject({ state: 'pending', nextPart: 1, outboundIds: ['late-ack'] });
        expect(h.adapter.sends).toHaveLength(1);
        h.setEnabled(true);
        const resumed = h.mirror.flush();
        await vi.waitFor(() => expect(h.adapter.sends).toHaveLength(2));
        release('second');
        await resumed;
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['part one', 'part two']);
        expect(h.outbox.list('workspace-a')[0]).toMatchObject({ state: 'delivered', outboundIds: ['late-ack', 'second'] });
    });

    it('arms exactly one timer for the earliest retry deadline and resends when it fires', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'setImmediate', 'Date'] });
        let failures = 1;
        const h = harness({
            send: async (dest, chunk) => {
                if (failures-- > 0) {
                    const { WhatsAppNotConnectedError } = await import('../../../src/server/messaging/whatsapp-messaging-manager');
                    throw new WhatsAppNotConnectedError();
                }
                h.adapter.sends.push({ chatKey: dest.chatKey, chunk });
                return 'retried';
            },
        });
        await h.capture('chat/1', 'retry me');
        await h.mirror.flush();
        expect(h.outbox.list('workspace-a')[0]).toMatchObject({ state: 'retryable', retryCount: 1 });
        expect(vi.getTimerCount()).toBe(1);
        h.mirror.wake();
        await h.mirror.flush();
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(999);
        expect(h.adapter.sends).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
        await h.mirror.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['retry me']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['offline', 'ambiguous', 'disabled'] as const)('parks an overdue retry when %s without timer scans or lost connector wakes', async kind => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
        const h = harness();
        h.adapter.availability = () => 'offline';
        const first = await h.capture('shared/1', 'oldest', 'workspace-b');
        const later = await h.capture('shared/2', 'retry', 'workspace-a');
        await h.mirror.flush();
        h.outbox.prepare(first.workspaceId, first.eventId, ['oldest']);
        h.outbox.prepare(later.workspaceId, later.eventId, ['retry']);
        const db = new NativeDatabase(path.join(directory, 'processes.db'));
        try {
            db.prepare(`UPDATE sentinel_mirror_deliveries SET state = 'retryable', next_attempt_at = ?
                WHERE event_id = ?`).run(new Date(Date.now() - 10_000).toISOString(), kind === 'ambiguous' ? later.eventId : first.eventId);
            if (kind === 'ambiguous') {
                db.prepare(`UPDATE sentinel_mirror_deliveries SET state = 'ambiguous', failure = 'unknown',
                    attempted_part_count = 1, chunks = '["oldest"]' WHERE event_id = ?`).run(first.eventId);
                h.adapter.availability = () => 'ready';
            }
        } finally { db.close(); }
        if (kind === 'disabled') h.setEnabled(false);
        await h.mirror.flush();
        const scans = vi.spyOn(h.outbox, 'activeRequests');
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(scans).not.toHaveBeenCalled();
        expect(h.adapter.sends).toEqual([]);
        if (kind === 'ambiguous') h.outbox.cancel('workspace-b', first.processId, 'cancelled', first.destination.bindingId, first.requestId);
        h.setEnabled(true);
        h.adapter.availability = () => 'ready';
        h.mirror.connectorReady('whatsapp');
        await h.mirror.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(kind === 'ambiguous' ? ['retry'] : ['oldest', 'retry']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['readiness', 'ownership', 'generation', 'dispose'] as const)('holds captured authority when lifecycle changes during %s await', async suspended => {
        const h = harness();
        const entry = await h.capture('chat/1', 'hello');
        await h.mirror.flush();
        const origin = h.mirror.locateCapturedOrigin({
            workspaceId: entry.workspaceId, processId: entry.processId, requestId: entry.requestId,
        })!;
        let release!: () => void;
        let entered!: () => void;
        const waiting = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        if (suspended === 'ownership') {
            h.store.getProcessOwnerProjection.mockImplementationOnce(async () => {
                entered();
                await gate;
                return { id: entry.processId, workspaceId: entry.workspaceId, mode: 'sentinel', status: 'running' };
            });
        } else {
            h.adapter.ready = async () => { entered(); await gate; };
        }
        const authority = h.mirror.authorizeCapturedOrigin(origin);
        await waiting;
        if (suspended === 'dispose') h.mirror.dispose();
        else {
            h.setEnabled(false);
            h.mirror.wake();
            if (suspended === 'generation') h.setEnabled(true);
        }
        release();
        expect(await authority).toBe('wait');
        expect(h.adapter.sends).toHaveLength(1);
    });

    it('recovers an imported staged assistant in the real startup drain without resending its user', async () => {
        const h = harness();
        h.adapter.availability = () => 'offline';
        const user = await h.capture('chat/1', 'hello');
        await h.mirror.flush();
        h.outbox.prepare(user.workspaceId, user.eventId, ['hello']);
        h.outbox.acknowledgePart(user.workspaceId, user.eventId, h.outbox.beginPart(user.workspaceId, user.eventId)!, 'confirmed-user');
        h.outbox.stage({ workspaceId: user.workspaceId, processId: user.processId, requestId: user.requestId,
            destination: user.destination, role: 'assistant', content: 'Durable answer' });
        h.mirror.dispose();
        const restarted = new SentinelMirrorService({
            dataDir: directory, store: h.store, queue: h.queue, enabled: () => true, adapters: [h.adapter], outbox: h.outbox,
        });
        h.mirror = restarted;
        h.adapter.availability = () => 'ready';
        await restarted.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['Durable answer']);
        expect(h.outbox.activeRequests(0, 32)).toEqual([]);
        expect(h.outbox.list('workspace-a').map(row => row.state)).toEqual(['delivered', 'delivered']);
        expect(h.outbox.receipts(0, 10).map(row => row.outboundId)).toEqual(['confirmed-user', 'out-1']);
    });

    it('coalesces wakes during a drain into exactly one more pass', async () => {
        let release!: (id: string) => void;
        const h = harness({
            send: (dest, chunk) => {
                h.adapter.sends.push({ chatKey: dest.chatKey, chunk });
                return new Promise(resolve => { release = resolve; });
            },
        });
        await h.capture('chat/1', 'first');
        const drain = h.mirror.flush();
        await vi.waitFor(() => expect(h.adapter.sends).toHaveLength(1));
        const active = vi.spyOn(h.outbox, 'activeRequests');
        // Work arriving mid-drain is not lost, and many wakes cost one extra pass.
        const second = (await h.mirror.capture('workspace-a', 'chat/2', 'second'))!;
        h.mirror.accepted(second);
        for (let index = 0; index < 10; index++) h.mirror.wake();
        release('one');
        await vi.waitFor(() => expect(h.adapter.sends).toHaveLength(2));
        release('two');
        await drain;
        await h.mirror.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['first', 'second']);
        // One extra coalesced pass, plus the explicit flush above.
        expect(active.mock.calls.filter(call => call[0] === 0)).toHaveLength(2);
    });

    it('bounds concurrent physical destinations and serializes parts within one destination', async () => {
        let inFlight = 0;
        let peak = 0;
        const perChat = new Map<string, number>();
        const h = harness({
            send: async (dest, chunk) => {
                inFlight++;
                peak = Math.max(peak, inFlight);
                perChat.set(dest.chatKey, (perChat.get(dest.chatKey) ?? 0) + 1);
                expect(perChat.get(dest.chatKey)).toBe(1);
                await new Promise(resolve => setTimeout(resolve, 5));
                perChat.set(dest.chatKey, perChat.get(dest.chatKey)! - 1);
                inFlight--;
                h.adapter.sends.push({ chatKey: dest.chatKey, chunk });
                return `out-${h.adapter.sends.length}`;
            },
        });
        h.adapter.format = entry => [`${entry.content} a`, `${entry.content} b`];
        h.adapter.availability = () => 'offline';
        for (let chat = 0; chat < 7; chat++) await h.capture(`chat${chat}/1`, `m${chat}`);
        await h.mirror.flush();
        h.adapter.availability = () => 'ready';
        await h.mirror.flush();
        expect(peak).toBe(SENTINEL_MIRROR_LIMITS.destinations);
        expect(h.adapter.sends).toHaveLength(14);
        for (let chat = 0; chat < 7; chat++) {
            expect(h.adapter.sends.filter(send => send.chatKey === `chat${chat}`).map(send => send.chunk))
                .toEqual([`m${chat} a`, `m${chat} b`]);
        }
    });

    it('preserves admission order across workspaces that share one physical destination', async () => {
        const h = harness();
        h.adapter.availability = () => 'offline';
        await h.capture('shared/1', 'from b', 'workspace-b');
        await h.capture('shared/2', 'from a', 'workspace-a');
        await h.mirror.flush();
        h.adapter.availability = () => 'ready';
        await h.mirror.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['from b', 'from a']);
    });

    it('processes active requests in bounded batches and yields between them', async () => {
        const h = harness();
        h.adapter.availability = () => 'offline';
        for (let index = 0; index < SENTINEL_MIRROR_LIMITS.requestBatch * 2 + 1; index++) {
            await h.capture(`chat/${index}`, `m${index}`);
        }
        await h.mirror.flush();
        const active = vi.spyOn(h.outbox, 'activeRequests');
        await h.mirror.flush();
        const pages = active.mock.results.map(result => (result.value as unknown[]).length);
        expect(Math.max(...pages)).toBeLessThanOrEqual(SENTINEL_MIRROR_LIMITS.requestBatch);
        expect(pages.slice(0, 3)).toEqual([32, 32, 1]);
    });

    it('stops scheduling a removed workspace without touching another workspace on the same chat', async () => {
        const h = harness();
        h.adapter.availability = () => 'offline';
        await h.capture('shared/1', 'removed owner', 'workspace-b');
        await h.capture('shared/2', 'kept owner', 'workspace-a');
        await h.mirror.flush();
        h.mirror.workspaceRemoved('workspace-b');
        h.adapter.availability = () => 'ready';
        await h.mirror.flush();
        expect(h.adapter.sends.map(send => send.chunk)).toEqual(['kept owner']);
        expect(h.outbox.list('workspace-b')[0]).toMatchObject({ state: 'cancelled', failure: 'unbound' });
    });
});
