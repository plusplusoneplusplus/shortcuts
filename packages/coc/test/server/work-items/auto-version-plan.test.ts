import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import { autoVersionPlanFromResolvedComments } from '../../../src/server/work-items/work-item-executor';
import type { WorkItem } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test description',
        status: 'aiDone',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-auto-version-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('autoVersionPlanFromResolvedComments', () => {
    it('creates a new plan version from revisedContent in process result', async () => {
        const item = makeWorkItem({
            id: 'wi-resolve-1',
            plan: { version: 1, content: 'Original plan', updatedAt: '2026-01-01T00:00:00.000Z' },
        });
        await store.addWorkItem(item);
        // Save initial plan version
        await store.savePlanVersion('wi-resolve-1', {
            version: 1,
            content: 'Original plan',
            createdAt: '2026-01-01T00:00:00.000Z',
            resolvedBy: 'user',
        });

        const processResult = JSON.stringify({
            response: 'Revised plan from AI',
            revisedContent: 'Revised plan from AI',
            commentIds: ['c1', 'c2'],
        });

        const updated = await autoVersionPlanFromResolvedComments('wi-resolve-1', processResult, store);

        expect(updated).toBeDefined();
        expect(updated!.plan!.version).toBe(2);
        expect(updated!.plan!.content).toBe('Revised plan from AI');
        expect(updated!.plan!.resolvedBy).toBe('ai');

        // Verify plan version was saved
        const versions = await store.getPlanVersions('wi-resolve-1');
        expect(versions.length).toBe(2);
        const v2 = versions.find(v => v.version === 2);
        expect(v2).toBeDefined();
        expect(v2!.content).toBe('Revised plan from AI');
        expect(v2!.resolvedBy).toBe('ai');
        expect(v2!.summary).toBe('Plan updated from resolved comments');
    });

    it('falls back to response field when revisedContent is missing', async () => {
        const item = makeWorkItem({
            id: 'wi-fallback',
            plan: { version: 1, content: 'Original', updatedAt: '2026-01-01T00:00:00.000Z' },
        });
        await store.addWorkItem(item);

        const processResult = JSON.stringify({
            response: 'AI response as plan',
            commentIds: ['c1'],
        });

        const updated = await autoVersionPlanFromResolvedComments('wi-fallback', processResult, store);

        expect(updated).toBeDefined();
        expect(updated!.plan!.content).toBe('AI response as plan');
        expect(updated!.plan!.version).toBe(2);
    });

    it('does not create a version when content is unchanged', async () => {
        const item = makeWorkItem({
            id: 'wi-same',
            plan: { version: 1, content: 'Same content', updatedAt: '2026-01-01T00:00:00.000Z' },
        });
        await store.addWorkItem(item);

        const processResult = JSON.stringify({
            response: 'Same content',
            revisedContent: 'Same content',
            commentIds: ['c1'],
        });

        const updated = await autoVersionPlanFromResolvedComments('wi-same', processResult, store);
        expect(updated).toBeUndefined();
    });

    it('ignores whitespace-only differences', async () => {
        const item = makeWorkItem({
            id: 'wi-whitespace',
            plan: { version: 1, content: 'Same content', updatedAt: '2026-01-01T00:00:00.000Z' },
        });
        await store.addWorkItem(item);

        const processResult = JSON.stringify({
            revisedContent: '  Same content  ',
            commentIds: [],
        });

        const updated = await autoVersionPlanFromResolvedComments('wi-whitespace', processResult, store);
        expect(updated).toBeUndefined();
    });

    it('returns undefined when processResult is undefined', async () => {
        const item = makeWorkItem({ id: 'wi-noresult' });
        await store.addWorkItem(item);

        const updated = await autoVersionPlanFromResolvedComments('wi-noresult', undefined, store);
        expect(updated).toBeUndefined();
    });

    it('returns undefined when processResult has no revisedContent or response', async () => {
        const item = makeWorkItem({ id: 'wi-empty' });
        await store.addWorkItem(item);

        const processResult = JSON.stringify({ commentIds: ['c1'] });
        const updated = await autoVersionPlanFromResolvedComments('wi-empty', processResult, store);
        expect(updated).toBeUndefined();
    });

    it('returns undefined when work item does not exist', async () => {
        const processResult = JSON.stringify({
            revisedContent: 'New content',
            commentIds: ['c1'],
        });

        const updated = await autoVersionPlanFromResolvedComments('nonexistent', processResult, store);
        expect(updated).toBeUndefined();
    });

    it('creates version 1 when work item has no prior plan', async () => {
        const item = makeWorkItem({ id: 'wi-noplan' });
        await store.addWorkItem(item);

        const processResult = JSON.stringify({
            revisedContent: 'Brand new plan',
            commentIds: ['c1'],
        });

        const updated = await autoVersionPlanFromResolvedComments('wi-noplan', processResult, store);

        expect(updated).toBeDefined();
        expect(updated!.plan!.version).toBe(1);
        expect(updated!.plan!.content).toBe('Brand new plan');
        expect(updated!.plan!.resolvedBy).toBe('ai');
    });

    it('handles pre-parsed object result (not JSON string)', async () => {
        const item = makeWorkItem({
            id: 'wi-obj',
            plan: { version: 2, content: 'Old plan', updatedAt: '2026-01-01T00:00:00.000Z' },
        });
        await store.addWorkItem(item);

        const processResult = {
            revisedContent: 'Updated plan from object',
            commentIds: ['c1'],
        } as unknown as string;

        const updated = await autoVersionPlanFromResolvedComments('wi-obj', processResult, store);

        expect(updated).toBeDefined();
        expect(updated!.plan!.version).toBe(3);
        expect(updated!.plan!.content).toBe('Updated plan from object');
    });

    it('increments version correctly from existing plan version', async () => {
        const item = makeWorkItem({
            id: 'wi-inc',
            plan: { version: 5, content: 'v5 plan', updatedAt: '2026-01-01T00:00:00.000Z' },
        });
        await store.addWorkItem(item);

        const processResult = JSON.stringify({
            revisedContent: 'v6 plan',
            commentIds: [],
        });

        const updated = await autoVersionPlanFromResolvedComments('wi-inc', processResult, store);

        expect(updated).toBeDefined();
        expect(updated!.plan!.version).toBe(6);

        const versions = await store.getPlanVersions('wi-inc');
        const v6 = versions.find(v => v.version === 6);
        expect(v6).toBeDefined();
        expect(v6!.content).toBe('v6 plan');
    });
});
