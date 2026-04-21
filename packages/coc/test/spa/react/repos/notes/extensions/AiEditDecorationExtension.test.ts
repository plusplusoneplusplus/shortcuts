/**
 * Source-inspection tests for AiEditDecorationExtension.
 *
 * Validates the module's structure, exports, and key implementation details
 * without requiring a live Tiptap/ProseMirror editor instance.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const EXT_PATH = path.join(
    __dirname,
    '..', '..', '..', '..', '..', '..', '..', '..', '..', '..', '..', '..',
    'src', 'server', 'spa', 'client', 'react', 'repos', 'notes', 'extensions', 'AiEditDecorationExtension.ts',
);

const SRC_PATH = path.resolve(
    __dirname,
    '../../../../../../src/server/spa/client/react/repos/notes/extensions/AiEditDecorationExtension.ts',
);

describe('AiEditDecorationExtension (source inspection)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(SRC_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports AiEditDecorationExtension', () => {
            expect(source).toContain('export const AiEditDecorationExtension');
        });

        it('exports AiEditRegion interface', () => {
            expect(source).toContain('export interface AiEditRegion');
        });

        it('exports aiEditPluginKey', () => {
            expect(source).toContain('export const aiEditPluginKey');
        });
    });

    describe('AiEditRegion interface', () => {
        it('has id, from, to, chunks, expiresAt fields', () => {
            expect(source).toContain('id: string');
            expect(source).toContain('from: number');
            expect(source).toContain('to: number');
            expect(source).toContain('chunks: DiffChunk[]');
            expect(source).toContain('expiresAt?: number');
        });
    });

    describe('Tiptap commands', () => {
        it('declares setAiEdits command', () => {
            expect(source).toContain('setAiEdits');
        });

        it('declares clearAiEdits command', () => {
            expect(source).toContain('clearAiEdits');
        });

        it('augments @tiptap/core Commands interface', () => {
            expect(source).toContain("declare module '@tiptap/core'");
        });
    });

    describe('decoration classes', () => {
        it('uses ai-edit-added CSS class for added words', () => {
            expect(source).toContain('ai-edit-added');
        });

        it('uses ai-edit-removed CSS class for removed words', () => {
            expect(source).toContain('ai-edit-removed');
        });

        it('builds Decoration.inline for added chunks', () => {
            expect(source).toContain('Decoration.inline');
        });

        it('builds Decoration.widget for removed chunks', () => {
            expect(source).toContain('Decoration.widget');
        });
    });

    describe('auto-expiry', () => {
        it('schedules expiry using setTimeout or requestAnimationFrame', () => {
            const hasTimeout = source.includes('setTimeout');
            const hasRaf = source.includes('requestAnimationFrame');
            expect(hasTimeout || hasRaf).toBe(true);
        });

        it('stores timer ids per region', () => {
            expect(source).toContain('new Map');
        });
    });

    describe('plugin state', () => {
        it('uses PluginKey with name aiEditDecoration', () => {
            expect(source).toContain("new PluginKey");
            expect(source).toContain("'aiEditDecoration'");
        });

        it('clears decorations on docChanged', () => {
            expect(source).toContain('tr.docChanged');
            expect(source).toContain('DecorationSet.empty');
        });
    });
});
