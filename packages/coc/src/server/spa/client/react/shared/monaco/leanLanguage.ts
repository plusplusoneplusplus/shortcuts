/** Lean syntax support, shared by file editors and diffs. No language server required. */
import type { languages } from 'monaco-editor';

export const LEAN_LANGUAGE_ID = 'lean';

const identifier = /[a-zA-Z_\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02af\u0370-\u052f\u1e00-\u1eff\u2100-\u214f][a-zA-Z0-9_'!?\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02af\u0370-\u052f\u1e00-\u1eff\u2070-\u209f\u2100-\u214f]*/;

export const leanLanguageConfiguration: languages.LanguageConfiguration = {
    comments: { lineComment: '--', blockComment: ['/-', '-/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')'], ['⟨', '⟩']],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '⟨', close: '⟩' },
        { open: '«', close: '»', notIn: ['string', 'comment'] },
        { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' },
        { open: '(', close: ')' }, { open: '⟨', close: '⟩' },
        { open: '«', close: '»' }, { open: '"', close: '"' },
    ],
    // Apostrophes and subscripts belong to identifiers, not character delimiters.
    wordPattern: identifier,
};

export const leanMonarchLanguage: languages.IMonarchLanguage = {
    defaultToken: '',
    tokenPostfix: '.lean',
    brackets: [
        { open: '{', close: '}', token: 'delimiter.curly' },
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' },
        { open: '⟨', close: '⟩', token: 'delimiter.angle' },
    ],
    keywords: [
        'import', 'prelude', 'namespace', 'section', 'end', 'open', 'export', 'scoped',
        'universe', 'universes', 'variable', 'variables', 'def', 'abbrev', 'theorem',
        'lemma', 'example', 'axiom', 'constant', 'constants', 'opaque', 'inductive',
        'coinductive', 'structure', 'class', 'instance', 'extends', 'deriving',
        'where', 'with', 'mutual', 'private', 'protected', 'noncomputable', 'unsafe',
        'partial', 'local', 'attribute', 'set_option', 'in', 'at', 'as', 'of',
        'by', 'fun', 'forall', 'exists', 'let', 'have', 'show', 'from', 'suffices',
        'if', 'then', 'else', 'unless', 'match', 'return', 'do', 'for', 'while',
        'repeat', 'try', 'catch', 'finally', 'break', 'continue',
        'termination_by', 'decreasing_by', 'syntax', 'macro', 'macro_rules',
        'elab', 'elab_rules', 'declare_syntax_cat', 'notation', 'infix', 'infixl',
        'infixr', 'prefix', 'postfix', 'precedence',
        'intro', 'intros', 'apply', 'exact', 'refine', 'assumption', 'rfl',
        'simp', 'simpa', 'rw', 'rwa', 'unfold', 'dsimp', 'change', 'constructor',
        'cases', 'rcases', 'induction', 'obtain', 'calc', 'conv', 'case',
        'next', 'rename_i', 'subst', 'contradiction', 'decide', 'trivial',
        'first', 'all_goals', 'any_goals', 'focus', 'sorry', 'admit',
    ],
    typeKeywords: ['Prop', 'Type', 'Sort', 'Nat', 'Int', 'Rat', 'Float', 'Bool', 'String', 'Char', 'Unit', 'List', 'Array', 'Option', 'Fin', 'True', 'False'],
    escapes: /\\(?:[nrt\\"']|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]+\})/,
    tokenizer: {
        root: [
            [/[ \t\r\n]+/, 'white'],
            [/--.*$/, 'comment'],
            [/\/-/, 'comment', '@comment'],
            // Remember the hash delimiter so quotes inside raw strings stay literal.
            [/r(#*)"/, { token: 'string', next: '@rawString.$1' }],
            [/"/, 'string', '@string'],
            [/'(?:[^'\\\r\n]|@escapes)'/, 'string'],
            [/«[^»]*»/, 'identifier'],
            [/#(?:check|eval|print|reduce|synth|guard|guard_msgs|exit|help)\b/, 'keyword'],
            [/λ(?=\s|[({⦃])/, 'operator'],
            [identifier, {
                cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'identifier' },
            }],
            [/0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+/, 'number.hex'],
            [/\d+\.\d+(?:[eE][+-]?\d+)?/, 'number.float'],
            [/\d+/, 'number'],
            [/[{}()[\]⟨⟩]/, '@brackets'],
            [/[∀∃→←↔⇒⇐≤≥≠∧∨¬∈∉⊆⊂∪∩×÷∣∘]+|[:=+\-*\/<>!&|^%~?@$]+/, 'operator'],
            [/[.,;`]/, 'delimiter'],
        ],
        comment: [
            [/\/-/, 'comment', '@push'],
            [/-\//, 'comment', '@pop'],
            [/[^\/-]+/, 'comment'],
            [/[\/-]/, 'comment'],
        ],
        string: [
            [/[^\\"]+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\$/, 'string.escape'], // Lean string gap: backslash followed by a newline.
            [/\\./, 'string.escape.invalid'],
            [/"/, 'string', '@pop'],
        ],
        rawString: [
            [/"#*/, { cases: { '$#=="$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }],
            [/[^"]+/, 'string'],
        ],
    },
};

/** Register once per Monaco namespace, following the shared TLA+ registration pattern. */
export function registerLeanLanguage(monaco: { languages: Pick<typeof languages,
    'getLanguages' | 'register' | 'setLanguageConfiguration' | 'setMonarchTokensProvider'> }): void {
    if (monaco.languages.getLanguages().some(language => language.id === LEAN_LANGUAGE_ID)) return;
    monaco.languages.register({ id: LEAN_LANGUAGE_ID, extensions: ['.lean'], aliases: ['Lean', 'lean'] });
    monaco.languages.setLanguageConfiguration(LEAN_LANGUAGE_ID, leanLanguageConfiguration);
    monaco.languages.setMonarchTokensProvider(LEAN_LANGUAGE_ID, leanMonarchLanguage);
}
