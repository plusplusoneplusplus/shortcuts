/**
 * Tests for appendMemoryContext in prompt-builder.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appendMemoryContext } from '../../src/server/executors/prompt-builder';
import { writeRepoPreferences } from '../../src/server/preferences-handler';
import type { SystemMessageConfig } from '@plusplusoneplusplus/forge';

// ============================================================================
// Helpers
// ============================================================================

const WORKSPACE_ID = 'test-ws-memory';

function writeConsolidated(dataDir: string, workspaceId: string, content: string): void {
    const consolidatedDir = path.join(dataDir, 'repos', workspaceId, 'memory', 'observations');
    fs.mkdirSync(consolidatedDir, { recursive: true });
    fs.writeFileSync(path.join(consolidatedDir, 'consolidated.md'), content, 'utf-8');
}

// ============================================================================
// Tests
// ============================================================================

describe('appendMemoryContext', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-inject-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns unchanged when workspaceId is undefined', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, undefined);
        expect(result).toBe(msg);
    });

    it('returns unchanged when dataDir is undefined', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, undefined, WORKSPACE_ID);
        expect(result).toBe(msg);
    });

    it('returns unchanged when memoryExtraction is not enabled', () => {
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);
        expect(result).toBe(msg);
    });

    it('returns unchanged when memoryExtraction is disabled', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: false } });
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);
        expect(result).toBe(msg);
    });

    it('returns unchanged when no consolidated.md exists', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);
        expect(result).toBe(msg);
    });

    it('returns unchanged when consolidated.md is empty', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
        writeConsolidated(tmpDir, WORKSPACE_ID, '   \n  ');
        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);
        expect(result).toBe(msg);
    });

    it('appends memory context to existing system message', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
        writeConsolidated(tmpDir, WORKSPACE_ID, '- Project uses TypeScript\n- Tests use Vitest');

        const msg: SystemMessageConfig = { mode: 'append', content: 'You are a helpful assistant.' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);

        expect(result).not.toBe(msg);
        expect(result?.content).toContain('You are a helpful assistant.');
        expect(result?.content).toContain('## Project Memory');
        expect(result?.content).toContain('Project uses TypeScript');
        expect(result?.content).toContain('Tests use Vitest');
        expect(result?.content).toContain('verify against current code');
        expect(result?.mode).toBe('append');
    });

    it('creates system message from undefined when memory exists', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
        writeConsolidated(tmpDir, WORKSPACE_ID, '- Deploys via CI/CD');

        const result = appendMemoryContext(undefined, tmpDir, WORKSPACE_ID);

        expect(result).not.toBeUndefined();
        expect(result?.content).toContain('## Project Memory');
        expect(result?.content).toContain('Deploys via CI/CD');
        expect(result?.mode).toBe('append');
    });

    it('truncates large consolidated content', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
        const largeContent = 'x'.repeat(10000);
        writeConsolidated(tmpDir, WORKSPACE_ID, largeContent);

        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);

        expect(result?.content).toContain('truncated');
        // Should be capped around 8K + header + truncation message
        expect(result!.content.length).toBeLessThan(9000);
    });

    it('does not truncate content under the size cap', () => {
        writeRepoPreferences(tmpDir, WORKSPACE_ID, { memoryExtraction: { enabled: true } });
        const shortContent = 'Short memory fact';
        writeConsolidated(tmpDir, WORKSPACE_ID, shortContent);

        const msg: SystemMessageConfig = { mode: 'append', content: 'base' };
        const result = appendMemoryContext(msg, tmpDir, WORKSPACE_ID);

        expect(result?.content).not.toContain('truncated');
        expect(result?.content).toContain('Short memory fact');
    });
});
