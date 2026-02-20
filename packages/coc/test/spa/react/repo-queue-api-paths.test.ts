/**
 * Tests for RepoQueueTab API path correctness.
 *
 * Verifies that cancel, move-up, and move-to-top operations use the correct
 * server API paths:
 *   - Cancel: DELETE /api/queue/:id  (not POST /api/queue/tasks/:id/cancel)
 *   - Move up: POST /api/queue/:id/move-up  (not /api/queue/tasks/:id/move-up)
 *   - Move to top: POST /api/queue/:id/move-to-top  (not /api/queue/tasks/:id/move-to-top)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_QUEUE_TAB_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoQueueTab.tsx'
);

describe('RepoQueueTab API paths', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_QUEUE_TAB_PATH, 'utf-8');
    });

    it('cancel uses DELETE /queue/:id (not /queue/tasks/:id/cancel)', () => {
        expect(source).not.toContain('/queue/tasks/');
        expect(source).toContain("method: 'DELETE'");
    });

    it('move-up uses POST /queue/:id/move-up', () => {
        expect(source).toContain("'/queue/'");
        expect(source).toContain("+ '/move-up'");
    });

    it('move-to-top uses POST /queue/:id/move-to-top', () => {
        expect(source).toContain("+ '/move-to-top'");
    });

    it('does not reference the incorrect /queue/tasks/ path segment', () => {
        const lines = source.split('\n');
        const apiCallLines = lines.filter(line =>
            line.includes('getApiBase()') && line.includes('/queue/')
        );
        for (const line of apiCallLines) {
            expect(line).not.toContain('/queue/tasks/');
        }
    });
});
