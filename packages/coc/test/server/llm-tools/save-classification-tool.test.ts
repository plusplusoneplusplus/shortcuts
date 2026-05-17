/**
 * Tests for the saveClassification LLM tool factory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createSaveClassificationTool } from '../../../src/server/llm-tools/save-classification-tool';
import { readClassification } from '../../../src/server/repos/classification-store';
import type { HunkClassification } from '../../../src/server/spa/client/react/features/pull-requests/classification-types';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'save-classification-test-'));
}

const validClassifications: HunkClassification[] = [
    { file: 'src/a.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'New feature' },
    { file: 'src/a.ts', hunkIndex: 1, category: 'mechanical', intensity: 'low', reason: 'Rename' },
];

describe('createSaveClassificationTool', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = makeTempDir(); });

    it('exposes a tool named saveClassification', () => {
        const { tool } = createSaveClassificationTool({
            dataDir, workspaceId: 'ws', repoId: 'repo', prId: '1', headSha: 'sha',
        });
        expect((tool as any).name).toBe('saveClassification');
    });

    it('persists the classifications on a successful call', async () => {
        const { tool, getSaved } = createSaveClassificationTool({
            dataDir, workspaceId: 'ws', repoId: 'repo', prId: '1', headSha: 'sha', processId: 'p-1',
        });
        const result = await (tool as any).handler({ classifications: validClassifications });

        expect(result.success).toBe(true);
        expect(result.count).toBe(2);

        const stored = readClassification(dataDir, 'ws', 'repo', '1', 'sha');
        expect(stored?.result.classifications).toHaveLength(2);
        expect(stored?.processId).toBe('p-1');
        expect(getSaved()).toHaveLength(2);
    });

    it('returns an error and does not write on invalid input', async () => {
        const { tool, getSaved } = createSaveClassificationTool({
            dataDir, workspaceId: 'ws', repoId: 'repo', prId: '1', headSha: 'sha',
        });
        const result = await (tool as any).handler({
            classifications: [{ file: 'a', hunkIndex: 0, category: 'unknown', intensity: 'high', reason: 'x' }],
        });

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/category/);
        expect(result.hint).toBeDefined();
        expect(readClassification(dataDir, 'ws', 'repo', '1', 'sha')).toBeUndefined();
        expect(getSaved()).toBeUndefined();
    });

    it('returns an error when classifications is missing', async () => {
        const { tool } = createSaveClassificationTool({
            dataDir, workspaceId: 'ws', repoId: 'repo', prId: '1', headSha: 'sha',
        });
        const result = await (tool as any).handler({});
        expect(result.success).toBe(false);
    });

    it('returns an error when classifications array is empty', async () => {
        const { tool } = createSaveClassificationTool({
            dataDir, workspaceId: 'ws', repoId: 'repo', prId: '1', headSha: 'sha',
        });
        const result = await (tool as any).handler({ classifications: [] });
        expect(result.success).toBe(false);
    });

    it('allows the AI to retry after a validation failure', async () => {
        const { tool } = createSaveClassificationTool({
            dataDir, workspaceId: 'ws', repoId: 'repo', prId: '1', headSha: 'sha',
        });
        const bad = await (tool as any).handler({
            classifications: [{ file: '', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'x' }],
        });
        expect(bad.success).toBe(false);

        const good = await (tool as any).handler({ classifications: validClassifications });
        expect(good.success).toBe(true);
        expect(readClassification(dataDir, 'ws', 'repo', '1', 'sha')).toBeDefined();
    });
});
