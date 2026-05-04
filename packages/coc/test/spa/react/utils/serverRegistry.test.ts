import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getRemoteServers,
    addRemoteServer,
    removeRemoteServer,
    updateRemoteServer,
    type RemoteServer,
} from '../../../../src/server/spa/client/react/utils/serverRegistry';

const REGISTRY_KEY = 'coc-remote-servers';

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('serverRegistry', () => {
    describe('getRemoteServers', () => {
        it('returns [] when storage is empty', () => {
            expect(getRemoteServers()).toEqual([]);
        });

        it('returns [] when stored value is invalid JSON', () => {
            localStorage.setItem(REGISTRY_KEY, '{not json');
            expect(getRemoteServers()).toEqual([]);
        });

        it('returns the stored array', () => {
            const sample: RemoteServer[] = [
                { id: 'a', label: 'A', url: 'https://a.example.com', addedAt: 1 },
            ];
            localStorage.setItem(REGISTRY_KEY, JSON.stringify(sample));
            expect(getRemoteServers()).toEqual(sample);
        });

        it('does not throw when localStorage.getItem throws', () => {
            const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('storage disabled');
            });
            expect(() => getRemoteServers()).not.toThrow();
            expect(getRemoteServers()).toEqual([]);
            spy.mockRestore();
        });
    });

    describe('addRemoteServer', () => {
        it('returns an entry with a non-empty id and numeric addedAt', () => {
            const entry = addRemoteServer({ label: 'My Box', url: 'https://b.example.com' });
            expect(typeof entry.id).toBe('string');
            expect(entry.id.length).toBeGreaterThan(0);
            expect(typeof entry.addedAt).toBe('number');
            expect(entry.addedAt).toBeGreaterThan(0);
            expect(entry.label).toBe('My Box');
            expect(entry.url).toBe('https://b.example.com');
        });

        it('strips a single trailing slash from url', () => {
            const entry = addRemoteServer({ label: 'L', url: 'https://x.example.com/' });
            expect(entry.url).toBe('https://x.example.com');
        });

        it('strips multiple trailing slashes from url', () => {
            const entry = addRemoteServer({ label: 'L', url: 'https://x.example.com///' });
            expect(entry.url).toBe('https://x.example.com');
        });

        it('persists the new entry to storage', () => {
            const entry = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            const stored = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]');
            expect(stored).toHaveLength(1);
            expect(stored[0].id).toBe(entry.id);
        });

        it('appends to an existing list without modifying earlier entries', () => {
            const first = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            const second = addRemoteServer({ label: 'B', url: 'https://b.example.com' });
            const stored = getRemoteServers();
            expect(stored).toHaveLength(2);
            expect(stored[0].id).toBe(first.id);
            expect(stored[1].id).toBe(second.id);
        });

        it('does not throw when localStorage.setItem throws', () => {
            const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
                throw new Error('quota exceeded');
            });
            expect(() => addRemoteServer({ label: 'A', url: 'https://a.example.com' })).not.toThrow();
            spy.mockRestore();
        });
    });

    describe('removeRemoteServer', () => {
        it('removes the entry with the matching id', () => {
            const a = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            const b = addRemoteServer({ label: 'B', url: 'https://b.example.com' });
            removeRemoteServer(a.id);
            const remaining = getRemoteServers();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe(b.id);
        });

        it('is a no-op when the id is not present', () => {
            const a = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            removeRemoteServer('does-not-exist');
            expect(getRemoteServers()).toHaveLength(1);
            expect(getRemoteServers()[0].id).toBe(a.id);
        });
    });

    describe('updateRemoteServer', () => {
        it('updates only the label of the matching entry', () => {
            const a = addRemoteServer({ label: 'Old', url: 'https://a.example.com' });
            const b = addRemoteServer({ label: 'B', url: 'https://b.example.com' });
            updateRemoteServer(a.id, { label: 'New' });
            const stored = getRemoteServers();
            expect(stored.find(s => s.id === a.id)?.label).toBe('New');
            expect(stored.find(s => s.id === a.id)?.url).toBe('https://a.example.com');
            expect(stored.find(s => s.id === b.id)?.label).toBe('B');
        });

        it('strips trailing slashes from a patched url', () => {
            const a = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            updateRemoteServer(a.id, { url: 'https://a2.example.com/' });
            expect(getRemoteServers()[0].url).toBe('https://a2.example.com');
        });

        it('is a no-op when the id is not present', () => {
            const a = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            updateRemoteServer('missing', { label: 'X' });
            expect(getRemoteServers()[0].label).toBe('A');
            expect(getRemoteServers()[0].id).toBe(a.id);
        });

        it('preserves id and addedAt across updates', () => {
            const a = addRemoteServer({ label: 'A', url: 'https://a.example.com' });
            updateRemoteServer(a.id, { label: 'A2', url: 'https://a2.example.com' });
            const updated = getRemoteServers()[0];
            expect(updated.id).toBe(a.id);
            expect(updated.addedAt).toBe(a.addedAt);
        });
    });
});
