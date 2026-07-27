import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    encodeQaPayload,
    decodeQaPayload,
    encodeQaTurns,
    decodeQaTurns,
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
 * AC-03 — footnote-form markdown persistence for Quick Ask side-notes, now
 * carrying the full multi-turn thread as a `{"turns":[…]}` payload. Covers the
 * persistence triple (marked tokenizer + turndown rule + payload codec), a
 * byte-stable md → HTML → md round-trip, and legacy single-`{q,a}` decode.
 */
describe('sidenoteFootnote', () => {
    // ── payload codec ────────────────────────────────────────────────────

    describe('encode/decode payload', () => {
        it('encodes a single default-ask turn (answer only) as a turns array', () => {
            expect(encodeQaPayload({ turns: [{ answer: 'Hi there' }] })).toBe(
                '{"turns":[{"a":"Hi there"}]}',
            );
        });

        it('encodes a question + answer turn with a fixed key order (q then a)', () => {
            expect(encodeQaPayload({ turns: [{ question: 'why?', answer: 'because' }] })).toBe(
                '{"turns":[{"q":"why?","a":"because"}]}',
            );
        });

        it('omits an empty per-turn question', () => {
            expect(encodeQaPayload({ turns: [{ question: '', answer: 'x' }] })).toBe(
                '{"turns":[{"a":"x"}]}',
            );
        });

        it('encodes a multi-turn thread in order', () => {
            const def: QaFootnoteDef = {
                turns: [
                    { answer: 'first answer' },
                    { question: 'give an example', answer: 'second answer' },
                ],
            };
            expect(encodeQaPayload(def)).toBe(
                '{"turns":[{"a":"first answer"},{"q":"give an example","a":"second answer"}]}',
            );
            expect(decodeQaPayload(encodeQaPayload(def))).toEqual(def);
        });

        it('round-trips the optional selection anchor after the turns', () => {
            const def: QaFootnoteDef = {
                turns: [{ question: 'why?', answer: 'because' }],
                selectedText: 'the phrase',
                contextBefore: 'before ',
                contextAfter: ' after',
            };
            expect(encodeQaPayload(def)).toBe(
                '{"turns":[{"q":"why?","a":"because"}],"s":"the phrase","p":"before ","x":" after"}',
            );
            expect(decodeQaPayload(encodeQaPayload(def))).toEqual(def);
        });

        it('ignores incomplete anchor fields without losing the turns', () => {
            expect(decodeQaPayload('{"turns":[{"a":"answer"}],"s":"phrase","p":"before"}')).toEqual({
                turns: [{ answer: 'answer', question: undefined }],
            });
        });

        it('keeps a multi-line answer on a single line', () => {
            const encoded = encodeQaPayload({ turns: [{ answer: 'line1\nline2' }] });
            expect(encoded).toBe('{"turns":[{"a":"line1\\nline2"}]}');
            expect(encoded).not.toContain('\n');
        });

        it('decodes our turns JSON shape', () => {
            expect(decodeQaPayload('{"turns":[{"a":"Hi"}]}')).toEqual({
                turns: [{ answer: 'Hi', question: undefined }],
            });
            expect(decodeQaPayload('{"turns":[{"q":"why?","a":"because"}]}')).toEqual({
                turns: [{ answer: 'because', question: 'why?' }],
            });
        });

        it('decodes a legacy single {q,a} payload as a one-turn thread (no migration)', () => {
            expect(decodeQaPayload('{"a":"Hi"}')).toEqual({
                turns: [{ answer: 'Hi', question: undefined }],
            });
            expect(decodeQaPayload('{"q":"why?","a":"because"}')).toEqual({
                turns: [{ answer: 'because', question: 'why?' }],
            });
        });

        it('decodes a legacy {q,a} payload with an anchor into a one-turn thread', () => {
            expect(
                decodeQaPayload('{"q":"why?","a":"because","s":"the phrase","p":"before ","x":" after"}'),
            ).toEqual({
                turns: [{ answer: 'because', question: 'why?' }],
                selectedText: 'the phrase',
                contextBefore: 'before ',
                contextAfter: ' after',
            });
        });

        it('returns null for non-payload / malformed text (AC-05 tolerance)', () => {
            expect(decodeQaPayload('just some prose')).toBeNull();
            expect(decodeQaPayload('{"x":1}')).toBeNull();
            expect(decodeQaPayload('{"turns":[]}')).toBeNull();
            expect(decodeQaPayload('{"turns":"nope"}')).toBeNull();
            expect(decodeQaPayload('')).toBeNull();
            expect(decodeQaPayload('   ')).toBeNull();
        });

        it('round-trips arbitrary threads through encode → decode', () => {
            const cases: QaFootnoteDef[] = [
                { turns: [{ answer: 'plain' }] },
                { turns: [{ question: 'Q?', answer: 'A "quoted" & <angled>' }] },
                { turns: [{ answer: 'multi\nline\ntext' }] },
                { turns: [{ answer: 'one' }, { question: 'two?', answer: 'two' }, { answer: 'three' }] },
            ];
            for (const c of cases) {
                expect(decodeQaPayload(encodeQaPayload(c))).toEqual(c);
            }
        });
    });

    // ── turns-attribute codec (data-qa-turns) ────────────────────────────

    describe('encode/decode turns attribute', () => {
        it('encodes the bare turns array with fixed per-turn key order', () => {
            expect(encodeQaTurns([{ answer: 'a1' }, { question: 'q2', answer: 'a2' }])).toBe(
                '[{"a":"a1"},{"q":"q2","a":"a2"}]',
            );
        });

        it('round-trips turns through encode → decode', () => {
            const turns = [{ answer: 'a1' }, { question: 'q2', answer: 'a2' }];
            expect(decodeQaTurns(encodeQaTurns(turns))).toEqual([
                { answer: 'a1', question: undefined },
                { question: 'q2', answer: 'a2' },
            ]);
        });

        it('returns null for empty / malformed turns attributes', () => {
            expect(decodeQaTurns('')).toBeNull();
            expect(decodeQaTurns('[]')).toBeNull();
            expect(decodeQaTurns('not json')).toBeNull();
            expect(decodeQaTurns('{"a":"x"}')).toBeNull();
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
                'Hello [^qa-abc] world.\n\n[^qa-abc]: {"turns":[{"a":"The answer"}]}\n';
            const { body, defs } = extractQaFootnoteDefs(md);
            expect(body).toBe('Hello [^qa-abc] world.');
            expect(defs.get('abc')).toEqual({ turns: [{ answer: 'The answer', question: undefined }] });
        });

        it('collects multiple definitions incl. a multi-turn thread', () => {
            const md =
                'A [^qa-one] and B [^qa-two].\n\n' +
                '[^qa-one]: {"turns":[{"a":"1"}]}\n' +
                '[^qa-two]: {"turns":[{"q":"q2","a":"2"},{"a":"2b"}]}\n';
            const { defs } = extractQaFootnoteDefs(md);
            expect(defs.get('one')).toEqual({ turns: [{ answer: '1', question: undefined }] });
            expect(defs.get('two')).toEqual({
                turns: [{ answer: '2', question: 'q2' }, { answer: '2b', question: undefined }],
            });
        });

        it('collects a legacy single {q,a} definition as a one-turn thread', () => {
            const md = 'Legacy [^qa-old].\n\n[^qa-old]: {"q":"q","a":"a"}\n';
            const { defs } = extractQaFootnoteDefs(md);
            expect(defs.get('old')).toEqual({ turns: [{ answer: 'a', question: 'q' }] });
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
        it('folds the thread into a bare marker span', () => {
            const html = '<p>Hi <span class="qa-sidenote-ref" data-qa-id="abc">✨</span></p>';
            const defs = new Map<string, QaFootnoteDef>([
                ['abc', { turns: [{ answer: 'The answer', question: 'why?' }] }],
            ]);
            const out = injectQaAnswers(html, defs);
            expect(out).toContain('data-qa-id="abc"');
            expect(out).toContain('data-qa-question="why?"');
            expect(out).toContain('data-qa-answer="The answer"');
            expect(out).toContain('data-qa-turns="[{&quot;q&quot;:&quot;why?&quot;,&quot;a&quot;:&quot;The answer&quot;}]"');
        });

        it('mirrors only turn 0 into the answer/question attrs of a multi-turn thread', () => {
            const html = '<span class="qa-sidenote-ref" data-qa-id="m">✨</span>';
            const defs = new Map<string, QaFootnoteDef>([
                ['m', { turns: [{ answer: 'first' }, { question: 'more?', answer: 'second' }] }],
            ]);
            const out = injectQaAnswers(html, defs);
            expect(out).toContain('data-qa-answer="first"');
            expect(out).not.toContain('data-qa-question');
            expect(out).toContain('data-qa-turns="[{&quot;a&quot;:&quot;first&quot;},{&quot;q&quot;:&quot;more?&quot;,&quot;a&quot;:&quot;second&quot;}]"');
        });

        it('folds persisted anchor fields into marker attributes', () => {
            const html = '<span class="qa-sidenote-ref" data-qa-id="abc">✨</span>';
            const defs = new Map<string, QaFootnoteDef>([['abc', {
                turns: [{ answer: 'The answer' }],
                selectedText: 'the phrase',
                contextBefore: 'before ',
                contextAfter: ' after',
            }]]);
            const out = injectQaAnswers(html, defs);
            expect(out).toContain('data-qa-selected-text="the phrase"');
            expect(out).toContain('data-qa-context-before="before "');
            expect(out).toContain('data-qa-context-after=" after"');
        });

        it('leaves an anchorless marker bare (no matching definition)', () => {
            const html = '<span class="qa-sidenote-ref" data-qa-id="ghost"></span>';
            const out = injectQaAnswers(html, new Map());
            expect(out).toBe(html);
        });

        it('html-escapes special characters in the answer', () => {
            const html = '<span class="qa-sidenote-ref" data-qa-id="x">✨</span>';
            const defs = new Map<string, QaFootnoteDef>([['x', { turns: [{ answer: 'a "b" & <c>' }] }]]);
            const out = injectQaAnswers(html, defs);
            expect(out).toContain('data-qa-answer="a &quot;b&quot; &amp; &lt;c&gt;"');
        });
    });

    // ── definition block re-composition ──────────────────────────────────

    describe('appendQaFootnoteDefs', () => {
        it('appends a definition derived from the turn-0 mirror attrs (fresh marker)', () => {
            const md = 'Hi [^qa-abc]\n';
            const html = '<p>Hi <span class="qa-sidenote-ref" data-qa-id="abc" data-qa-answer="The answer"></span></p>';
            expect(appendQaFootnoteDefs(md, html)).toBe(
                'Hi [^qa-abc]\n\n[^qa-abc]: {"turns":[{"a":"The answer"}]}\n',
            );
        });

        it('appends the full thread from data-qa-turns', () => {
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="m" data-qa-answer="first" ' +
                'data-qa-turns="[{&quot;a&quot;:&quot;first&quot;},{&quot;q&quot;:&quot;more?&quot;,&quot;a&quot;:&quot;second&quot;}]"></span>';
            expect(appendQaFootnoteDefs('body [^qa-m]\n', html)).toBe(
                'body [^qa-m]\n\n[^qa-m]: {"turns":[{"a":"first"},{"q":"more?","a":"second"}]}\n',
            );
        });

        it('appends optional anchor data alongside the thread', () => {
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="abc" data-qa-answer="A" ' +
                'data-qa-selected-text="phrase" data-qa-context-before="before " ' +
                'data-qa-context-after=" after">✨</span>';
            expect(appendQaFootnoteDefs('phrase [^qa-abc]\n', html)).toBe(
                'phrase [^qa-abc]\n\n' +
                '[^qa-abc]: {"turns":[{"a":"A"}],"s":"phrase","p":"before ","x":" after"}\n',
            );
        });

        it('preserves marker order and de-duplicates by id', () => {
            const md = 'text\n';
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="one" data-qa-answer="1"></span>' +
                '<span class="qa-sidenote-ref" data-qa-id="two" data-qa-answer="2"></span>' +
                '<span class="qa-sidenote-ref" data-qa-id="one" data-qa-answer="1"></span>';
            const out = appendQaFootnoteDefs(md, html);
            expect(out).toBe('text\n\n[^qa-one]: {"turns":[{"a":"1"}]}\n[^qa-two]: {"turns":[{"a":"2"}]}\n');
        });

        it('is a no-op when the html carries no markers', () => {
            expect(appendQaFootnoteDefs('plain\n', '<p>plain</p>')).toBe('plain\n');
        });

        it('decodes html-escaped answers back into the payload', () => {
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="x" data-qa-answer="a &quot;b&quot; &amp; &lt;c&gt;"></span>';
            const out = appendQaFootnoteDefs('t\n', html);
            expect(out).toBe('t\n\n[^qa-x]: {"turns":[{"a":"a \\"b\\" & <c>"}]}\n');
        });

        it('skips an answerless marker instead of resurrecting an empty definition (AC-05)', () => {
            const empty = '<span class="qa-sidenote-ref" data-qa-id="gone" data-qa-answer=""></span>';
            expect(appendQaFootnoteDefs('body [^qa-gone]\n', empty)).toBe('body [^qa-gone]\n');
            const absent = '<span class="qa-sidenote-ref" data-qa-id="gone"></span>';
            expect(appendQaFootnoteDefs('body [^qa-gone]\n', absent)).toBe('body [^qa-gone]\n');
        });

        it('still emits definitions for answered markers alongside answerless ones (AC-05)', () => {
            const html =
                '<span class="qa-sidenote-ref" data-qa-id="live" data-qa-answer="real"></span>' +
                '<span class="qa-sidenote-ref" data-qa-id="dead" data-qa-answer=""></span>';
            expect(appendQaFootnoteDefs('t\n', html)).toBe('t\n\n[^qa-live]: {"turns":[{"a":"real"}]}\n');
        });
    });

    // ── marked tokenizer (via markdownToHtml) ────────────────────────────

    describe('markdownToHtml (marked tokenizer)', () => {
        it('renders a reference marker with its folded-in thread', () => {
            const html = markdownToHtml('Hello [^qa-abc] world.\n\n[^qa-abc]: {"turns":[{"a":"The answer"}]}\n');
            expect(html).toContain('class="qa-sidenote-ref"');
            expect(html).toContain('data-qa-id="abc"');
            expect(html).toContain('data-qa-answer="The answer"');
            // The bottom definition line must not survive into the HTML body.
            expect(html).not.toContain('{"turns":[{"a":"The answer"}]}');
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
            expect(htmlToMarkdown(html)).toBe('Hi [^qa-abc]\n\n[^qa-abc]: {"turns":[{"a":"The answer"}]}\n');
        });

        it('carries the question through into the definition payload', () => {
            const html =
                '<p><span class="qa-sidenote-ref" data-qa-id="q1" data-qa-question="why?" data-qa-answer="because">✨</span></p>';
            expect(htmlToMarkdown(html)).toBe('[^qa-q1]\n\n[^qa-q1]: {"turns":[{"q":"why?","a":"because"}]}\n');
        });
    });

    // ── byte-stable round-trip ───────────────────────────────────────────

    describe('round-trip (markdown → html → markdown) is byte-stable', () => {
        const roundTrip = (md: string): string => htmlToMarkdown(markdownToHtml(md));

        it('answer only', () => {
            const md = 'Hello [^qa-abc123] world.\n\n[^qa-abc123]: {"turns":[{"a":"The answer"}]}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('question + answer', () => {
            const md =
                'The fox [^qa-fox].\n\n[^qa-fox]: {"turns":[{"q":"explain this","a":"A quick brown fox."}]}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('a multi-turn thread', () => {
            const md =
                'The fox [^qa-fox].\n\n' +
                '[^qa-fox]: {"turns":[{"a":"A quick brown fox."},{"q":"an example?","a":"Like this one."}]}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('question, answer, and selection anchor', () => {
            const md =
                'The fox[^qa-fox] jumps.\n\n' +
                '[^qa-fox]: {"turns":[{"q":"explain","a":"A fox."}],"s":"fox","p":"The ","x":" jumps."}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('answer with quotes, ampersands and angle brackets', () => {
            const md =
                'Edge [^qa-e].\n\n[^qa-e]: {"turns":[{"a":"a \\"b\\" & <c> > d"}]}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('multiple side-notes in marker order', () => {
            const md =
                'First [^qa-a1] then second [^qa-b2].\n\n' +
                '[^qa-a1]: {"turns":[{"a":"one"}]}\n[^qa-b2]: {"turns":[{"a":"two"}]}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('a note interleaved with ordinary markdown', () => {
            const md =
                '# Heading\n\nSome **bold** text [^qa-x] and more.\n\n[^qa-x]: {"turns":[{"a":"the answer"}]}\n';
            expect(roundTrip(md)).toBe(md);
        });

        it('upgrades a legacy single {q,a} note to the turns form on save', () => {
            // Legacy notes are decoded (not migrated) and re-serialized as a
            // one-turn thread on the next save — no answer is lost.
            const legacy = 'The fox [^qa-fox].\n\n[^qa-fox]: {"q":"explain this","a":"A quick brown fox."}\n';
            const upgraded = 'The fox [^qa-fox].\n\n[^qa-fox]: {"turns":[{"q":"explain this","a":"A quick brown fox."}]}\n';
            expect(roundTrip(legacy)).toBe(upgraded);
            // ...and thereafter it is byte-stable.
            expect(roundTrip(upgraded)).toBe(upgraded);
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
            const md = 'The fox [^qa-fox] jumps.\n\n[^qa-fox]: {"turns":[{"q":"explain this","a":"A quick brown fox."}]}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });

        it('preserves a multi-turn thread through the editor', () => {
            const md =
                'The fox [^qa-fox] jumps.\n\n' +
                '[^qa-fox]: {"turns":[{"a":"A quick brown fox."},{"q":"an example?","a":"Like this one."}]}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });

        it('preserves special characters in the answer through the editor', () => {
            const md = 'Edge [^qa-e].\n\n[^qa-e]: {"turns":[{"a":"a \\"b\\" & <c> > d"}]}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });

        it('preserves multiple side-notes through the editor', () => {
            const md =
                'First [^qa-a1] then second [^qa-b2].\n\n' +
                '[^qa-a1]: {"turns":[{"a":"one"}]}\n[^qa-b2]: {"turns":[{"a":"two"}]}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });

        it('preserves optional anchor fields through the editor', () => {
            const md =
                'The fox[^qa-fox] jumps.\n\n' +
                '[^qa-fox]: {"turns":[{"a":"A fox."}],"s":"fox","p":"The ","x":" jumps."}\n';
            expect(editorRoundTrip(md)).toBe(md);
        });
    });

    // ── orphaned construct tolerance (AC-05) ─────────────────────────────

    describe('orphaned constructs do not corrupt rendering (AC-05 manual-md tolerance)', () => {
        it('a definition with no marker is dropped, not crashed', () => {
            const md = 'Plain text with no marker.\n\n[^qa-orphan]: {"turns":[{"a":"stranded"}]}\n';
            const html = markdownToHtml(md);
            expect(html).toContain('Plain text with no marker.');
            expect(html).not.toContain('qa-sidenote-ref');
            expect(htmlToMarkdown(html)).toBe('Plain text with no marker.\n');
        });

        it('a marker whose definition was hand-deleted renders as a bare chip', () => {
            const html = markdownToHtml('Look [^qa-ghost] here.\n');
            expect(html).toContain('data-qa-id="ghost"');
            expect(html).not.toContain('data-qa-answer');
        });

        it('does not resurrect a definition for a marker whose def was hand-deleted (byte-stable)', () => {
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
