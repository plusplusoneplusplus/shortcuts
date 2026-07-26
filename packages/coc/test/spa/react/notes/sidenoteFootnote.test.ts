import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    encodeQaPayload,
    decodeQaPayload,
    extractQaFootnoteDefs,
    injectQaAnswers,
    appendQaFootnoteDefs,
    type QaFootnoteDef,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/sidenoteFootnote';
import { SidenoteRefExtension } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/sidenoteRefExtension';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

/**
 * AC-03 — footnote-form markdown persistence for Quick Ask side-notes.
 * Covers the persistence triple (marked tokenizer + turndown rule + payload
 * codec) and a byte-stable md → HTML → md round-trip.
 */
describe('sidenoteFootnote', () => {
    // ── payload codec ────────────────────────────────────────────────────

    describe('encode/decode payload', () => {
        it('encodes answer only with a fixed shape', () => {
            expect(encodeQaPayload({ answer: 'Hi there' })).toBe('{"a":"Hi there"}');
        });

        it('encodes question + answer with a fixed key order (q then a)', () => {
            expect(encodeQaPayload({ question: 'why?', answer: 'because' })).toBe(
                '{"q":"why?","a":"because"}',
            );
        });

        it('omits an empty question', () => {
            expect(encodeQaPayload({ question: '', answer: 'x' })).toBe('{"a":"x"}');
        });

        it('keeps a multi-line answer on a single line', () => {
            const encoded = encodeQaPayload({ answer: 'line1\nline2' });
            expect(encoded).toBe('{"a":"line1\\nline2"}');
            expect(encoded).not.toContain('\n');
        });

        it('decodes our JSON shape', () => {
            expect(decodeQaPayload('{"a":"Hi"}')).toEqual({ answer: 'Hi', question: undefined });
            expect(decodeQaPayload('{"q":"why?","a":"because"}')).toEqual({
                answer: 'because',
                question: 'why?',
            });
        });

        it('returns null for non-payload / malformed text (AC-05 tolerance)', () => {
            expect(decodeQaPayload('just some prose')).toBeNull();
            expect(decodeQaPayload('{"x":1}')).toBeNull();
            expect(decodeQaPayload('')).toBeNull();
            expect(decodeQaPayload('   ')).toBeNull();
        });

        it('round-trips arbitrary answers through encode → decode', () => {
            const cases: QaFootnoteDef[] = [
                { answer: 'plain' },
                { question: 'Q?', answer: 'A "quoted" & <angled>' },
                { answer: 'multi\nline\ntext' },
            ];
            for (const c of cases) {
                const decoded = decodeQaPayload(encodeQaPayload(c));
                expect(decoded).toEqual({ answer: c.answer, question: c.question || undefined });
            }
        });
    });

    // ── definition block extraction ──────────────────────────────────────

    describe('extractQaFootnoteDefs', () => {
        it('leaves an ordinary note untouched (no qa footnotes)', () => {
            const md = '# Title\n\nSome text with [a link](http://x).\n';
            const { body, defs } = extractQaFootnoteDefs(md);
            expect(body).toBe(md);
            expect(defs.size).toBe(0);
        });

        it('strips the definition block and collects the payloads', () => {
            const md =
                'Hello [^qa-abc] world.\n\n[^qa-abc]: {"a":"The answer"}\n';
            const { body, defs } = extractQaFootnoteDefs(md);
            expect(body).toBe('Hello [^qa-abc] world.');
            expect(defs.get('abc')).toEqual({ answer: 'The answer', question: undefined });
        });

        it('collects multiple definitions', () => {
            const md =
                'A [^qa-one] and B [^qa-two].\n\n[^qa-one]: {"a":"1"}\n[^qa-two]: {"q":"q2","a":"2"}\n';
            const { defs } = extractQaFootnoteDefs(md);
            expect(defs.get('one')).toEqual({ answer: '1', question: undefined });
            expect(defs.get('two')).toEqual({ answer: '2', question: 'q2' });
        });

        it('strips a malformed definition line but does not register it', () => {
            const md = 'X [^qa-bad].\n\n[^qa-bad]: not our json\n';
            const { body, defs } = extractQaFootnoteDefs(md);
            expect(body).toBe('X [^qa-bad].');
            expect(defs.has('bad')).toBe(false);
        });
    });

    // ── answer injection ─────────────────────────────────────────────────

    describe('injectQaAnswers', () => {
        it('folds answer + question into a bare marker span', () => {
            const html = '<p>Hi <span class="qa-sidenote-ref" data-qa-id="abc">✨</span></p>';
            const defs = new Map([['abc', { answer: 'The answer', question: 'why?' }]]);
            const out = injectQaAnswers(html, defs);
            expect(out).toContain('data-qa-id="abc"');
            expect(out).toContain('data-qa-question="why?"');
            expect(out).toContain('data-qa-answer="The answer"');
        });

        it('leaves an anchorless marker bare (no matching definition)', () => {
            const html = '<span class="qa-sidenote-ref" data-qa-id="ghost"></span>';
            const out = injectQaAnswers(html, new Map());
            expect(out).toBe(html);
        });

        it('html-escapes special characters in the answer', () => {
            const html = '<span class="qa-sidenote-ref" data-qa-id="x">✨</span>';
            const defs = new Map([['x', { answer: 'a "b" & <c>' }]]);
            const out = injectQaAnswers(html, defs);
            expect(out).toContain('data-qa-answer="a &quot;b&quot; &amp; &lt;c&gt;"');
        });
    });

    // ── definition block re-composition ──────────────────────────────────

    describe('appendQaFootnoteDefs', () => {
        it('appends a definition derived from the marker span', () => {
            const md = 'Hi [^qa-abc]\n';
            const html = '<p>Hi <span class="qa-sidenote-ref" data-qa-id="abc" data-qa-answer="The answer"></span></p>';
            expect(appendQaFootnoteDefs(md, html)).toBe(
                'Hi [^qa-abc]\n\n[^qa-abc]: {"a":"The answer"}\n',
            );
        });

        it('preserves marker order and de-duplicates by id', () => {
            const md = 'text\n';
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="one" data-qa-answer="1"></span>' +
                '<span class="qa-sidenote-ref" data-qa-id="two" data-qa-answer="2"></span>' +
                '<span class="qa-sidenote-ref" data-qa-id="one" data-qa-answer="1"></span>';
            const out = appendQaFootnoteDefs(md, html);
            expect(out).toBe('text\n\n[^qa-one]: {"a":"1"}\n[^qa-two]: {"a":"2"}\n');
        });

        it('is a no-op when the html carries no markers', () => {
            expect(appendQaFootnoteDefs('plain\n', '<p>plain</p>')).toBe('plain\n');
        });

        it('decodes html-escaped answers back into the payload', () => {
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="x" data-qa-answer="a &quot;b&quot; &amp; &lt;c&gt;"></span>';
            const out = appendQaFootnoteDefs('t\n', html);
            expect(out).toBe('t\n\n[^qa-x]: {"a":"a \\"b\\" & <c>"}\n');
        });

        it('skips an answerless marker instead of resurrecting an empty definition (AC-05)', () => {
            // A marker span whose data-qa-answer was hand-deleted (empty) or is
            // absent must NOT re-emit a `{"a":""}` definition on save.
            const empty = '<span class="qa-sidenote-ref" data-qa-id="gone" data-qa-answer=""></span>';
            expect(appendQaFootnoteDefs('body [^qa-gone]\n', empty)).toBe('body [^qa-gone]\n');
            const absent = '<span class="qa-sidenote-ref" data-qa-id="gone"></span>';
            expect(appendQaFootnoteDefs('body [^qa-gone]\n', absent)).toBe('body [^qa-gone]\n');
        });

        it('still emits definitions for answered markers alongside answerless ones (AC-05)', () => {
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="live" data-qa-answer="real"></span>' +
                '<span class="qa-sidenote-ref" data-qa-id="dead" data-qa-answer=""></span>';
            expect(appendQaFootnoteDefs('t\n', html)).toBe('t\n\n[^qa-live]: {"a":"real"}\n');
        });
    });

    // ── marked tokenizer (via markdownToHtml) ────────────────────────────

    describe('markdownToHtml (marked tokenizer)', () => {
        it('renders a reference marker with its folded-in answer', () => {
            const html = markdownToHtml('Hello [^qa-abc] world.\n\n[^qa-abc]: {"a":"The answer"}\n');
            expect(html).toContain('class="qa-sidenote-ref"');
            expect(html).toContain('data-qa-id="abc"');
            expect(html).toContain('data-qa-answer="The answer"');
            // The bottom definition line must not survive into the HTML body.
            expect(html).not.toContain('{"a":"The answer"}');
        });

        it('leaves an ordinary [^1] footnote as literal text (no collision)', () => {
            const html = markdownToHtml('A sentence.[^1]\n\n[^1]: a normal footnote\n');
            expect(html).not.toContain('qa-sidenote-ref');
            expect(html).toContain('[^1]');
        });

        it('renders an anchorless marker without crashing (missing definition)', () => {
            const html = markdownToHtml('Look [^qa-ghost] here.\n');
            expect(html).toContain('data-qa-id="ghost"');
            expect(html).not.toContain('data-qa-answer');
        });
    });

    // ── turndown rule (via htmlToMarkdown) ───────────────────────────────

    describe('htmlToMarkdown (turndown rule)', () => {
        it('serializes a marker span back to the inline marker + definition block', () => {
            const html =
                '<p>Hi <span class="qa-sidenote-ref" data-qa-id="abc" data-qa-answer="The answer">✨</span></p>';
            expect(htmlToMarkdown(html)).toBe('Hi [^qa-abc]\n\n[^qa-abc]: {"a":"The answer"}\n');
        });

        it('carries the question through into the definition payload', () => {
            const html =
                '<p><span class="qa-sidenote-ref" data-qa-id="q1" data-qa-question="why?" data-qa-answer="because">✨</span></p>';
            expect(htmlToMarkdown(html)).toBe('[^qa-q1]\n\n[^qa-q1]: {"q":"why?","a":"because"}\n');
        });
    });

    // ── byte-stable round-trip ───────────────────────────────────────────

    describe('round-trip (markdown → html → markdown) is byte-stable', () => {
        const roundTrip = (md: string): string => htmlToMarkdown(markdownToHtml(md));

        it('answer only', () => {
            const md = 'Hello [^qa-abc123] world.\n\n[^qa-abc123]: {"a":"The answer"}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('question + answer', () => {
            const md =
                'The fox [^qa-fox].\n\n[^qa-fox]: {"q":"explain this","a":"A quick brown fox."}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('answer with quotes, ampersands and angle brackets', () => {
            const md =
                'Edge [^qa-e].\n\n[^qa-e]: {"a":"a \\"b\\" & <c> > d"}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('multiple side-notes in marker order', () => {
            const md =
                'First [^qa-a1] then second [^qa-b2].\n\n[^qa-a1]: {"a":"one"}\n[^qa-b2]: {"a":"two"}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('a note interleaved with ordinary markdown', () => {
            const md =
                '# Heading\n\nSome **bold** text [^qa-x] and more.\n\n[^qa-x]: {"a":"the answer"}\n';
            expect(roundTrip(md)).toBe(md);
        });
    });

    // ── full md → Tiptap → md round-trip through a real editor ───────────

    describe('round-trip through a real Tiptap editor is byte-stable', () => {
        function editorRoundTrip(md: string): string {
            const editor = new Editor({
                extensions: [
                    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
                    SidenoteRefExtension,
                ],
                content: markdownToHtml(md),
            });
            try {
                return htmlToMarkdown(editor.getHTML());
            } finally {
                editor.destroy();
            }
        }

        it('preserves the marker and answer through parseHTML/renderHTML', () => {
            const md = 'The fox [^qa-fox] jumps.\n\n[^qa-fox]: {"q":"explain this","a":"A quick brown fox."}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });

        it('preserves special characters in the answer through the editor', () => {
            const md = 'Edge [^qa-e].\n\n[^qa-e]: {"a":"a \\"b\\" & <c> > d"}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });

        it('preserves multiple side-notes through the editor', () => {
            const md =
                'First [^qa-a1] then second [^qa-b2].\n\n[^qa-a1]: {"a":"one"}\n[^qa-b2]: {"a":"two"}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });
    });

    // ── orphaned construct tolerance (AC-05) ─────────────────────────────

    describe('orphaned constructs do not corrupt rendering (AC-05 manual-md tolerance)', () => {
        it('a definition with no marker is dropped, not crashed', () => {
            const md = 'Plain text with no marker.\n\n[^qa-orphan]: {"a":"stranded"}\n';
            // Renders fine (definition simply stripped).
            const html = markdownToHtml(md);
            expect(html).toContain('Plain text with no marker.');
            expect(html).not.toContain('qa-sidenote-ref');
            // On save the orphaned definition is gone (no marker to re-derive it).
            expect(htmlToMarkdown(html)).toBe('Plain text with no marker.\n');
        });

        it('a marker whose definition was hand-deleted renders as a bare chip', () => {
            // Source-view edit: the user removed the `[^qa-ghost]: …` line but left
            // the inline `[^qa-ghost]` marker. It must still render (no crash) and
            // carry no answer.
            const html = markdownToHtml('Look [^qa-ghost] here.\n');
            expect(html).toContain('data-qa-id="ghost"');
            expect(html).not.toContain('data-qa-answer');
        });

        it('does not resurrect a definition for a marker whose def was hand-deleted (byte-stable)', () => {
            // The now-anchorless marker must survive a save/reload without the
            // editor inventing an empty `{"a":""}` definition for it.
            const md = 'Look [^qa-ghost] here.\n';
            expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
        });

        it('does not resurrect a definition through a real Tiptap editor', () => {
            const md = 'Look [^qa-ghost] here.\n';
            const editor = new Editor({
                extensions: [
                    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
                    SidenoteRefExtension,
                ],
                content: markdownToHtml(md),
            });
            try {
                expect(htmlToMarkdown(editor.getHTML())).toBe(md);
            } finally {
                editor.destroy();
            }
        });
    });
});
