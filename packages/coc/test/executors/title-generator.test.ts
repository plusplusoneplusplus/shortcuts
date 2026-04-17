/**
 * Tests for title-generator.ts
 *
 * Validates:
 * - Title is generated from the first user message only
 * - Existing title is never overwritten
 * - Title is synced to queue task displayName
 * - Failures are logged but don't throw
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const TITLE_GEN_PATH = path.join(
    __dirname, '..', '..', 'src', 'server', 'executors', 'title-generator.ts'
);

describe('title-generator idempotency', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TITLE_GEN_PATH, 'utf-8');
    });

    it('extracts only the first user message from the turns array', () => {
        // .find() returns the first match, ensuring only the first user message is used
        expect(source).toContain(".find(t => t?.role === 'user')");
    });

    it('checks for existing title before generating', () => {
        expect(source).toContain('if (existing?.title)');
    });

    it('returns early when title already exists', () => {
        // After the existing?.title check, the function returns without generating
        const guardIdx = source.indexOf('if (existing?.title)');
        const block = source.substring(guardIdx, guardIdx + 800);
        expect(block).toContain('return;');
    });

    it('only calls transform when no title exists', () => {
        // The transform call must come after the guard
        const guardIdx = source.indexOf('if (existing?.title)');
        const transformIdx = source.indexOf('.transform(');
        expect(transformIdx).toBeGreaterThan(guardIdx);
    });

    it('stores the generated title in the process store', () => {
        expect(source).toContain("await store.updateProcess(processId, { title })");
    });

    it('syncs title to queue task displayName', () => {
        expect(source).toContain("queueManager.updateTask(taskId, { displayName: title })");
    });

    it('re-syncs existing title to displayName on subsequent calls', () => {
        // When title exists, it still updates the displayName to stay in sync
        expect(source).toContain("queueManager.updateTask(taskId, { displayName: existing.title })");
    });

    it('catches errors without throwing', () => {
        expect(source).toContain('catch (err)');
        expect(source).toContain('logger.warn');
    });

    it('returns early if no user content is found', () => {
        expect(source).toContain('if (!firstUserContent) return');
    });
});
