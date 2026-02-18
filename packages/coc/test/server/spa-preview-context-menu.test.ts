/**
 * SPA Dashboard Tests — preview body context menu for comment creation.
 *
 * After React migration, context menu functions from tasks.ts are removed.
 * These tests verify the underlying source modules still contain the logic
 * (task-comments-ui.ts and task-comments-client.ts), to be wired in a
 * future React component (commit 008).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateDashboardHtml } from './spa-test-helpers';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// Preview context menu — source module functions
// ============================================================================

describe('Preview context menu — task-comments-ui source', () => {
    let source: string;
    beforeAll(() => { source = readClientFile('task-comments-ui.ts'); });

    it('defines SelectionToolbar class', () => {
        expect(source).toContain('class SelectionToolbar');
    });

    it('toolbar has onSubmitComment callback', () => {
        expect(source).toContain('onSubmitComment');
    });

    it('renders selection toolbar HTML', () => {
        expect(source).toContain('renderSelectionToolbarHTML');
    });

    it('toolbar creates dispose method', () => {
        expect(source).toContain('dispose');
    });
});

// ============================================================================
// Preview context menu — task-comments-client source
// ============================================================================

describe('Preview context menu — task-comments-client source', () => {
    let source: string;
    beforeAll(() => { source = readClientFile('task-comments-client.ts'); });

    it('defines captureSelectionWithAnchor function', () => {
        expect(source).toContain('captureSelectionWithAnchor');
    });

    it('defines createComment function', () => {
        expect(source).toContain('createComment');
    });
});

// ============================================================================
// Preview context menu — CSS styles
// ============================================================================

describe('Preview context menu — CSS styles in HTML', () => {
    const html = generateDashboardHtml();

    it('defines task-context-menu style', () => {
        expect(html).toContain('task-context-menu');
    });
});
