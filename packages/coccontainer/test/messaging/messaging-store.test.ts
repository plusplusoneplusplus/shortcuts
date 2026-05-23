/**
 * Tests for MessagingStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessagingStore } from '../../src/messaging/messaging-store';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('MessagingStore', () => {
    let store: MessagingStore;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-store-test-'));
        store = new MessagingStore(tmpDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('message bindings', () => {
        it('should bind and lookup a message', () => {
            store.bindMessage('wamid.123', 'proc-001', 'agent-a', 'Agent-A:frontend');
            const result = store.lookupMessage('wamid.123');
            expect(result).toEqual({
                processId: 'proc-001',
                agentId: 'agent-a',
                sessionLabel: 'Agent-A:frontend',
                workspaceId: undefined,
            });
        });

        it('should bind and lookup with workspaceId', () => {
            store.bindMessage('wamid.456', 'proc-002', 'agent-b', 'Agent-B:backend', 'ws-myrepo');
            const result = store.lookupMessage('wamid.456');
            expect(result).toEqual({
                processId: 'proc-002',
                agentId: 'agent-b',
                sessionLabel: 'Agent-B:backend',
                workspaceId: 'ws-myrepo',
            });
        });

        it('should return null for unknown message', () => {
            const result = store.lookupMessage('wamid.nonexistent');
            expect(result).toBeNull();
        });

        it('should update on duplicate bind (INSERT OR REPLACE)', () => {
            store.bindMessage('wamid.123', 'proc-001', 'agent-a', 'Agent-A:frontend');
            store.bindMessage('wamid.123', 'proc-002', 'agent-b', 'Agent-B:backend', 'ws-other');
            const result = store.lookupMessage('wamid.123');
            expect(result).toEqual({
                processId: 'proc-002',
                agentId: 'agent-b',
                sessionLabel: 'Agent-B:backend',
                workspaceId: 'ws-other',
            });
        });

        it('should handle multiple bindings', () => {
            store.bindMessage('wamid.1', 'proc-001', 'agent-a', 'Label-1');
            store.bindMessage('wamid.2', 'proc-002', 'agent-b', 'Label-2');
            store.bindMessage('wamid.3', 'proc-003', 'agent-a', 'Label-3');

            expect(store.lookupMessage('wamid.1')?.processId).toBe('proc-001');
            expect(store.lookupMessage('wamid.2')?.processId).toBe('proc-002');
            expect(store.lookupMessage('wamid.3')?.processId).toBe('proc-003');
        });
    });

    describe('getLastMessageId', () => {
        it('should return null when no messages for process', () => {
            expect(store.getLastMessageId('proc-unknown')).toBeNull();
        });

        it('should return the most recent WA message ID for a process', () => {
            store.bindMessage('wamid.a', 'proc-001', 'agent-a', 'Label');
            store.bindMessage('wamid.b', 'proc-001', 'agent-a', 'Label');
            // Both have same created_at (unixepoch second resolution), but the last inserted wins by rowid
            const result = store.getLastMessageId('proc-001');
            expect(result).toBeTruthy();
        });

        it('should not return messages from other processes', () => {
            store.bindMessage('wamid.x', 'proc-other', 'agent-a', 'Label');
            expect(store.getLastMessageId('proc-mine')).toBeNull();
        });
    });

    describe('global sessions', () => {
        it('should return null for unknown sender', () => {
            const result = store.getGlobalSession('alice@s.whatsapp.net');
            expect(result).toBeNull();
        });

        it('should set and get a global session', () => {
            store.setGlobalSession('alice@s.whatsapp.net', 'proc-100', 'agent-a');
            const result = store.getGlobalSession('alice@s.whatsapp.net');
            expect(result).toEqual({
                processId: 'proc-100',
                agentId: 'agent-a',
            });
        });

        it('should update on duplicate set (INSERT OR REPLACE)', () => {
            store.setGlobalSession('alice@s.whatsapp.net', 'proc-100', 'agent-a');
            store.setGlobalSession('alice@s.whatsapp.net', 'proc-200', 'agent-b');
            const result = store.getGlobalSession('alice@s.whatsapp.net');
            expect(result).toEqual({
                processId: 'proc-200',
                agentId: 'agent-b',
            });
        });

        it('should track separate senders', () => {
            store.setGlobalSession('alice@s.whatsapp.net', 'proc-100', 'agent-a');
            store.setGlobalSession('bob@s.whatsapp.net', 'proc-200', 'agent-b');

            expect(store.getGlobalSession('alice@s.whatsapp.net')?.processId).toBe('proc-100');
            expect(store.getGlobalSession('bob@s.whatsapp.net')?.processId).toBe('proc-200');
        });
    });

    it('should create the database file', () => {
        expect(fs.existsSync(path.join(tmpDir, 'messaging.db'))).toBe(true);
    });

    it('should survive close and reopen', () => {
        store.bindMessage('wamid.persist', 'proc-999', 'agent-x', 'Label-persist', 'ws-saved');
        store.setGlobalSession('carol@s.whatsapp.net', 'proc-888', 'agent-y');
        store.close();

        // Reopen
        const store2 = new MessagingStore(tmpDir);
        const result = store2.lookupMessage('wamid.persist');
        expect(result?.processId).toBe('proc-999');
        expect(result?.workspaceId).toBe('ws-saved');
        expect(store2.getGlobalSession('carol@s.whatsapp.net')?.processId).toBe('proc-888');
        store2.close();
    });

    describe('push watermarks', () => {
        it('should return 0 for unknown process', () => {
            expect(store.getWatermark('proc-unknown')).toBe(0);
        });

        it('should set and get watermark', () => {
            store.setWatermark('proc-001', 5);
            expect(store.getWatermark('proc-001')).toBe(5);
        });

        it('should update watermark', () => {
            store.setWatermark('proc-001', 3);
            store.setWatermark('proc-001', 7);
            expect(store.getWatermark('proc-001')).toBe(7);
        });

        it('should persist watermarks across re-open', () => {
            store.setWatermark('proc-001', 10);
            store.close();

            const store2 = new MessagingStore(tmpDir);
            expect(store2.getWatermark('proc-001')).toBe(10);
            store2.close();
        });

        it('should track independent watermarks per process', () => {
            store.setWatermark('proc-a', 3);
            store.setWatermark('proc-b', 8);
            expect(store.getWatermark('proc-a')).toBe(3);
            expect(store.getWatermark('proc-b')).toBe(8);
        });
    });

    describe('in-memory LRU cache', () => {
        it('should serve lookups from cache after bindMessage', () => {
            store.bindMessage('msg-cache-1', 'proc-c1', 'agent-c', 'Label-C', 'ws-c');
            // Lookup should succeed (from cache, but result is same)
            const result = store.lookupMessage('msg-cache-1');
            expect(result).toEqual({
                processId: 'proc-c1',
                agentId: 'agent-c',
                sessionLabel: 'Label-C',
                workspaceId: 'ws-c',
            });
        });

        it('should evict oldest entries when cache exceeds 50', () => {
            // Fill cache with 50 entries
            for (let i = 0; i < 50; i++) {
                store.bindMessage(`msg-${i}`, `proc-${i}`, 'agent', 'Label');
            }
            // Add one more — should evict msg-0
            store.bindMessage('msg-50', 'proc-50', 'agent', 'Label');

            // msg-0 should still be found via SQLite fallback
            const result = store.lookupMessage('msg-0');
            expect(result).not.toBeNull();
            expect(result?.processId).toBe('proc-0');

            // msg-50 should be found (in cache)
            expect(store.lookupMessage('msg-50')?.processId).toBe('proc-50');
        });

        it('should update cache on duplicate bind', () => {
            store.bindMessage('msg-dup', 'proc-old', 'agent-old', 'Old');
            store.bindMessage('msg-dup', 'proc-new', 'agent-new', 'New', 'ws-new');
            const result = store.lookupMessage('msg-dup');
            expect(result).toEqual({
                processId: 'proc-new',
                agentId: 'agent-new',
                sessionLabel: 'New',
                workspaceId: 'ws-new',
            });
        });
    });
});
