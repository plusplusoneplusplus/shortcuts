/**
 * SPA Dashboard Tests — preview body context menu for comment creation.
 *
 * After React migration (commit 008), the task-comments-ui.ts and
 * task-comments-client.ts vanilla modules are replaced by React components.
 * These tests verify the React component source files exist and contain
 * the expected functionality.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateDashboardHtml } from './spa-test-helpers';

const REACT_COMMENTS_DIR = path.resolve(
    __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react', 'tasks', 'comments'
);

const HOOKS_DIR = path.resolve(
    __dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks'
);

function readReactFile(name: string): string {
    return fs.readFileSync(path.join(REACT_COMMENTS_DIR, name), 'utf8');
}

// ============================================================================
// Comment React components exist and contain expected patterns
// ============================================================================

describe('Comment React components — SelectionToolbar', () => {
    let source: string;
    beforeAll(() => { source = readReactFile('SelectionToolbar.tsx'); });

    it('exports SelectionToolbar component', () => {
        expect(source).toContain('export function SelectionToolbar');
    });

    it('has onAddComment prop', () => {
        expect(source).toContain('onAddComment');
    });

    it('renders via createPortal', () => {
        expect(source).toContain('createPortal');
    });
});

describe('Comment React components — InlineCommentPopup', () => {
    let source: string;
    beforeAll(() => { source = readReactFile('InlineCommentPopup.tsx'); });

    it('exports InlineCommentPopup component', () => {
        expect(source).toContain('export function InlineCommentPopup');
    });

    it('has onSubmit and onCancel props', () => {
        expect(source).toContain('onSubmit');
        expect(source).toContain('onCancel');
    });
});

describe('Comment React components — useTaskComments hook', () => {
    let source: string;
    beforeAll(() => { source = fs.readFileSync(path.join(HOOKS_DIR, 'useTaskComments.ts'), 'utf8'); });

    it('exports useTaskComments hook', () => {
        expect(source).toContain('export function useTaskComments');
    });

    it('defines addComment function', () => {
        expect(source).toContain('addComment');
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
