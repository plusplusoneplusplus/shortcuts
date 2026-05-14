import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContainerAgentStore } from '../../../src/server/container/container-agent-store';

describe('ContainerAgentStore', () => {
    let tmpDir: string;
    let store: ContainerAgentStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-container-store-'));
        store = new ContainerAgentStore(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty list when no file exists', () => {
        expect(store.list()).toEqual([]);
    });

    it('creates an agent with required fields', () => {
        const agent = store.create({ address: 'http://localhost:4000', name: 'Test Agent' });
        expect(agent.id).toBeTruthy();
        expect(agent.name).toBe('Test Agent');
        expect(agent.address).toBe('http://localhost:4000');
        expect(agent.tunnelId).toBeUndefined();
        expect(agent.addedAt).toBeGreaterThan(0);
    });

    it('creates an agent with tunnelId', () => {
        const agent = store.create({
            address: 'https://abc.devtunnels.ms',
            name: 'Tunnel Agent',
            tunnelId: 'abc-def.usw2',
        });
        expect(agent.tunnelId).toBe('abc-def.usw2');
    });

    it('derives name from hostname when name is empty', () => {
        const agent = store.create({ address: 'https://my-server.devtunnels.ms' });
        expect(agent.name).toBe('my-server');
    });

    it('derives name from non-devtunnel hostname', () => {
        const agent = store.create({ address: 'http://my-machine.local:4000' });
        expect(agent.name).toBe('my-machine.local');
    });

    it('persists and retrieves agents', () => {
        store.create({ address: 'http://localhost:4000', name: 'A1' });
        store.create({ address: 'http://localhost:4001', name: 'A2' });

        const store2 = new ContainerAgentStore(tmpDir);
        const list = store2.list();
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('A1');
        expect(list[1].name).toBe('A2');
    });

    it('gets agent by id', () => {
        const created = store.create({ address: 'http://localhost:4000', name: 'X' });
        const found = store.get(created.id);
        expect(found).toEqual(created);
    });

    it('returns undefined for unknown id', () => {
        expect(store.get('nonexistent')).toBeUndefined();
    });

    it('updates agent name', () => {
        const agent = store.create({ address: 'http://localhost:4000', name: 'Old' });
        const updated = store.update(agent.id, { name: 'New' });
        expect(updated.name).toBe('New');
        expect(updated.address).toBe('http://localhost:4000');
    });

    it('updates agent tunnelId', () => {
        const agent = store.create({ address: 'https://abc.devtunnels.ms', name: 'T' });
        const updated = store.update(agent.id, { tunnelId: 'my-tunnel.usw2' });
        expect(updated.tunnelId).toBe('my-tunnel.usw2');
    });

    it('clears tunnelId with null', () => {
        const agent = store.create({ address: 'https://abc.devtunnels.ms', tunnelId: 'old.usw2' });
        const updated = store.update(agent.id, { tunnelId: null });
        expect(updated.tunnelId).toBeUndefined();
    });

    it('throws on update of nonexistent agent', () => {
        expect(() => store.update('nope', { name: 'X' })).toThrow('not found');
    });

    it('removes an agent', () => {
        const agent = store.create({ address: 'http://localhost:4000', name: 'Del' });
        const removed = store.remove(agent.id);
        expect(removed?.id).toBe(agent.id);
        expect(store.list()).toHaveLength(0);
    });

    it('returns undefined removing nonexistent agent', () => {
        expect(store.remove('nope')).toBeUndefined();
    });

    it('normalizes address (strips trailing slash)', () => {
        const agent = store.create({ address: 'http://localhost:4000/' });
        expect(agent.address).toBe('http://localhost:4000');
    });

    it('rejects invalid address', () => {
        expect(() => store.create({ address: 'not-a-url' })).toThrow('valid absolute URL');
    });

    it('rejects non-http address', () => {
        expect(() => store.create({ address: 'ftp://server/path' })).toThrow('http or https');
    });

    it('rejects invalid tunnelId characters', () => {
        expect(() => store.create({ address: 'http://a.com', tunnelId: 'has spaces!' })).toThrow();
    });

    it('handles corrupt JSON gracefully', () => {
        fs.writeFileSync(path.join(tmpDir, 'container-agents.json'), 'not json');
        expect(store.list()).toEqual([]);
    });
});
