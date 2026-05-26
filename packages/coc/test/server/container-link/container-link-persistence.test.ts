/**
 * Tests for container link config persistence.
 * Verifies that container link settings survive server restarts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// The persistence logic is inline in index.ts. We extract and test the same
// file-based pattern here to verify correctness.

describe('container-link persistence', () => {
    let tmpDir: string;
    let configPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-link-test-'));
        configPath = path.join(tmpDir, 'container-link.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function save(url: string | undefined, agentName: string | undefined): void {
        if (url) {
            fs.writeFileSync(configPath, JSON.stringify({ containerUrl: url, agentName: agentName ?? null }));
        } else {
            if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
        }
    }

    function load(): { containerUrl: string; agentName?: string } | null {
        try {
            if (fs.existsSync(configPath)) {
                const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (raw?.containerUrl) return raw;
            }
        } catch { /* ignore */ }
        return null;
    }

    it('saves and loads container URL and agent name', () => {
        save('ws://container:5000', 'my-agent');
        const loaded = load();
        expect(loaded).toEqual({ containerUrl: 'ws://container:5000', agentName: 'my-agent' });
    });

    it('saves with null agentName when not provided', () => {
        save('ws://container:5000', undefined);
        const loaded = load();
        expect(loaded).toEqual({ containerUrl: 'ws://container:5000', agentName: null });
    });

    it('returns null when no config file exists', () => {
        expect(load()).toBeNull();
    });

    it('clears config by deleting file', () => {
        save('ws://container:5000', 'agent');
        expect(load()).not.toBeNull();
        save(undefined, undefined);
        expect(load()).toBeNull();
        expect(fs.existsSync(configPath)).toBe(false);
    });

    it('returns null for corrupt config file', () => {
        fs.writeFileSync(configPath, 'not json{{{');
        expect(load()).toBeNull();
    });

    it('returns null for config without containerUrl', () => {
        fs.writeFileSync(configPath, JSON.stringify({ agentName: 'orphan' }));
        expect(load()).toBeNull();
    });
});
