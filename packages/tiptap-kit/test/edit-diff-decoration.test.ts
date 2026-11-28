/**
 * Live headless Tiptap tests for EditDiffDecoration.
 *
 * Unlike the source-inspection tests, these instantiate a real Tiptap Editor
 * with the extension loaded and verify command behavior, plugin state, and
 * decoration output at runtime.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    EditDiffDecoration,
    editDiffPluginKey,
    type EditDiffRegion,
    type DiffChunk,
} from '../src/edit-diff/index.js';

function makeEditor(content = '<p>hello world</p>') {
    return new Editor({
        extensions: [StarterKit, EditDiffDecoration],
        content,
    });
}

function makeRegion(overrides: Partial<EditDiffRegion> & { from: number; to: number; chunks: DiffChunk[] }): EditDiffRegion {
    return {
        id: `test-region-${Date.now()}`,
        expiresAt: Date.now() + 60_000, // far future so auto-expiry doesn't interfere
        ...overrides,
    };
}

describe('EditDiffDecoration (live Tiptap)', () => {
    let editor: Editor;

    afterEach(() => {
        editor?.destroy();
    });

    // ── Basic lifecycle ──────────────────────────────────────────────────

    it('initialises without errors alongside StarterKit', () => {
        expect(() => { editor = makeEditor(); }).not.toThrow();
    });

    it('plugin state initialises with empty regions and decorations', () => {
        editor = makeEditor();
        const state = editDiffPluginKey.getState(editor.state);
        expect(state).toBeDefined();
        expect(state!.regions).toEqual([]);
        expect(state!.decorations).toBeDefined();
    });

    // ── setEditDiffs command ───────────────────────────────────────────────

    it('setEditDiffs stores regions in plugin state', () => {
        editor = makeEditor('<p>hello world</p>');
        // "hello world" starts at pos 1 in a <p> node
        const region = makeRegion({
            from: 1,
            to: 6,
            chunks: [{ type: 'add', text: 'hello' }],
        });

        editor.commands.setEditDiffs([region]);

        const state = editDiffPluginKey.getState(editor.state);
        expect(state!.regions).toHaveLength(1);
        expect(state!.regions[0].id).toBe(region.id);
    });

    it('setEditDiffs replaces previous regions', () => {
        editor = makeEditor('<p>hello world</p>');
        const r1 = makeRegion({ id: 'r1', from: 1, to: 6, chunks: [{ type: 'add', text: 'hello' }] });
        const r2 = makeRegion({ id: 'r2', from: 7, to: 12, chunks: [{ type: 'add', text: 'world' }] });

        editor.commands.setEditDiffs([r1]);
        editor.commands.setEditDiffs([r2]);

        const state = editDiffPluginKey.getState(editor.state);
        expect(state!.regions).toHaveLength(1);
        expect(state!.regions[0].id).toBe('r2');
    });

    // ── clearEditDiffs command ─────────────────────────────────────────────

    it('clearEditDiffs removes all regions and decorations', () => {
        editor = makeEditor('<p>hello world</p>');
        const region = makeRegion({ from: 1, to: 6, chunks: [{ type: 'add', text: 'hello' }] });
        editor.commands.setEditDiffs([region]);

        editor.commands.clearEditDiffs();

        const state = editDiffPluginKey.getState(editor.state);
        expect(state!.regions).toEqual([]);
    });

    // ── Decoration rendering ─────────────────────────────────────────────

    it('creates inline decoration with edit-diff-added class for add chunks', () => {
        editor = makeEditor('<p>hello world</p>');
        const region = makeRegion({
            from: 1,
            to: 6,
            chunks: [{ type: 'add', text: 'hello' }],
        });

        editor.commands.setEditDiffs([region]);

        const html = (editor.view.dom as HTMLElement).innerHTML;
        expect(html).toContain('edit-diff-added');
    });

    it('creates widget decoration with edit-diff-removed class for remove chunks', () => {
        editor = makeEditor('<p>hello world</p>');
        // Place a "remove" chunk at position 1 (before text), then an "equal" chunk
        const region = makeRegion({
            from: 1,
            to: 12,
            chunks: [
                { type: 'remove', text: 'old ' },
                { type: 'equal', text: 'hello world' },
            ],
        });

        editor.commands.setEditDiffs([region]);

        const html = (editor.view.dom as HTMLElement).innerHTML;
        expect(html).toContain('edit-diff-removed');
    });

    it('does not create decorations for equal-only chunks', () => {
        editor = makeEditor('<p>hello world</p>');
        const region = makeRegion({
            from: 1,
            to: 12,
            chunks: [{ type: 'equal', text: 'hello world' }],
        });

        editor.commands.setEditDiffs([region]);

        const html = (editor.view.dom as HTMLElement).innerHTML;
        expect(html).not.toContain('edit-diff-added');
        expect(html).not.toContain('edit-diff-removed');
    });

    // ── docChanged clears decorations ────────────────────────────────────

    it('clears decorations when the document changes (user types)', () => {
        editor = makeEditor('<p>hello world</p>');
        const region = makeRegion({
            from: 1,
            to: 6,
            chunks: [{ type: 'add', text: 'hello' }],
        });
        editor.commands.setEditDiffs([region]);

        // Simulate user typing
        editor.commands.insertContentAt(12, '!');

        const state = editDiffPluginKey.getState(editor.state);
        expect(state!.regions).toEqual([]);
    });

    // ── Multiple regions ─────────────────────────────────────────────────

    it('supports multiple regions simultaneously', () => {
        editor = makeEditor('<p>hello world foo</p>');
        const r1 = makeRegion({ id: 'r1', from: 1, to: 6, chunks: [{ type: 'add', text: 'hello' }] });
        const r2 = makeRegion({ id: 'r2', from: 13, to: 16, chunks: [{ type: 'add', text: 'foo' }] });

        editor.commands.setEditDiffs([r1, r2]);

        const state = editDiffPluginKey.getState(editor.state);
        expect(state!.regions).toHaveLength(2);

        const html = (editor.view.dom as HTMLElement).innerHTML;
        // Both regions should produce decorations
        const addedMatches = html.match(/edit-diff-added/g);
        expect(addedMatches?.length).toBeGreaterThanOrEqual(2);
    });

    // ── Mixed add + remove chunks ────────────────────────────────────────

    it('renders both add and remove decorations for mixed diff chunks', () => {
        editor = makeEditor('<p>hello world</p>');
        const region = makeRegion({
            from: 1,
            to: 6,
            chunks: [
                { type: 'remove', text: 'old' },
                { type: 'add', text: 'hello' },
            ],
        });

        editor.commands.setEditDiffs([region]);

        const html = (editor.view.dom as HTMLElement).innerHTML;
        expect(html).toContain('edit-diff-added');
        expect(html).toContain('edit-diff-removed');
    });
});
