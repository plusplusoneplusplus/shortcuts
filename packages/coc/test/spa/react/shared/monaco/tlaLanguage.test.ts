// @vitest-environment jsdom
/**
 * TLA+ highlighting: `.tla` files resolve to the `tla` language, the language
 * registers exactly once, and the real Monaco Monarch engine tokenizes a
 * representative module — comments (line, nested block, PlusCal), escaped
 * strings, keywords, operators and literals.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getMonacoLanguage } from '../../../../../src/server/spa/client/react/shared/file-viewer/monacoLanguage';
import {
    TLA_LANGUAGE_ID,
    registerTlaLanguage,
    type TlaMonaco,
} from '../../../../../src/server/spa/client/react/shared/monaco/tlaLanguage';

type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api.js');
let monaco: MonacoApi;

beforeAll(async () => {
    // Monaco's standalone theme service probes `matchMedia`, which jsdom lacks.
    window.matchMedia ??= ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
    registerTlaLanguage(monaco as unknown as TlaMonaco);
});

/** Each line's tokens as `[text, type]` pairs, whitespace dropped. */
function tokenize(source: string): Array<Array<[string, string]>> {
    const lines = source.split('\n');
    return monaco.editor.tokenize(source, TLA_LANGUAGE_ID).map((tokens, row) => {
        const line = lines[row];
        return tokens
            .map((token, i): [string, string] => [
                line.slice(token.offset, tokens[i + 1]?.offset ?? line.length),
                token.type.replace(/\.tla$/, ''),
            ])
            .filter(([text, type]) => type !== 'white' && text.trim() !== '');
    });
}

function typeOf(source: string, text: string): string | undefined {
    return tokenize(source).flat().find(([t]) => t === text)?.[1];
}

describe('TLA+ language detection', () => {
    it('maps .tla files to the tla language, case-insensitively', () => {
        expect(getMonacoLanguage('Spec.tla')).toBe('tla');
        expect(getMonacoLanguage('dir/TwoPhase.TLA')).toBe('tla');
    });

    it('keeps unrelated languages resolving as before', () => {
        expect(getMonacoLanguage('a.ts')).toBe('typescript');
        expect(getMonacoLanguage('a.rs')).toBe('rust');
        expect(getMonacoLanguage('a.py')).toBe('python');
        expect(getMonacoLanguage('Dockerfile')).toBe('dockerfile');
        expect(getMonacoLanguage('a.cfg')).toBe('plaintext');
        expect(getMonacoLanguage('README')).toBe('plaintext');
    });
});

describe('TLA+ language registration', () => {
    it('is registered with Monaco under the tla id', () => {
        const tla = monaco.languages.getLanguages().filter((l) => l.id === TLA_LANGUAGE_ID);
        expect(tla).toHaveLength(1);
        expect(tla[0].extensions).toContain('.tla');
    });

    it('is idempotent', () => {
        const fake: TlaMonaco = {
            languages: {
                getLanguages: () => (fake.languages.register as ReturnType<typeof vi.fn>).mock.calls.map(([d]) => d),
                register: vi.fn(),
                setLanguageConfiguration: vi.fn(),
                setMonarchTokensProvider: vi.fn(),
            },
        };
        registerTlaLanguage(fake);
        registerTlaLanguage(fake);
        expect(fake.languages.register).toHaveBeenCalledTimes(1);
        expect(fake.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);

        registerTlaLanguage(monaco as unknown as TlaMonaco);
        expect(monaco.languages.getLanguages().filter((l) => l.id === TLA_LANGUAGE_ID)).toHaveLength(1);
    });

    it('models created afterwards carry the tla language', () => {
        const model = monaco.editor.createModel('---- MODULE M ----\n====', undefined, monaco.Uri.parse('file:///M.tla'));
        try {
            expect(model.getLanguageId()).toBe('tla');
        } finally {
            model.dispose();
        }
    });
});

describe('TLA+ tokenization', () => {
    const spec = [
        '------------------------------ MODULE TwoPhase ------------------------------',
        'EXTENDS Naturals, Sequences, TLC',
        'CONSTANTS RM',
        'VARIABLES rmState, msgs',
        '\\* a line comment with IF THEN and "not a string"',
        '(* outer (* nested *) still EXTENDS comment *)',
        'TypeOK == /\\ rmState \\in [RM -> {"working", "pre\\"pared"}]',
        '          /\\ msgs \\subseteq SUBSET Nat',
        'Init == rmState = [r \\in RM |-> "working"] /\\ x = 42 /\\ ok = TRUE',
        'Spec == Init /\\ [][Next]_<<rmState, msgs>> /\\ WF_vars(Next) /\\ <>(x\' > 3)',
        'Live == \\A r \\in RM : (x ~> y) \\/ ~FALSE',
        '=============================================================================',
    ].join('\n');

    it('tokenizes the module delimiters and header', () => {
        const [header] = tokenize(spec);
        expect(header).toEqual([
            ['------------------------------', 'keyword'],
            ['MODULE', 'keyword'],
            ['TwoPhase', 'type.identifier'],
            ['------------------------------', 'keyword'],
        ]);
        expect(tokenize(spec).at(-1)).toEqual([['=============================================================================', 'keyword']]);
    });

    it('tokenizes section keywords and definitions', () => {
        expect(tokenize(spec)[1].slice(0, 2)).toEqual([['EXTENDS', 'keyword'], ['Naturals', 'identifier']]);
        expect(typeOf(spec, 'CONSTANTS')).toBe('keyword');
        expect(typeOf(spec, 'VARIABLES')).toBe('keyword');
        expect(typeOf(spec, 'SUBSET')).toBe('keyword');
        expect(typeOf(spec, 'Nat')).toBe('type');
        expect(typeOf(spec, '==')).toBe('operator');
    });

    it('tokenizes booleans, numbers and escaped strings', () => {
        expect(typeOf(spec, 'TRUE')).toBe('keyword');
        expect(typeOf(spec, '42')).toBe('number');
        const typeOk = tokenize(spec)[6];
        expect(typeOk).toEqual(expect.arrayContaining([
            ['"working"', 'string'], ['"pre', 'string'], ['\\"', 'string.escape'], ['pared"', 'string'],
        ]));
        expect(tokenize('x == "a\\qb"')[0]).toContainEqual(['\\q', 'string.escape.invalid']);
        expect(tokenize('x == \\b101 + \\hFF + 1.5')[0]).toEqual(expect.arrayContaining([
            ['\\b101', 'number.hex'], ['\\hFF', 'number.hex'], ['1.5', 'number.float'],
        ]));
    });

    it('tokenizes logic, set and temporal operators', () => {
        for (const op of ['/\\', '\\in', '\\subseteq', '[]', '<>', '\\A', '~>', '\\/', '\'']) {
            expect(typeOf(spec, op), op).toBe('keyword.operator');
        }
        expect(typeOf(spec, 'WF_')).toBe('keyword');
        expect(typeOf(spec, '|->')).toBe('operator');
        expect(typeOf(spec, '<<')).toBe('delimiter.angle');
    });

    it('keeps line and nested block comment text out of TLA+ code', () => {
        const lines = tokenize(spec);
        expect(lines[4]).toEqual([['\\* a line comment with IF THEN and "not a string"', 'comment']]);
        expect(lines[5].every(([, type]) => type === 'comment')).toBe(true);
        // Nesting: the first `*)` closes only the inner comment.
        expect(tokenize('(* a (* b *) c *) X')[0].at(-1)).toEqual(['X', 'identifier']);
    });

    it('carries an unclosed block comment across lines', () => {
        const lines = tokenize('(* start\nVARIABLES x\n*) VARIABLES y');
        expect(lines[1]).toEqual([['VARIABLES x', 'comment']]);
        expect(lines[2]).toContainEqual(['VARIABLES', 'keyword']);
    });

    it('highlights an embedded PlusCal algorithm but not the comment around it', () => {
        const source = [
            '(* intro text with IF',
            '--fair algorithm Counter {',
            'variables x = 0;',
            'begin',
            'Lbl: while x < 3 do',
            '  x := x + 1; \\* bump',
            'end while;',
            'end algorithm; trailing IF text *)',
            'Next == x\' = x',
        ].join('\n');
        const lines = tokenize(source);
        expect(lines[0]).toEqual([['(* intro text with IF', 'comment']]);
        expect(lines[1][0]).toEqual(['--fair algorithm', 'keyword']);
        expect(lines[2][0]).toEqual(['variables', 'keyword']);
        expect(lines[4].slice(0, 3)).toEqual([['Lbl', 'tag'], [':', 'delimiter'], ['while', 'keyword']]);
        expect(lines[5]).toContainEqual([':=', 'operator']);
        expect(lines[5].at(-1)).toEqual(['\\* bump', 'comment']);
        expect(lines[7].slice(0, 2)).toEqual([['end', 'keyword'], ['algorithm', 'keyword']]);
        expect(lines[7].slice(2).every(([, type]) => type === 'comment')).toBe(true);
        expect(lines[8][0]).toEqual(['Next', 'identifier']);
    });
});
