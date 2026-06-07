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
import { deriveScriptTitle } from '../../src/server/executors/title-generator';

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

    it('only sends the title request when no title exists', () => {
        // The title transform call must come after the guard
        const guardIdx = source.indexOf('if (existing?.title)');
        const sendIdx = source.indexOf('.transform(', guardIdx);
        expect(sendIdx).toBeGreaterThan(guardIdx);
    });

    it('routes title generation through the SDK transform boundary', () => {
        expect(source).toContain('this.options.aiService.transform(');
        // The legacy sendMessage/warm-client path must be gone.
        expect(source).not.toContain('.sendMessage({');
        expect(source).not.toContain('getOrCreateWarmClient');
    });

    it('requests the gpt-5.4-mini model for title generation', () => {
        expect(source).toContain("export const TITLE_GENERATION_MODEL = 'gpt-5.4-mini'");
        expect(source).toContain('model: TITLE_GENERATION_MODEL');
    });

    it('fails when the provider used a different effective model', () => {
        expect(source).toContain('result.effectiveModel !== TITLE_GENERATION_MODEL');
    });

    it('stores the generated title in the process store', () => {
        expect(source).toContain('await this.options.store.updateProcess(processId, { title })');
    });

    it('syncs title to queue task displayName', () => {
        expect(source).toContain('this.queueManager.updateTask(toTaskId(processId), { displayName: title })');
    });

    it('re-syncs existing title to displayName on subsequent calls', () => {
        // When title exists, it still updates the displayName to stay in sync
        expect(source).toContain('this.syncQueueDisplayName(processId, existing.title)');
    });

    it('catches errors without throwing', () => {
        expect(source).toContain('.catch((err)');
        expect(source).toContain('logger.warn');
    });

    it('returns early if no user content is found', () => {
        expect(source).toContain('if (!firstUserContent) return');
    });
});

// ============================================================================
// deriveScriptTitle
// ============================================================================

describe('deriveScriptTitle', () => {
    it('returns the first non-empty line for a simple command', () => {
        expect(deriveScriptTitle('npm install')).toBe('npm install');
    });

    it('skips comment lines and returns first meaningful line', () => {
        const script = `# install deps\nnpm install\nnpm run build`;
        expect(deriveScriptTitle(script)).toBe('npm install');
    });

    it('skips blank lines before the first meaningful line', () => {
        const script = `\n\nnpm test`;
        expect(deriveScriptTitle(script)).toBe('npm test');
    });

    it('handles multi-line script with mixed comments and blanks', () => {
        const script = `# Step 1\n# Step 2\n\ngit status`;
        expect(deriveScriptTitle(script)).toBe('git status');
    });

    it('truncates long first lines to 60 characters', () => {
        const longLine = 'a'.repeat(80);
        expect(deriveScriptTitle(longLine)).toBe('a'.repeat(60));
        expect(deriveScriptTitle(longLine).length).toBe(60);
    });

    it('returns "Script" for an empty string', () => {
        expect(deriveScriptTitle('')).toBe('Script');
    });

    it('returns "Script" for a comment-only script', () => {
        expect(deriveScriptTitle('# just a comment\n# another comment')).toBe('Script');
    });

    it('returns "Script" for a whitespace-only script', () => {
        expect(deriveScriptTitle('   \n  \n')).toBe('Script');
    });

    it('returns the line as-is when exactly 60 characters', () => {
        const line = 'x'.repeat(60);
        expect(deriveScriptTitle(line)).toBe(line);
    });
});
