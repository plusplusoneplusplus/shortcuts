// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getMonacoLanguage } from '../../../../../src/server/spa/client/react/shared/file-viewer/monacoLanguage';
import {
    LEAN_LANGUAGE_ID, leanLanguageConfiguration, leanMonarchLanguage, registerLeanLanguage,
} from '../../../../../src/server/spa/client/react/shared/monaco/leanLanguage';

type MonacoApi = typeof import('monaco-editor/esm/vs/editor/editor.api.js');
let monaco: MonacoApi;

beforeAll(async () => {
    window.matchMedia ??= ((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    monaco = await import('monaco-editor/esm/vs/editor/editor.api.js');
    registerLeanLanguage(monaco);
});

function tokenize(source: string): Array<Array<[string, string]>> {
    const lines = source.split('\n');
    return monaco.editor.tokenize(source, LEAN_LANGUAGE_ID).map((tokens, row) => tokens
        .map((token, i): [string, string] => [
            lines[row].slice(token.offset, tokens[i + 1]?.offset ?? lines[row].length),
            token.type.replace(/\.lean$/, ''),
        ])
        .filter(([text, type]) => type !== 'white' && text.trim() !== ''));
}

describe('Lean registration and detection', () => {
    it.each(['Main.lean', 'Mathlib/Proof.LEAN', 'C:\\repo\\Main.lean'])('detects %s', path => {
        expect(getMonacoLanguage(path)).toBe('lean');
    });

    it('leaves other extensions alone', () => {
        for (const [path, id] of [['a.tla', 'tla'], ['a.ts', 'typescript'], ['a.rs', 'rust'], ['a.py', 'python'], ['a.olean', 'plaintext']]) {
            expect(getMonacoLanguage(path)).toBe(id);
        }
    });

    it('registers configuration and tokenizer once per Monaco instance', () => {
        const definitions: Array<{ id: string }> = [];
        const fake = { languages: {
            getLanguages: () => definitions,
            register: vi.fn(definition => { definitions.push(definition); }),
            setLanguageConfiguration: vi.fn(),
            setMonarchTokensProvider: vi.fn(),
        } };
        registerLeanLanguage(fake);
        registerLeanLanguage(fake);
        expect(fake.languages.register).toHaveBeenCalledExactlyOnceWith({ id: 'lean', extensions: ['.lean'], aliases: ['Lean', 'lean'] });
        expect(fake.languages.setLanguageConfiguration).toHaveBeenCalledExactlyOnceWith('lean', leanLanguageConfiguration);
        expect(fake.languages.setMonarchTokensProvider).toHaveBeenCalledExactlyOnceWith('lean', leanMonarchLanguage);
        expect(monaco.languages.getLanguages().filter(language => language.id === 'lean')).toHaveLength(1);
    });

    it('infers Lean on newly created file models', () => {
        const model = monaco.editor.createModel('def n := 1', undefined, monaco.Uri.parse('file:///Main.lean'));
        try { expect(model.getLanguageId()).toBe('lean'); } finally { model.dispose(); }
    });

    it('preserves an existing Lean registration', () => {
        const fake = { languages: {
            getLanguages: () => [{ id: 'lean' }],
            register: vi.fn(),
            setLanguageConfiguration: vi.fn(),
            setMonarchTokensProvider: vi.fn(),
        } };
        registerLeanLanguage(fake);
        expect(fake.languages.register).not.toHaveBeenCalled();
        expect(fake.languages.setLanguageConfiguration).not.toHaveBeenCalled();
        expect(fake.languages.setMonarchTokensProvider).not.toHaveBeenCalled();
    });

    it('configures Lean comments and brackets without pairing identifier apostrophes', () => {
        expect(leanLanguageConfiguration.comments).toEqual({ lineComment: '--', blockComment: ['/-', '-/'] });
        expect(leanLanguageConfiguration.brackets).toContainEqual(['⟨', '⟩']);
        expect(leanLanguageConfiguration.autoClosingPairs).not.toContainEqual({ open: "'", close: "'" });
        expect("α₁'".match(leanLanguageConfiguration.wordPattern!)?.[0]).toBe("α₁'");
    });
});

describe('Lean Monarch syntax', () => {
    it('highlights declarations, proofs, tactics and Unicode syntax', () => {
        const tokens = tokenize([
            'import Mathlib',
            'namespace Demo',
            'theorem identity (α : Type) (x : α) : x = x := by',
            '  have h : ∀ n : Nat, n ≤ n := by intro n; exact Nat.le_refl n',
            '  simp',
            'def pair := ⟨1, 2⟩',
            '#check identity',
            'end Demo',
        ].join('\n')).flat();
        for (const word of ['import', 'namespace', 'theorem', 'by', 'have', 'intro', 'exact', 'simp', 'def', '#check', 'end']) {
            expect(tokens).toContainEqual([word, 'keyword']);
        }
        for (const op of ['∀', '≤', ':=']) expect(tokens).toContainEqual([op, 'operator']);
        expect(tokens).toContainEqual(['α', 'identifier']);
        expect(tokens).toContainEqual(['Type', 'type']);
        expect(tokenize('λ x => x')[0][0]).toEqual(['λ', 'operator']);
        expect(tokens).toContainEqual(['Nat', 'type']);
        expect(tokens).toContainEqual(['⟨', 'delimiter.angle']);
    });

    it('handles Unicode names, primes, quoted keywords and symbolic operators', () => {
        expect(tokenize("def α₁' := «theorem» + β₂ × 2 ÷ 1 → ℕ")[0]).toEqual(expect.arrayContaining([
            ["α₁'", 'identifier'], ['«theorem»', 'identifier'], ['β₂', 'identifier'],
            ['×', 'operator'], ['÷', 'operator'], ['→', 'operator'], ['ℕ', 'identifier'],
        ]));
    });

    it('keeps line, doc and nested block comments separate from code across lines', () => {
        const lines = tokenize('-- theorem "text"\n/-- docs /- nested\n-/ still docs -/ def x := 1\n/-! module docs -/');
        expect(lines[0]).toEqual([['-- theorem "text"', 'comment']]);
        expect(lines[1].every(([, type]) => type === 'comment')).toBe(true);
        expect(lines[2]).toContainEqual(['def', 'keyword']);
        expect(lines[2][0]).toEqual(['-/ still docs -/', 'comment']);
        expect(lines[3].every(([, type]) => type === 'comment')).toBe(true);
    });

    it('handles strings, escapes, characters and identifier primes', () => {
        const tokens = tokenize(String.raw`def s := "-- /- \"hello\"\n\u03BB"; def c := 'λ'; def c' := '\n'`).flat();
        expect(tokens).toContainEqual(['\\"', 'string.escape']);
        expect(tokenize(String.raw`"\n"`)[0]).toContainEqual(['\\n', 'string.escape']);
        expect(tokenize(String.raw`"\u03BB"`)[0]).toContainEqual(['\\u03BB', 'string.escape']);
        expect(tokens).toContainEqual(["'λ'", 'string']);
        expect(tokens).toContainEqual(["'\\n'", 'string']);
        expect(tokens).toContainEqual(["c'", 'identifier']);
        expect(tokens.some(([, type]) => type === 'comment')).toBe(false);
        expect(tokenize(String.raw`"bad\q"`)[0]).toContainEqual(['\\q', 'string.escape.invalid']);
        expect(tokenize('"first\n-- still string" def')[1]).toContainEqual(['def', 'keyword']);
    });

    it.each(['r"plain \\n"', 'r#"a "quote" \\n"#', 'r##"inner "# /- --"##'])('keeps raw string content literal: %s', literal => {
        const tokens = tokenize(`${literal} def x := 1`)[0];
        expect(tokens[0]).toEqual([literal, 'string']);
        expect(tokens).toContainEqual(['def', 'keyword']);
    });

    it('highlights numeric literals without consuming projection dots', () => {
        expect(tokenize('42 0xff 0b101 0o77 1.25e-3 x.1')[0]).toEqual([
            ['42', 'number'], ['0xff', 'number.hex'], ['0b101', 'number.hex'],
            ['0o77', 'number.hex'], ['1.25e-3', 'number.float'],
            ['x', 'identifier'], ['.', 'delimiter'], ['1', 'number'],
        ]);
    });
});
