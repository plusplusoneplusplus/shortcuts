/**
 * Pure canvas-panel helpers: prompt/message composition, type detection,
 * download naming, preview-markdown selection, and the save status label.
 */
import { describe, it, expect, vi } from 'vitest';

// The model imports getMonacoLanguage for its language mapping; the real module
// pulls the Monaco bundle, which cannot load under Node.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/MonacoFileEditor', () => ({
    getMonacoLanguage: (fileName: string) => (fileName.endsWith('.ts') ? 'typescript' : 'plaintext'),
    MonacoFileEditor: () => null,
}));

import {
    buildAskAiPrompt,
    buildCommentsMessage,
    canvasKind,
    downloadFilenameFor,
    fenceCode,
    isSvgCodeCanvas,
    monacoLanguageFor,
    notesPathFor,
    previewMarkdownFor,
    saveStatusLabel,
} from '../../../../../src/server/spa/client/react/features/canvas/canvas-panel-model';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123',
        workspaceId: 'ws-1',
        title: 'My Plan',
        type: 'markdown',
        revision: 3,
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
        lastEditor: 'ai',
        content: '# Plan body',
        ...overrides,
    } as any;
}

describe('canvas-panel-model', () => {
    describe('buildAskAiPrompt', () => {
        it('names the canvas, its id, and the revision the selection came from', () => {
            const prompt = buildAskAiPrompt(makeCanvas(), 'second paragraph');
            expect(prompt).toContain('canvas "My Plan"');
            expect(prompt).toContain('canvasId: doc-abc123');
            expect(prompt).toContain('revision 3');
            expect(prompt).toContain('"""\nsecond paragraph\n"""');
            // Trailing blank lines leave the composer caret below the quote.
            expect(prompt.endsWith('\n\n')).toBe(true);
        });
    });

    describe('buildCommentsMessage', () => {
        it('numbers each comment with its anchor and points the AI at write_canvas', () => {
            const message = buildCommentsMessage(makeCanvas(), [
                { id: 'c1', anchorText: 'intro', body: 'too long', status: 'open' } as any,
                { id: 'c2', anchorText: 'risks', body: 'add mitigation', status: 'open' } as any,
            ]);
            expect(message).toContain('1. On "intro": too long');
            expect(message).toContain('2. On "risks": add mitigation');
            expect(message).toContain('write_canvas');
            expect(message).toContain('read_canvas');
        });

        it('renders an empty batch without a stray list', () => {
            const message = buildCommentsMessage(makeCanvas(), []);
            expect(message).not.toContain('1.');
        });
    });

    describe('isSvgCodeCanvas', () => {
        it('accepts an explicitly svg-tagged code canvas', () => {
            expect(isSvgCodeCanvas({ type: 'code', language: ' SVG ', content: 'anything' } as any)).toBe(true);
        });

        it('sniffs an untagged or xml-tagged code canvas from its leading <svg>', () => {
            expect(isSvgCodeCanvas({ type: 'code', language: undefined, content: '\n  <svg viewBox="0 0 1 1"/>' } as any)).toBe(true);
            expect(isSvgCodeCanvas({ type: 'code', language: 'xml', content: '<svg/>' } as any)).toBe(true);
        });

        it('rejects non-code canvases and other languages', () => {
            expect(isSvgCodeCanvas({ type: 'markdown', language: 'svg', content: '<svg/>' } as any)).toBe(false);
            expect(isSvgCodeCanvas({ type: 'code', language: 'typescript', content: '<svg/>' } as any)).toBe(false);
            expect(isSvgCodeCanvas({ type: 'code', language: undefined, content: 'const a = 1;' } as any)).toBe(false);
        });
    });

    describe('downloadFilenameFor', () => {
        it('strips the id suffix and picks the extension from the canvas type', () => {
            expect(downloadFilenameFor(makeCanvas())).toBe('doc.md');
            expect(downloadFilenameFor(makeCanvas({ type: 'extension' }))).toBe('doc.json');
            expect(downloadFilenameFor(makeCanvas({ type: 'kusto' }))).toBe('doc.json');
            expect(downloadFilenameFor(makeCanvas({ type: 'excalidraw' }))).toBe('doc.excalidraw');
        });

        it('maps known code languages and falls back to the raw language, then txt', () => {
            expect(downloadFilenameFor(makeCanvas({ type: 'code', language: 'typescript' }))).toBe('doc.ts');
            expect(downloadFilenameFor(makeCanvas({ type: 'code', language: 'nim' }))).toBe('doc.nim');
            expect(downloadFilenameFor(makeCanvas({ type: 'code', language: undefined, content: 'x' }))).toBe('doc.txt');
        });

        it('gives an svg code canvas the .svg extension', () => {
            expect(downloadFilenameFor(makeCanvas({ type: 'code', language: undefined, content: '<svg/>' }))).toBe('doc.svg');
        });

        it('keeps an id with no hex suffix intact', () => {
            expect(downloadFilenameFor(makeCanvas({ id: 'plan' }))).toBe('plan.md');
        });
    });

    describe('notesPathFor', () => {
        it('writes under canvases/ with the suffix stripped', () => {
            expect(notesPathFor({ id: 'doc-abc123' } as any)).toBe('canvases/doc.md');
        });
    });

    describe('monacoLanguageFor', () => {
        it('defaults to plaintext and passes unknown hints through untouched', () => {
            expect(monacoLanguageFor(undefined)).toBe('plaintext');
            expect(monacoLanguageFor('ts')).toBe('typescript');
            expect(monacoLanguageFor('nim')).toBe('nim');
        });
    });

    describe('fenceCode', () => {
        it('uses a four-backtick fence so triple-backtick content survives', () => {
            expect(fenceCode('```\nnested\n```', 'md')).toBe('````md\n```\nnested\n```\n````');
        });
    });

    describe('canvasKind + previewMarkdownFor', () => {
        it('routes excalidraw and kusto away from the markdown pipeline entirely', () => {
            for (const type of ['excalidraw', 'kusto']) {
                const canvas = makeCanvas({ type, content: '{}' });
                const kind = canvasKind(canvas, canvas.content);
                expect(previewMarkdownFor(kind, canvas, canvas.content, false)).toBe('');
                // Even a history view stays out of the pipeline.
                expect(previewMarkdownFor(kind, canvas, canvas.content, true)).toBe('');
            }
        });

        it('shows an extension canvas as raw JSON only in a history view', () => {
            const canvas = makeCanvas({ type: 'extension', content: '{"n":1}' });
            const kind = canvasKind(canvas, canvas.content);
            expect(previewMarkdownFor(kind, canvas, canvas.content, false)).toBe('');
            expect(previewMarkdownFor(kind, canvas, canvas.content, true)).toBe('````json\n{"n":1}\n````');
        });

        it('fences code canvases with their language and passes markdown through', () => {
            const code = makeCanvas({ type: 'code', language: 'python', content: 'x = 1' });
            expect(previewMarkdownFor(canvasKind(code, code.content), code, code.content, false))
                .toBe('````python\nx = 1\n````');
            const md = makeCanvas();
            expect(previewMarkdownFor(canvasKind(md, md.content), md, md.content, false)).toBe('# Plan body');
        });

        it('detects svg from the DISPLAYED content, so a history revision is classified on its own body', () => {
            const canvas = makeCanvas({ type: 'code', language: undefined, content: '<svg/>' });
            expect(canvasKind(canvas, '<svg/>').isSvg).toBe(true);
            // An older revision of the same canvas that was not yet SVG.
            expect(canvasKind(canvas, 'const a = 1;').isSvg).toBe(false);
        });

        it('reports every flag false for a missing canvas', () => {
            expect(canvasKind(null, '')).toEqual({
                isCode: false, isSvg: false, isExtension: false, isExcalidraw: false, isKusto: false,
            });
        });
    });

    describe('saveStatusLabel', () => {
        it('prefers the save state over the dirty mark', () => {
            expect(saveStatusLabel('saving', true)).toBe('Saving…');
            expect(saveStatusLabel('saved', false)).toBe('Saved');
            expect(saveStatusLabel('conflict', true)).toBe('Save conflict');
            expect(saveStatusLabel('error', true)).toBe('Save failed');
        });

        it('falls back to the dirty mark, then to nothing', () => {
            expect(saveStatusLabel('idle', true)).toBe('Unsaved edits');
            expect(saveStatusLabel('idle', false)).toBe('');
        });
    });
});
