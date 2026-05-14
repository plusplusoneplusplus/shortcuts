/**
 * Tests for agent-store module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAgentStore, type AgentStore } from '../../src/store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('AgentStore', () => {
    let store: AgentStore;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-test-'));
        store = createAgentStore(tmpDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should add and list agents', () => {
        const agent = store.add('http://localhost:4000', 'test-agent');
        expect(agent.name).toBe('test-agent');
        expect(agent.address).toBe('http://localhost:4000');
        expect(agent.status).toBe('unknown');

        const list = store.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(agent.id);
    });

    it('should normalize trailing slashes', () => {
        const agent = store.add('http://localhost:4000/', 'test');
        expect(agent.address).toBe('http://localhost:4000');
    });

    it('should reject duplicate addresses', () => {
        store.add('http://localhost:4000', 'agent1');
        expect(() => store.add('http://localhost:4000', 'agent2')).toThrow(/already registered/);
    });

    it('should auto-name from URL host', () => {
        const agent = store.add('http://my-server:4001');
        expect(agent.name).toBe('my-server:4001');
    });

    it('should get by id or name', () => {
        const agent = store.add('http://localhost:4000', 'my-agent');

        expect(store.get(agent.id)?.name).toBe('my-agent');
        expect(store.get('my-agent')?.id).toBe(agent.id);
        expect(store.get('nonexistent')).toBeUndefined();
    });

    it('should remove by id', () => {
        const agent = store.add('http://localhost:4000', 'test');
        expect(store.remove(agent.id)).toBe(true);
        expect(store.list()).toHaveLength(0);
    });

    it('should remove by name', () => {
        store.add('http://localhost:4000', 'test');
        expect(store.remove('test')).toBe(true);
        expect(store.list()).toHaveLength(0);
    });

    it('should return false when removing nonexistent', () => {
        expect(store.remove('nonexistent')).toBe(false);
    });

    it('should update status', () => {
        const agent = store.add('http://localhost:4000', 'test');
        store.updateStatus(agent.id, 'online');

        const updated = store.get(agent.id);
        expect(updated?.status).toBe('online');
        expect(updated?.lastSeenAt).not.toBeNull();
    });

    it('should not update lastSeenAt when going offline', () => {
        const agent = store.add('http://localhost:4000', 'test');
        store.updateStatus(agent.id, 'online');
        const seenAt = store.get(agent.id)?.lastSeenAt;

        store.updateStatus(agent.id, 'offline');
        const updated = store.get(agent.id);
        expect(updated?.status).toBe('offline');
        expect(updated?.lastSeenAt).toBe(seenAt);
    });

    it('should add agent with tunnelId', () => {
        const agent = store.add('https://abc.devtunnels.ms', 'tunnel-agent', 'my-tunnel-id');
        expect(agent.tunnelId).toBe('my-tunnel-id');
        expect(agent.name).toBe('tunnel-agent');
    });

    it('should add agent without tunnelId', () => {
        const agent = store.add('http://localhost:4000', 'no-tunnel');
        expect(agent.tunnelId).toBeUndefined();
    });

    it('should update agent fields including tunnelId', () => {
        const agent = store.add('http://localhost:4000', 'original');
        const updated = store.update(agent.id, { name: 'renamed', tunnelId: 'new-tunnel' });
        expect(updated?.name).toBe('renamed');
        expect(updated?.tunnelId).toBe('new-tunnel');
        expect(updated?.address).toBe('http://localhost:4000');
    });

    it('should clear tunnelId with null', () => {
        const agent = store.add('https://abc.devtunnels.ms', 'tunnel-agent', 'my-tunnel');
        expect(agent.tunnelId).toBe('my-tunnel');

        const updated = store.update(agent.id, { tunnelId: null });
        expect(updated?.tunnelId).toBeUndefined();
    });

    it('should update address via update()', () => {
        const agent = store.add('http://localhost:4000', 'test');
        const updated = store.update(agent.id, { address: 'http://localhost:5000' });
        expect(updated?.address).toBe('http://localhost:5000');
    });

    it('should migrate existing db without tunnel_id column', () => {
        // Close and reopen — simulates migration on existing DB
        store.close();
        const store2 = createAgentStore(tmpDir);
        const agent = store2.add('http://localhost:9000', 'migrated');
        expect(agent.tunnelId).toBeUndefined();
        store2.close();
    });
});
