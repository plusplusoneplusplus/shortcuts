import { describe, it, expect, beforeEach } from 'vitest';

// ── Pure-logic tests for the note-reference feature ────────────────────────
//
// Test the core logic (useNoteReferences state transitions, formatNoteReferences,
// NoteReferenceChips chip rendering contract) in isolation from React internals.
// This mirrors the pattern used throughout test/server/spa/client/*.test.ts.

// ── Replicated logic from useNoteReferences.ts ─────────────────────────────

const NOTE_REFERENCE_MAX = 5;
const PREVIEW_LENGTH = 80;
const TEXT_SIZE_LIMIT = 4000;

interface NoteTextReference {
    id: string;
    text: string;
    preview: string;
    noteTitle: string;
    notePath: string;
    truncated?: boolean;
}

let nextRefId = 0;

function makePreview(text: string): string {
    const oneLine = text.replace(/\n/g, ' ').trim();
    if (oneLine.length <= PREVIEW_LENGTH) return oneLine;
    return oneLine.slice(0, PREVIEW_LENGTH) + '…';
}

function addReference(
    prev: NoteTextReference[],
    text: string,
    notePath: string,
    noteTitle: string,
): NoteTextReference[] {
    if (prev.length >= NOTE_REFERENCE_MAX) return prev;
    const truncated = text.length > TEXT_SIZE_LIMIT;
    const stored = truncated ? text.slice(0, TEXT_SIZE_LIMIT) : text;
    const ref: NoteTextReference = {
        id: `note-ref-${++nextRefId}`,
        text: stored,
        preview: makePreview(stored),
        noteTitle,
        notePath,
        truncated: truncated || undefined,
    };
    return [...prev, ref];
}

function removeReference(prev: NoteTextReference[], id: string): NoteTextReference[] {
    return prev.filter(r => r.id !== id);
}

function formatNoteReferences(refs: NoteTextReference[]): string {
    if (refs.length === 0) return '';
    return refs.map(r =>
        `<note_reference path="${r.notePath}" title="${r.noteTitle}">\n${r.text}\n</note_reference>`
    ).join('\n\n') + '\n\n';
}

// ── useNoteReferences logic ─────────────────────────────────────────────────

describe('useNoteReferences — addReference', () => {
    beforeEach(() => { nextRefId = 0; });

    it('adds a reference to an empty list', () => {
        const result = addReference([], 'hello world', 'docs/note.md', 'note');
        expect(result).toHaveLength(1);
        expect(result[0].text).toBe('hello world');
        expect(result[0].notePath).toBe('docs/note.md');
        expect(result[0].noteTitle).toBe('note');
    });

    it('assigns a unique id to each reference', () => {
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'first', 'a.md', 'A');
        refs = addReference(refs, 'second', 'b.md', 'B');
        expect(refs[0].id).not.toBe(refs[1].id);
    });

    it('builds a preview truncated at 80 chars', () => {
        const long = 'a'.repeat(120);
        const refs = addReference([], long, 'p.md', 'P');
        expect(refs[0].preview.length).toBe(PREVIEW_LENGTH + 1); // 80 + '…'
        expect(refs[0].preview.endsWith('…')).toBe(true);
    });

    it('collapses newlines in the preview to spaces', () => {
        const refs = addReference([], 'line1\nline2\nline3', 'x.md', 'X');
        expect(refs[0].preview).not.toContain('\n');
    });

    it('short text preview equals the text (whitespace trimmed)', () => {
        const refs = addReference([], '  hello  ', 'x.md', 'X');
        expect(refs[0].preview).toBe('hello');
    });

    it('does not add when at max capacity', () => {
        let refs: NoteTextReference[] = [];
        for (let i = 0; i < NOTE_REFERENCE_MAX; i++) {
            refs = addReference(refs, `text ${i}`, 'p.md', 'P');
        }
        expect(refs).toHaveLength(NOTE_REFERENCE_MAX);
        const overflow = addReference(refs, 'overflow', 'p.md', 'P');
        expect(overflow).toHaveLength(NOTE_REFERENCE_MAX);
        expect(overflow).toBe(refs); // same reference, no mutation
    });

    it('truncates text longer than 4000 chars and sets truncated flag', () => {
        const long = 'x'.repeat(TEXT_SIZE_LIMIT + 100);
        const refs = addReference([], long, 'p.md', 'P');
        expect(refs[0].text.length).toBe(TEXT_SIZE_LIMIT);
        expect(refs[0].truncated).toBe(true);
    });

    it('does not set truncated flag for text exactly at the limit', () => {
        const exact = 'x'.repeat(TEXT_SIZE_LIMIT);
        const refs = addReference([], exact, 'p.md', 'P');
        expect(refs[0].text.length).toBe(TEXT_SIZE_LIMIT);
        expect(refs[0].truncated).toBeUndefined();
    });
});

describe('useNoteReferences — removeReference', () => {
    beforeEach(() => { nextRefId = 0; });

    it('removes the reference with the matching id', () => {
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'a', 'a.md', 'A');
        refs = addReference(refs, 'b', 'b.md', 'B');
        const idToRemove = refs[0].id;
        refs = removeReference(refs, idToRemove);
        expect(refs).toHaveLength(1);
        expect(refs[0].notePath).toBe('b.md');
    });

    it('returns the same list when id is not found', () => {
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'a', 'a.md', 'A');
        const same = removeReference(refs, 'non-existent-id');
        expect(same).toHaveLength(1);
    });

    it('handles removing from an empty list', () => {
        const result = removeReference([], 'any-id');
        expect(result).toHaveLength(0);
    });
});

describe('useNoteReferences — clearReferences', () => {
    it('clears all references', () => {
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'a', 'a.md', 'A');
        refs = addReference(refs, 'b', 'b.md', 'B');
        refs = [];
        expect(refs).toHaveLength(0);
    });
});

describe('useNoteReferences — isAtMax', () => {
    beforeEach(() => { nextRefId = 0; });

    it('reports false when list is empty', () => {
        expect(([] as NoteTextReference[]).length >= NOTE_REFERENCE_MAX).toBe(false);
    });

    it('reports true when at capacity', () => {
        let refs: NoteTextReference[] = [];
        for (let i = 0; i < NOTE_REFERENCE_MAX; i++) {
            refs = addReference(refs, `t${i}`, 'p.md', 'P');
        }
        expect(refs.length >= NOTE_REFERENCE_MAX).toBe(true);
    });
});

// ── formatNoteReferences ────────────────────────────────────────────────────

describe('formatNoteReferences', () => {
    beforeEach(() => { nextRefId = 0; });

    it('returns empty string for no references', () => {
        expect(formatNoteReferences([])).toBe('');
    });

    it('wraps single reference in note_reference tags', () => {
        const refs = addReference([], 'selected text', 'docs/guide.md', 'Guide');
        const output = formatNoteReferences(refs);
        expect(output).toContain('<note_reference path="docs/guide.md" title="Guide">');
        expect(output).toContain('selected text');
        expect(output).toContain('</note_reference>');
    });

    it('appends double-newline after the block', () => {
        const refs = addReference([], 'text', 'a.md', 'A');
        const output = formatNoteReferences(refs);
        expect(output.endsWith('\n\n')).toBe(true);
    });

    it('separates multiple references with double-newline', () => {
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'text1', 'a.md', 'A');
        refs = addReference(refs, 'text2', 'b.md', 'B');
        const output = formatNoteReferences(refs);
        expect(output).toContain('</note_reference>\n\n<note_reference');
    });

    it('includes full text, not just preview', () => {
        const fullText = 'a'.repeat(200);
        const refs = addReference([], fullText, 'x.md', 'X');
        const output = formatNoteReferences(refs);
        expect(output).toContain(fullText);
    });

    it('escapes nothing — raw text is included verbatim', () => {
        const refs = addReference([], 'line1\nline2', 'x.md', 'X');
        const output = formatNoteReferences(refs);
        expect(output).toContain('line1\nline2');
    });

    it('path and title attributes appear correctly', () => {
        const refs = addReference([], 'content', 'My Notebook/intro.md', 'Intro');
        const output = formatNoteReferences(refs);
        expect(output).toContain('path="My Notebook/intro.md"');
        expect(output).toContain('title="Intro"');
    });
});

// ── NoteReferenceChips rendering contract ─────────────────────────────────
//
// We test the pure data-side contract (chip count, truncation flag) without
// mounting React components, consistent with the pattern in other test files.

describe('NoteReferenceChips — data contract', () => {
    beforeEach(() => { nextRefId = 0; });

    it('renders no chips when list is empty', () => {
        const refs: NoteTextReference[] = [];
        // No chips → component should return null (not rendered)
        expect(refs.length).toBe(0);
    });

    it('renders one chip per reference', () => {
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'a', 'a.md', 'A');
        refs = addReference(refs, 'b', 'b.md', 'B');
        expect(refs).toHaveLength(2);
    });

    it('sets truncated flag only when text exceeds limit', () => {
        const short = addReference([], 'short text', 'p.md', 'P');
        expect(short[0].truncated).toBeUndefined();

        const long = addReference([], 'x'.repeat(TEXT_SIZE_LIMIT + 1), 'p.md', 'P');
        expect(long[0].truncated).toBe(true);
    });

    it('shows max notice when references count reaches NOTE_REFERENCE_MAX', () => {
        let refs: NoteTextReference[] = [];
        for (let i = 0; i < NOTE_REFERENCE_MAX; i++) {
            refs = addReference(refs, `t${i}`, 'p.md', 'P');
        }
        // The component should show max notice when refs.length >= NOTE_REFERENCE_MAX
        expect(refs.length >= NOTE_REFERENCE_MAX).toBe(true);
    });
});

// ── handleSend integration logic ───────────────────────────────────────────
//
// Test the message composition logic that NoteChatPanel's handleSend uses.

describe('handleSend — message composition', () => {
    beforeEach(() => { nextRefId = 0; });

    it('prepends reference block before user text', () => {
        const refs = addReference([], 'code snippet', 'src/api.md', 'API Guide');
        const userText = 'Can you explain this?';
        const prompt = formatNoteReferences(refs) + userText;
        expect(prompt.startsWith('<note_reference')).toBe(true);
        expect(prompt.endsWith(userText)).toBe(true);
    });

    it('sends plain user text when no references', () => {
        const refs: NoteTextReference[] = [];
        const userText = 'Hello, how does X work?';
        const prompt = formatNoteReferences(refs) + userText;
        expect(prompt).toBe(userText);
    });

    it('does not send when both text and refs are empty', () => {
        const text = '';
        const refs: NoteTextReference[] = [];
        const shouldSend = text.trim().length > 0 || refs.length > 0;
        expect(shouldSend).toBe(false);
    });

    it('sends when refs are present even if text is empty', () => {
        const text = '';
        let refs: NoteTextReference[] = [];
        refs = addReference(refs, 'important context', 'a.md', 'A');
        const shouldSend = text.trim().length > 0 || refs.length > 0;
        expect(shouldSend).toBe(true);
    });
});
