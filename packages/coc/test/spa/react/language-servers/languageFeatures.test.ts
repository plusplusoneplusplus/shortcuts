/**
 * LSP result payloads to Monaco provider results.
 *
 * Every function under test takes an untrusted blob: a language server may
 * omit any optional field, and the specification allows several shapes for the
 * same answer. The cases below are grouped by the mistake they guard against —
 * a wrong completion kind, a dropped edit range, a re-numbered enumeration, or
 * plain text rendered as markup.
 */

import { describe, it, expect } from 'vitest';
import {
    MONACO_COMPLETION_KIND,
    MONACO_COMPLETION_TAG_DEPRECATED,
    MONACO_INSERT_AS_SNIPPET,
    asLspRange,
    escapeMarkdown,
    toCompletionKind,
    toCompletionList,
    toHover,
    toLocationLinks,
    toMarkdownString,
    toSignatureHelp,
    toTextEdits,
} from '../../../../src/server/spa/client/react/features/language-servers/languageFeatures';

const WORD_RANGE = { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 9 };

function lspRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    return {
        start: { line: startLine, character: startCharacter },
        end: { line: endLine, character: endCharacter },
    };
}

describe('markdown content', () => {
    it('fences a marked string that names a language', () => {
        expect(toMarkdownString({ language: 'typescript', value: 'const x: number' })).toEqual({
            value: '```typescript\nconst x: number\n```',
        });
    });

    it('passes markup content through as markdown', () => {
        expect(toMarkdownString({ kind: 'markdown', value: '**bold**' })).toEqual({ value: '**bold**' });
    });

    it('escapes markup content the server declared plain', () => {
        const result = toMarkdownString({ kind: 'plaintext', value: 'a * b _c_' });
        expect(result?.value).toBe('a \\* b \\_c\\_');
    });

    it('joins an array of contents with blank lines', () => {
        const result = toMarkdownString([
            { language: 'typescript', value: 'foo(): void' },
            'Calls foo.',
        ]);
        expect(result?.value).toBe('```typescript\nfoo(): void\n```\n\nCalls foo.');
    });

    it('returns null for nothing to show', () => {
        expect(toMarkdownString(undefined)).toBeNull();
        expect(toMarkdownString('')).toBeNull();
        expect(toMarkdownString([])).toBeNull();
        expect(toMarkdownString({ kind: 'markdown', value: '   ' })).toBeNull();
    });

    it('escapes each markup character exactly once', () => {
        expect(escapeMarkdown('`x`')).toBe('\\`x\\`');
        expect(escapeMarkdown('plain text')).toBe('plain text');
    });
});

describe('hover', () => {
    it('keeps the range so Monaco underlines the right word', () => {
        const hover = toHover({ contents: { kind: 'markdown', value: 'docs' }, range: lspRange(2, 4, 2, 7) });
        expect(hover).toEqual({
            contents: [{ value: 'docs' }],
            range: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 8 },
        });
    });

    it('omits the range when the server sent none', () => {
        expect(toHover({ contents: 'docs' })).toEqual({ contents: [{ value: 'docs' }] });
    });

    it('is null for an empty answer, which is a normal result', () => {
        expect(toHover(null)).toBeNull();
        expect(toHover({ contents: [] })).toBeNull();
        expect(toHover({ contents: { kind: 'markdown', value: '' } })).toBeNull();
    });
});

describe('locations', () => {
    it('accepts a single location', () => {
        expect(toLocationLinks({ uri: 'coc-file://ws/src/a.ts', range: lspRange(0, 0, 0, 4) })).toEqual([
            {
                uri: 'coc-file://ws/src/a.ts',
                range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 },
            },
        ]);
    });

    it('reveals the target range and selects the selection range of a link', () => {
        const links = toLocationLinks([
            {
                targetUri: 'coc-file://ws/src/b.ts',
                targetRange: lspRange(4, 0, 8, 1),
                targetSelectionRange: lspRange(4, 13, 4, 20),
                originSelectionRange: lspRange(1, 2, 1, 9),
            },
        ]);
        expect(links).toEqual([
            {
                uri: 'coc-file://ws/src/b.ts',
                range: { startLineNumber: 5, startColumn: 1, endLineNumber: 9, endColumn: 2 },
                targetSelectionRange: { startLineNumber: 5, startColumn: 14, endLineNumber: 5, endColumn: 21 },
                originSelectionRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 10 },
            },
        ]);
    });

    it('keeps a URI outside the workspace so the caller can refuse it', () => {
        const links = toLocationLinks([{ uri: 'file:///opt/lib/index.d.ts', range: lspRange(0, 0, 0, 1) }]);
        expect(links[0].uri).toBe('file:///opt/lib/index.d.ts');
    });

    it('drops unusable entries instead of failing the whole navigation', () => {
        const links = toLocationLinks([
            { uri: 'coc-file://ws/a.ts' },
            { range: lspRange(0, 0, 0, 1) },
            null,
            { uri: 'coc-file://ws/b.ts', range: lspRange(1, 0, 1, 1) },
        ]);
        expect(links.map((link) => link.uri)).toEqual(['coc-file://ws/b.ts']);
    });

    it('is empty for no result', () => {
        expect(toLocationLinks(null)).toEqual([]);
        expect(toLocationLinks([])).toEqual([]);
    });
});

describe('completion kinds', () => {
    it('renumbers between the two enumerations', () => {
        // The two enumerations share no numbering at all; these are the pairs
        // that would silently show the wrong icon if the table drifted.
        expect(toCompletionKind(1)).toBe(MONACO_COMPLETION_KIND.text);
        expect(toCompletionKind(2)).toBe(MONACO_COMPLETION_KIND.method);
        expect(toCompletionKind(7)).toBe(MONACO_COMPLETION_KIND.class);
        expect(toCompletionKind(15)).toBe(MONACO_COMPLETION_KIND.snippet);
        expect(toCompletionKind(21)).toBe(MONACO_COMPLETION_KIND.constant);
        expect(toCompletionKind(25)).toBe(MONACO_COMPLETION_KIND.typeParameter);
    });

    it('falls back to text for a kind we do not know', () => {
        expect(toCompletionKind(undefined)).toBe(MONACO_COMPLETION_KIND.text);
        expect(toCompletionKind(99)).toBe(MONACO_COMPLETION_KIND.text);
    });
});

describe('completion list', () => {
    it('uses the word range at the cursor when the item carries no edit', () => {
        const list = toCompletionList({ items: [{ label: 'toString', kind: 2 }] }, WORD_RANGE);
        expect(list.incomplete).toBe(false);
        expect(list.suggestions).toEqual([
            {
                label: 'toString',
                kind: MONACO_COMPLETION_KIND.method,
                insertText: 'toString',
                range: WORD_RANGE,
            },
        ]);
    });

    it("prefers the server's text edit over the label and the word range", () => {
        const list = toCompletionList(
            [{ label: 'value', insertText: 'ignored', textEdit: { range: lspRange(3, 2, 3, 6), newText: 'value!' } }],
            WORD_RANGE,
        );
        expect(list.suggestions[0].insertText).toBe('value!');
        expect(list.suggestions[0].range).toEqual({
            startLineNumber: 4,
            startColumn: 3,
            endLineNumber: 4,
            endColumn: 7,
        });
    });

    it('keeps both ranges of an insert/replace edit', () => {
        const list = toCompletionList(
            [{
                label: 'value',
                textEdit: {
                    newText: 'value',
                    insert: lspRange(0, 1, 0, 3),
                    replace: lspRange(0, 1, 0, 8),
                },
            }],
            WORD_RANGE,
        );
        expect(list.suggestions[0].range).toEqual({
            insert: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 4 },
            replace: { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 9 },
        });
    });

    it('marks a snippet so Monaco expands the placeholders', () => {
        const list = toCompletionList([{ label: 'log', insertText: 'log($1)', insertTextFormat: 2 }], WORD_RANGE);
        expect(list.suggestions[0].insertTextRules).toBe(MONACO_INSERT_AS_SNIPPET);
    });

    it('leaves a plain-text item with no snippet rule', () => {
        const list = toCompletionList([{ label: 'log', insertText: 'log', insertTextFormat: 1 }], WORD_RANGE);
        expect(list.suggestions[0].insertTextRules).toBeUndefined();
    });

    it('carries the auto-import edit through', () => {
        const list = toCompletionList(
            [{
                label: 'Widget',
                additionalTextEdits: [
                    { range: lspRange(0, 0, 0, 0), newText: "import { Widget } from './widget';\n" },
                    { newText: 'no range' },
                ],
            }],
            WORD_RANGE,
        );
        expect(list.suggestions[0].additionalTextEdits).toEqual([
            {
                range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
                text: "import { Widget } from './widget';\n",
            },
        ]);
    });

    it('keeps a structured label, detail, sorting and commit characters', () => {
        const list = toCompletionList(
            [{
                label: { label: 'map', detail: '(fn)', description: 'Array' },
                detail: 'method',
                documentation: { kind: 'markdown', value: 'Maps.' },
                sortText: '0001',
                filterText: 'map',
                preselect: true,
                commitCharacters: ['(', 3],
            }],
            WORD_RANGE,
        );
        expect(list.suggestions[0]).toMatchObject({
            label: { label: 'map', detail: '(fn)', description: 'Array' },
            insertText: 'map',
            detail: 'method',
            documentation: { value: 'Maps.' },
            sortText: '0001',
            filterText: 'map',
            preselect: true,
            commitCharacters: ['('],
        });
    });

    it('tags a deprecated item in either spelling', () => {
        const tagged = toCompletionList([{ label: 'old', tags: [1] }], WORD_RANGE);
        const legacy = toCompletionList([{ label: 'old', deprecated: true }], WORD_RANGE);
        expect(tagged.suggestions[0].tags).toEqual([MONACO_COMPLETION_TAG_DEPRECATED]);
        expect(legacy.suggestions[0].tags).toEqual([MONACO_COMPLETION_TAG_DEPRECATED]);
        expect(toCompletionList([{ label: 'new' }], WORD_RANGE).suggestions[0].tags).toBeUndefined();
    });

    it('reports an incomplete list so Monaco asks again on the next keystroke', () => {
        expect(toCompletionList({ isIncomplete: true, items: [{ label: 'a' }] }, WORD_RANGE).incomplete).toBe(true);
    });

    it('drops items with no label rather than showing a blank row', () => {
        const list = toCompletionList([{ label: '' }, { kind: 2 }, null, { label: 'ok' }], WORD_RANGE);
        expect(list.suggestions).toHaveLength(1);
        expect(list.suggestions[0].label).toBe('ok');
    });

    it('is empty for no result', () => {
        expect(toCompletionList(null, WORD_RANGE)).toEqual({ suggestions: [], incomplete: false });
    });
});

describe('signature help', () => {
    it('keeps offset parameter labels and the active indices', () => {
        const help = toSignatureHelp({
            signatures: [
                {
                    label: 'greet(name: string, loud?: boolean): void',
                    documentation: 'Greets.',
                    parameters: [{ label: [6, 18] }, { label: 'loud?: boolean', documentation: 'Shout.' }],
                },
            ],
            activeSignature: 0,
            activeParameter: 1,
        });
        expect(help).toEqual({
            signatures: [
                {
                    label: 'greet(name: string, loud?: boolean): void',
                    documentation: { value: 'Greets.' },
                    parameters: [
                        { label: [6, 18] },
                        { label: 'loud?: boolean', documentation: { value: 'Shout.' } },
                    ],
                },
            ],
            activeSignature: 0,
            activeParameter: 1,
        });
    });

    it('defaults both active indices to the first entry', () => {
        const help = toSignatureHelp({ signatures: [{ label: 'f()' }] });
        expect(help).toEqual({
            signatures: [{ label: 'f()', parameters: [] }],
            activeSignature: 0,
            activeParameter: 0,
        });
    });

    it('keeps a per-signature active parameter', () => {
        const help = toSignatureHelp({ signatures: [{ label: 'f(a, b)', activeParameter: 1 }] });
        expect(help?.signatures[0].activeParameter).toBe(1);
    });

    it('is null when there is no usable signature', () => {
        expect(toSignatureHelp(null)).toBeNull();
        expect(toSignatureHelp({ signatures: [] })).toBeNull();
        expect(toSignatureHelp({ signatures: [{ documentation: 'no label' }] })).toBeNull();
    });
});

describe('range narrowing', () => {
    it('accepts a well-formed range and refuses everything else', () => {
        expect(asLspRange(lspRange(1, 2, 3, 4))).toEqual(lspRange(1, 2, 3, 4));
        expect(asLspRange({ start: { line: 1 }, end: { line: 2, character: 0 } })).toBeNull();
        expect(asLspRange([{ line: 0, character: 0 }])).toBeNull();
        expect(asLspRange(undefined)).toBeNull();
    });

    it('drops a text edit that is missing its text', () => {
        expect(toTextEdits([{ range: lspRange(0, 0, 0, 1) }])).toEqual([]);
        expect(toTextEdits('not a list')).toEqual([]);
    });
});
