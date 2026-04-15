/**
 * Extraction State Manager
 *
 * Tracks which conversations have been processed by the transcript extractor
 * and at what turn count. Persisted as JSON at
 * `~/.coc/repos/<workspaceId>/memory/extraction-state.json`.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Types
// ============================================================================

export interface ExtractionRecord {
    lastTurnCount: number;
    extractedAt: string;
}

export interface ExtractionState {
    [processId: string]: ExtractionRecord;
}

// ============================================================================
// ExtractionStateManager
// ============================================================================

export class ExtractionStateManager {
    private state: ExtractionState | null = null;
    private readonly filePath: string;

    constructor(dataDir: string, workspaceId: string) {
        const memDir = getRepoDataPath(dataDir, workspaceId, 'memory');
        this.filePath = path.join(memDir, 'extraction-state.json');
    }

    /** Load state from disk (lazy, cached). */
    private load(): ExtractionState {
        if (this.state !== null) return this.state;
        try {
            const raw = fs.readFileSync(this.filePath, 'utf-8');
            this.state = JSON.parse(raw) as ExtractionState;
        } catch {
            this.state = {};
        }
        return this.state;
    }

    /**
     * Check whether a process needs extraction.
     * Returns true if:
     * - The process has never been extracted, OR
     * - The turn count has increased since the last extraction (follow-up added)
     */
    needsExtraction(processId: string, currentTurnCount: number): boolean {
        const state = this.load();
        const record = state[processId];
        if (!record) return true;
        return currentTurnCount > record.lastTurnCount;
    }

    /** Mark a process as successfully extracted at the given turn count. */
    markExtracted(processId: string, turnCount: number): void {
        const state = this.load();
        state[processId] = {
            lastTurnCount: turnCount,
            extractedAt: new Date().toISOString(),
        };
    }

    /** Persist state to disk. */
    save(): void {
        const state = this.load();
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });

        // Atomic write: write to tmp then rename
        const tmpPath = this.filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmpPath, this.filePath);
    }

    /** Get the full state (for testing/diagnostics). */
    getState(): ExtractionState {
        return { ...this.load() };
    }
}
