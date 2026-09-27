import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TeamsAttemptStore } from '../../../src/server/messaging/teams-attempt-store';

describe('TeamsAttemptStore', () => {
    const directories: string[] = [];
    afterEach(() => {
        for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    function fixture() {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-attempt-'));
        directories.push(dir);
        let time = new Date('2026-01-01T00:00:00.000Z');
        return {
            dir,
            clock: () => time,
            advance: (ms: number) => { time = new Date(time.getTime() + ms); },
        };
    }

    it('records stages and terminal outcomes, closes once, and returns defensive copies', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const id = store.start();
        f.advance(1000);
        store.phase(id, 'authenticating');
        store.phase(id, 'resolving');
        store.phase(id, 'starting-polling');
        store.phase(id, 'connected');
        store.finish(id, 'failed', 'polling');
        store.finish(id, 'disconnected');
        store.phase(id, 'connected');
        const [attempt] = store.list();
        expect(attempt).toMatchObject({
            id, startedAt: '2026-01-01T00:00:00.000Z',
            endedAt: '2026-01-01T00:00:01.000Z', result: 'failed', failureCategory: 'polling',
        });
        expect(attempt.phases.map(p => p.stage)).toEqual([
            'started', 'authenticating', 'resolving', 'starting-polling', 'connected',
        ]);
        expect(attempt.stage).toBe('connected');
        expect(attempt.degraded).toBe(false);
        attempt.phases.pop();
        expect(store.list()[0].phases).toHaveLength(5);
        const persisted = JSON.parse(fs.readFileSync(path.join(f.dir, 'teams-attempts.json'), 'utf8'));
        expect(persisted[0]).not.toHaveProperty('degraded');
        expect(persisted[0]).not.toHaveProperty('stage');
        expect(persisted[0]).toMatchObject({ id, totals: {}, events: [] });
    });

    it('supersedes a live attempt and interrupts an orphan on restart', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const first = store.start();
        f.advance(1000);
        const second = store.start();
        expect(store.list().find(a => a.id === first)?.result).toBe('superseded');
        f.advance(1000);
        const restarted = new TeamsAttemptStore(f.dir, f.clock);
        expect(restarted.list().find(a => a.id === second)).toMatchObject({
            result: 'interrupted', endedAt: '2026-01-01T00:00:02.000Z',
        });
        expect(restarted.start()).not.toBe(second);
        expect(restarted.list()).toHaveLength(3);
    });

    it('keeps only the newest 200 completed attempts and never evicts the active one', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const first = store.start();
        for (let i = 0; i < 201; i++) {
            store.start();
            f.advance(1);
        }
        expect(store.list()).toHaveLength(201);
        expect(store.list()[0].endedAt).toBeUndefined();
        expect(store.list().some(a => a.id === first)).toBe(false);
    });

    it('prunes completed attempts older than 30 days but retains an active attempt', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const old = store.start();
        store.finish(old, 'disconnected');
        const active = store.start();
        f.advance(31 * 24 * 60 * 60 * 1000);
        expect(store.list().some(a => a.id === active)).toBe(true);
        const loaded = new TeamsAttemptStore(f.dir, f.clock);
        expect(loaded.list()).toMatchObject([{ id: active, result: 'interrupted' }]);
        expect(loaded.list().some(a => a.id === old)).toBe(false);
    });

    it('retains attempts at the exact 30-day cutoff and prunes them one millisecond later', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const cutoff = store.start();
        store.finish(cutoff, 'disconnected');
        const pending = store.start();
        f.advance(30 * 24 * 60 * 60 * 1000);
        const atCutoff = new TeamsAttemptStore(f.dir, f.clock);
        expect(atCutoff.list().map(a => a.id)).toEqual([pending, cutoff]);
        expect(atCutoff.list()[0].result).toBe('interrupted');

        f.advance(1);
        const afterCutoff = new TeamsAttemptStore(f.dir, f.clock);
        expect(afterCutoff.list().map(a => a.id)).toEqual([pending]);
        expect(afterCutoff.list()[0].result).toBe('interrupted');
    });

    it('does not persist extra fields from a stored record and rejects corrupt data', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        store.start();
        const file = path.join(f.dir, 'teams-attempts.json');
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        rows[0].token = 'sensitive-token';
        rows[0].phases[0].message = 'private-message';
        fs.writeFileSync(file, JSON.stringify(rows));
        const reloaded = new TeamsAttemptStore(f.dir, f.clock);
        expect(JSON.stringify(reloaded.list())).not.toMatch(/sensitive-token|private-message/);
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(/sensitive-token|private-message/);
        fs.writeFileSync(file, '{');
        expect(() => new TeamsAttemptStore(f.dir, f.clock)).toThrow();
    });

    it('aggregates successful polls, bounds safe events and clears live degradation', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const id = store.start();
        store.poll(id, 'failure');
        store.send(id, 'rejected');
        expect(store.list()[0]).toMatchObject({ pollDegraded: true, sendDegraded: true, degraded: true });
        for (let i = 0; i < 250; i++) store.poll(id, 'success');
        store.send(id, 'accepted');
        store.event(id, 'inbound-skipped', 'own');
        for (let i = 0; i < 150; i++) store.event(id, 'inbound-observed');
        const attempt = store.list()[0];
        expect(attempt.pollSuccessCount).toBe(250);
        expect(attempt.totals).toMatchObject({ 'poll-success': 250, 'poll-failed': 1, 'reply-rejected': 1,
            'reply-accepted': 1, 'inbound-observed': 150, 'inbound-skipped': 1 });
        expect(attempt.lastPollSuccessAt).toBe(f.clock().toISOString());
        expect(attempt.lastSendSuccessAt).toBe(f.clock().toISOString());
        expect(attempt.pollDegraded).toBe(false);
        expect(attempt.sendDegraded).toBe(false);
        expect(attempt.degraded).toBe(false);
        expect(attempt.events).toHaveLength(100);
        attempt.events[0].type = 'reply-rejected';
        attempt.totals['poll-success'] = 0;
        expect(store.list()[0].events[0].type).toBe('inbound-observed');
        expect(store.list()[0].totals['poll-success']).toBe(250);
        expect(new TeamsAttemptStore(f.dir, f.clock).list()[0]).toMatchObject({
            pollSuccessCount: 250, pollDegraded: false, sendDegraded: false, degraded: false,
            totals: { 'poll-success': 250, 'inbound-observed': 150 },
        });
    });

    it('drops callbacks for superseded attempts and strips extra stored event fields', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const old = store.start();
        const current = store.start();
        store.poll(old, 'failure');
        store.send(old, 'rejected');
        store.event(old, 'dispatch-queued');
        expect(store.list().find(a => a.id === old)?.events).toEqual([]);
        store.event(current, 'inbound-skipped', 'empty');
        const file = path.join(f.dir, 'teams-attempts.json');
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        rows[0].events[0].messageId = 'secret-message-id';
        rows[0].events[0].response = 'private MCP response';
        fs.writeFileSync(file, JSON.stringify(rows));
        const loaded = new TeamsAttemptStore(f.dir, f.clock);
        expect(loaded.list()[0].events).toEqual([{ at: f.clock().toISOString(), type: 'inbound-skipped', category: 'empty' }]);
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(/secret-message-id|private MCP response/);
    });

    it('exposes the detail shape and migrates historical counters without exposing extra fields', () => {
        const f = fixture();
        const store = new TeamsAttemptStore(f.dir, f.clock);
        const id = store.start();
        store.phase(id, 'connected');
        store.event(id, 'inbound-skipped', 'own');
        store.poll(id, 'success');
        store.poll(id, 'failure');
        store.send(id, 'accepted');
        const [detail] = store.list();
        expect(detail).toEqual({
            id, startedAt: f.clock().toISOString(), stage: 'connected',
            phases: [{ stage: 'started', at: f.clock().toISOString() }, { stage: 'connected', at: f.clock().toISOString() }],
            events: [
                { type: 'inbound-skipped', at: f.clock().toISOString(), category: 'own' },
                { type: 'poll-failed', at: f.clock().toISOString() },
                { type: 'reply-accepted', at: f.clock().toISOString() },
            ],
            totals: { 'inbound-skipped': 1, 'poll-success': 1, 'poll-failed': 1, 'reply-accepted': 1 },
            pollSuccessCount: 1, lastPollSuccessAt: f.clock().toISOString(),
            lastSendSuccessAt: f.clock().toISOString(), pollDegraded: true, sendDegraded: false, degraded: true,
        });
        const file = path.join(f.dir, 'teams-attempts.json');
        const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
        delete rows[0].totals;
        rows[0].events[0].reason = rows[0].events[0].category;
        delete rows[0].events[0].category;
        rows[0].totalsSecret = 'private';
        fs.writeFileSync(file, JSON.stringify(rows));
        const migrated = new TeamsAttemptStore(f.dir, f.clock).list()[0];
        expect(migrated.events[0]).toMatchObject({ category: 'own' });
        expect(migrated.totals).toMatchObject({ 'poll-success': 1, 'inbound-skipped': 1 });
        expect(JSON.stringify(migrated)).not.toMatch(/private|reason|totalsSecret/);
        expect(fs.readFileSync(file, 'utf8')).not.toMatch(/private|reason|totalsSecret/);
    });
});
