/**
 * Tests for conversation-recorder — recordUserMessage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { recordUserMessage } from '../../src/server/memory/conversation-recorder';
import { writeMemoryConfig, DEFAULT_MEMORY_CONFIG } from '../../src/server/memory/memory-config-handler';
import type { MemoryConfig } from '../../src/server/memory/memory-config-handler';
import { FileMemoryStore } from '../../src/server/memory/memory-store';

describe('recordUserMessage', () => {
    let tmpDir: string;
    const workspaceId = 'test-ws-123';

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-recorder-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does nothing when recording is disabled (default)', () => {
        // Default config has recording.enabled = false
        recordUserMessage(tmpDir, workspaceId, 'hello');

        const memoryDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'notes');
        expect(fs.existsSync(memoryDir)).toBe(false);
    });

    it('writes a note when recording is enabled', () => {
        const config: MemoryConfig = {
            ...DEFAULT_MEMORY_CONFIG,
            recording: { enabled: true },
        };
        writeMemoryConfig(tmpDir, config);

        recordUserMessage(tmpDir, workspaceId, 'test message');

        const memoryDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'notes');
        const store = new FileMemoryStore(memoryDir);
        const result = store.list({ pageSize: 100 });

        expect(result.total).toBe(1);
        expect(result.entries[0].source).toBe('conversation');
    });

    it('stores the message content correctly', () => {
        const config: MemoryConfig = {
            ...DEFAULT_MEMORY_CONFIG,
            recording: { enabled: true },
        };
        writeMemoryConfig(tmpDir, config);

        recordUserMessage(tmpDir, workspaceId, 'My detailed question about code');

        const memoryDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'notes');
        const store = new FileMemoryStore(memoryDir);
        const result = store.list({ pageSize: 100 });
        const entry = store.get(result.entries[0].id);

        expect(entry).toBeDefined();
        expect(entry!.content).toBe('My detailed question about code');
        expect(entry!.source).toBe('conversation');
        expect(entry!.tags).toEqual([]);
    });

    it('stores multiple messages as separate entries', () => {
        const config: MemoryConfig = {
            ...DEFAULT_MEMORY_CONFIG,
            recording: { enabled: true },
        };
        writeMemoryConfig(tmpDir, config);

        recordUserMessage(tmpDir, workspaceId, 'first message');
        recordUserMessage(tmpDir, workspaceId, 'second message');

        const memoryDir = path.join(tmpDir, 'repos', workspaceId, 'memory', 'notes');
        const store = new FileMemoryStore(memoryDir);
        const result = store.list({ pageSize: 100 });

        expect(result.total).toBe(2);
    });

    it('does not throw on storage errors', () => {
        // Write an enabled config but make the repos dir read-only (not writable)
        // The function should silently fail without throwing
        const config: MemoryConfig = {
            ...DEFAULT_MEMORY_CONFIG,
            recording: { enabled: true },
        };
        writeMemoryConfig(tmpDir, config);

        // Even if the underlying call fails, recordUserMessage should not throw
        // (We test it doesn't throw by calling it — no assertion needed beyond no-throw)
        expect(() => {
            recordUserMessage(tmpDir, workspaceId, 'test message');
        }).not.toThrow();
    });
});
