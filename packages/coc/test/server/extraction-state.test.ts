/**
 * Tests for ExtractionStateManager
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExtractionStateManager } from '../../src/server/memory/extraction-state';

describe('ExtractionStateManager', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-state-test-'));
        // Create the repos/ws1/memory directory structure
        fs.mkdirSync(path.join(tmpDir, 'repos', 'ws1', 'memory'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns needsExtraction=true for unknown process', () => {
        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        expect(mgr.needsExtraction('proc-1', 5)).toBe(true);
    });

    it('returns needsExtraction=false after marking extracted', () => {
        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        mgr.markExtracted('proc-1', 5);
        mgr.save();

        expect(mgr.needsExtraction('proc-1', 5)).toBe(false);
    });

    it('returns needsExtraction=true when turn count increased', () => {
        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        mgr.markExtracted('proc-1', 5);
        mgr.save();

        expect(mgr.needsExtraction('proc-1', 8)).toBe(true);
    });

    it('persists state across instances', () => {
        const mgr1 = new ExtractionStateManager(tmpDir, 'ws1');
        mgr1.markExtracted('proc-1', 10);
        mgr1.save();

        // New instance reads from disk
        const mgr2 = new ExtractionStateManager(tmpDir, 'ws1');
        expect(mgr2.needsExtraction('proc-1', 10)).toBe(false);
        expect(mgr2.needsExtraction('proc-1', 12)).toBe(true);
    });

    it('handles missing state file gracefully', () => {
        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        // No file exists yet — should not throw
        expect(mgr.getState()).toEqual({});
    });

    it('handles corrupted state file gracefully', () => {
        const memDir = path.join(tmpDir, 'repos', 'ws1', 'memory');
        fs.writeFileSync(path.join(memDir, 'extraction-state.json'), 'not-valid-json', 'utf-8');

        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        expect(mgr.getState()).toEqual({});
        expect(mgr.needsExtraction('any', 1)).toBe(true);
    });

    it('tracks multiple processes independently', () => {
        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        mgr.markExtracted('proc-1', 5);
        mgr.markExtracted('proc-2', 10);
        mgr.save();

        expect(mgr.needsExtraction('proc-1', 5)).toBe(false);
        expect(mgr.needsExtraction('proc-2', 10)).toBe(false);
        expect(mgr.needsExtraction('proc-3', 1)).toBe(true);
    });

    it('getState returns copy of internal state', () => {
        const mgr = new ExtractionStateManager(tmpDir, 'ws1');
        mgr.markExtracted('proc-1', 5);
        const state = mgr.getState();
        expect(state['proc-1']).toBeDefined();
        expect(state['proc-1'].lastTurnCount).toBe(5);
        expect(typeof state['proc-1'].extractedAt).toBe('string');
    });

    it('creates parent directories on save', () => {
        // Use a fresh workspace ID that doesn't have the dir yet
        fs.mkdirSync(path.join(tmpDir, 'repos', 'new-ws'), { recursive: true });
        const mgr = new ExtractionStateManager(tmpDir, 'new-ws');
        mgr.markExtracted('proc-1', 3);
        // Should not throw even though memory dir doesn't exist
        mgr.save();

        const filePath = path.join(tmpDir, 'repos', 'new-ws', 'memory', 'extraction-state.json');
        expect(fs.existsSync(filePath)).toBe(true);
    });
});
