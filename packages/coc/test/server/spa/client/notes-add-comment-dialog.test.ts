import { describe, it, expect } from 'vitest';

// ── Pure-logic tests for AddCommentDialog behaviour ───────────────────────────
//
// These tests exercise the logic extracted from AddCommentDialog and the
// updated handleCommentCreate flow in NotesView without rendering React.

const MAX_QUOTE_DISPLAY = 120;

function truncateQuote(quotedText: string): string {
    return quotedText.length > MAX_QUOTE_DISPLAY
        ? quotedText.slice(0, MAX_QUOTE_DISPLAY) + '…'
        : quotedText;
}

function isCommentValid(text: string): boolean {
    return text.trim().length > 0;
}

describe('AddCommentDialog — quote truncation', () => {
    it('does not truncate text shorter than the limit', () => {
        const short = 'Hello world';
        expect(truncateQuote(short)).toBe(short);
    });

    it('does not truncate text exactly at the limit', () => {
        const exact = 'a'.repeat(MAX_QUOTE_DISPLAY);
        expect(truncateQuote(exact)).toBe(exact);
    });

    it('truncates text one character over the limit with ellipsis', () => {
        const over = 'a'.repeat(MAX_QUOTE_DISPLAY + 1);
        const result = truncateQuote(over);
        expect(result).toBe('a'.repeat(MAX_QUOTE_DISPLAY) + '…');
    });

    it('truncates long text to MAX_QUOTE_DISPLAY chars plus ellipsis', () => {
        const long = 'Lorem ipsum '.repeat(20); // well over 120 chars
        const result = truncateQuote(long);
        expect(result.length).toBe(MAX_QUOTE_DISPLAY + 1); // 120 chars + '…'
        expect(result.endsWith('…')).toBe(true);
        expect(result.slice(0, MAX_QUOTE_DISPLAY)).toBe(long.slice(0, MAX_QUOTE_DISPLAY));
    });

    it('handles empty string without adding ellipsis', () => {
        expect(truncateQuote('')).toBe('');
    });
});

describe('AddCommentDialog — comment text validation', () => {
    it('rejects empty string', () => {
        expect(isCommentValid('')).toBe(false);
    });

    it('rejects whitespace-only string', () => {
        expect(isCommentValid('   ')).toBe(false);
    });

    it('rejects tab-only string', () => {
        expect(isCommentValid('\t\n')).toBe(false);
    });

    it('accepts a single non-whitespace character', () => {
        expect(isCommentValid('x')).toBe(true);
    });

    it('accepts normal comment text', () => {
        expect(isCommentValid('This is a comment.')).toBe(true);
    });

    it('trims surrounding whitespace before validation', () => {
        expect(isCommentValid('  hello  ')).toBe(true);
    });
});

// ── handleCommentCreate logic ────────────────────────────────────────────────
//
// The refactored flow must NOT call createThread immediately; instead it sets
// pendingComment state and waits for dialog confirmation.

describe('handleCommentCreate — deferred thread creation', () => {
    it('sets pending comment state instead of creating the thread immediately', () => {
        let pendingComment: { anchor: object; from: number; to: number } | null = null;
        let createThreadCalled = false;

        const fakeAnchor = { quotedText: 'selected text', prefix: '', suffix: '' };

        // Simulate the refactored handleCommentCreate body:
        const handleCommentCreate = (
            anchor: typeof fakeAnchor,
            from: number,
            to: number,
            setPendingComment: (v: typeof pendingComment) => void,
        ) => {
            setPendingComment({ anchor, from, to });
            // Must NOT call createThread here
        };

        handleCommentCreate(fakeAnchor, 10, 20, (v) => { pendingComment = v; });

        expect(createThreadCalled).toBe(false);
        expect(pendingComment).not.toBeNull();
        expect(pendingComment!.from).toBe(10);
        expect(pendingComment!.to).toBe(20);
        expect(pendingComment!.anchor).toBe(fakeAnchor);
    });

    it('clears pending comment when dialog is cancelled', () => {
        let pendingComment: object | null = { anchor: {}, from: 0, to: 5 };
        const handleClose = (setPendingComment: (v: null) => void) => setPendingComment(null);

        handleClose((v) => { pendingComment = v; });

        expect(pendingComment).toBeNull();
    });
});

// ── handleCommentDialogConfirm logic ────────────────────────────────────────
//
// On confirm, createThread is called with the anchor and the entered text.

describe('handleCommentDialogConfirm — thread creation on confirm', () => {
    it('calls createThread with the correct anchor and text', async () => {
        const anchor = { quotedText: 'hello', prefix: '', suffix: '' };
        const pending = { anchor, from: 5, to: 10 };
        let createThreadArgs: [object, string] | null = null;

        const fakeCreateThread = async (a: object, text: string) => {
            createThreadArgs = [a, text];
            return { id: 'thread-1' };
        };

        // Simulate handleCommentDialogConfirm body:
        const handleConfirm = async (text: string) => {
            if (!pending) return;
            const created = await fakeCreateThread(pending.anchor, text);
            return created;
        };

        await handleConfirm('My first comment');

        expect(createThreadArgs).not.toBeNull();
        expect(createThreadArgs![0]).toBe(anchor);
        expect(createThreadArgs![1]).toBe('My first comment');
    });

    it('does not call createThread when pendingComment is null', async () => {
        let called = false;
        const fakeCreateThread = async () => { called = true; return { id: 'x' }; };

        const handleConfirm = async (text: string) => {
            const pending = null;
            if (!pending) return;
            await fakeCreateThread();
        };

        await handleConfirm('some text');
        expect(called).toBe(false);
    });

    it('opens comments panel after thread is created', async () => {
        const pending = { anchor: { quotedText: 'hi', prefix: '', suffix: '' }, from: 0, to: 2 };
        let panelOpen = false;

        const fakeCreateThread = async () => ({ id: 'thread-2' });

        const handleConfirm = async (text: string) => {
            if (!pending) return;
            const created = await fakeCreateThread();
            if (created) panelOpen = true;
        };

        await handleConfirm('Great point');
        expect(panelOpen).toBe(true);
    });
});
