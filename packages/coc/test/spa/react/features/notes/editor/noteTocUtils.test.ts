import { describe, it, expect } from 'vitest';
import { extractHeadings } from '../../../../../../src/server/spa/client/react/features/notes/editor/noteTocUtils';
import type { TocEntry } from '../../../../../../src/server/spa/client/react/features/notes/editor/noteTocUtils';

// ── Mock ProseMirror doc helpers ─────────────────────────────────────────────

function makeHeadingNode(level: 1 | 2 | 3, text: string) {
    return {
        type: { name: 'heading' },
        attrs: { level },
        textContent: text,
    };
}

function makeParagraphNode(text: string) {
    return {
        type: { name: 'paragraph' },
        attrs: {},
        textContent: text,
    };
}

function makeDoc(items: Array<{ node: ReturnType<typeof makeHeadingNode | typeof makeParagraphNode>; pos: number }>) {
    return {
        descendants: (cb: (node: any, pos: number) => void) => {
            for (const { node, pos } of items) {
                cb(node, pos);
            }
        },
    };
}

function makeEditor(items: Array<{ node: any; pos: number }>) {
    return {
        state: { doc: makeDoc(items) },
    } as any;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('extractHeadings', () => {
    it('returns empty array when document has no headings', () => {
        const editor = makeEditor([
            { node: makeParagraphNode('Hello'), pos: 1 },
            { node: makeParagraphNode('World'), pos: 10 },
        ]);
        expect(extractHeadings(editor)).toEqual([]);
    });

    it('returns single H1 entry', () => {
        const editor = makeEditor([
            { node: makeHeadingNode(1, 'My Title'), pos: 1 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject<Partial<TocEntry>>({
            index: 0,
            level: 1,
            text: 'My Title',
            pos: 1,
        });
    });

    it('collects H1, H2, H3 in document order', () => {
        const editor = makeEditor([
            { node: makeHeadingNode(1, 'Chapter'), pos: 1 },
            { node: makeParagraphNode('intro'), pos: 10 },
            { node: makeHeadingNode(2, 'Section'), pos: 20 },
            { node: makeHeadingNode(3, 'Sub-section'), pos: 30 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries).toHaveLength(3);
        expect(entries[0]).toMatchObject({ index: 0, level: 1, text: 'Chapter', pos: 1 });
        expect(entries[1]).toMatchObject({ index: 1, level: 2, text: 'Section', pos: 20 });
        expect(entries[2]).toMatchObject({ index: 2, level: 3, text: 'Sub-section', pos: 30 });
    });

    it('skips non-heading nodes', () => {
        const editor = makeEditor([
            { node: makeParagraphNode('plain text'), pos: 0 },
            { node: { type: { name: 'bulletList' }, attrs: {}, textContent: 'item' }, pos: 5 },
            { node: makeHeadingNode(2, 'Only heading'), pos: 15 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('Only heading');
    });

    it('skips headings with empty text content', () => {
        const editor = makeEditor([
            { node: makeHeadingNode(1, ''), pos: 1 },
            { node: makeHeadingNode(1, '  '), pos: 5 },
            { node: makeHeadingNode(2, 'Real heading'), pos: 10 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe('Real heading');
    });

    it('skips headings with level outside H1–H3', () => {
        const editor = makeEditor([
            { node: { type: { name: 'heading' }, attrs: { level: 4 }, textContent: 'H4' }, pos: 1 },
            { node: { type: { name: 'heading' }, attrs: { level: 6 }, textContent: 'H6' }, pos: 10 },
            { node: makeHeadingNode(1, 'Valid'), pos: 20 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries).toHaveLength(1);
        expect(entries[0].level).toBe(1);
    });

    it('assigns sequential zero-based index values', () => {
        const editor = makeEditor([
            { node: makeHeadingNode(1, 'A'), pos: 1 },
            { node: makeHeadingNode(2, 'B'), pos: 5 },
            { node: makeHeadingNode(3, 'C'), pos: 10 },
            { node: makeHeadingNode(1, 'D'), pos: 15 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries.map(e => e.index)).toEqual([0, 1, 2, 3]);
    });

    it('trims whitespace from heading text', () => {
        const editor = makeEditor([
            { node: makeHeadingNode(1, '  Trimmed  '), pos: 1 },
        ]);
        const entries = extractHeadings(editor);
        expect(entries[0].text).toBe('Trimmed');
    });

    it('preserves document position in each entry', () => {
        const positions = [5, 100, 200];
        const editor = makeEditor([
            { node: makeHeadingNode(1, 'First'), pos: positions[0] },
            { node: makeHeadingNode(2, 'Second'), pos: positions[1] },
            { node: makeHeadingNode(3, 'Third'), pos: positions[2] },
        ]);
        const entries = extractHeadings(editor);
        expect(entries.map(e => e.pos)).toEqual(positions);
    });
});
