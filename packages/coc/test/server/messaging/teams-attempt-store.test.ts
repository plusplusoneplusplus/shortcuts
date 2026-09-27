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
        attempt.phases.pop();
        expect(store.list()[0].phases).toHaveLength(5);
        expect(JSON.parse(fs.readFileSync(path.join(f.dir, 'teams-attempts.json'), 'utf8'))).toEqual(store.list());
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
});
