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
});
