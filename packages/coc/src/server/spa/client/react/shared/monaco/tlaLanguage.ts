/**
 * TLA+ syntax highlighting for Monaco.
 *
 * Monaco's bundle ships no TLA+ tokenizer, so this module supplies a Monarch
 * definition and registers it under the `tla` id that `getMonacoLanguage`
 * maps `.tla` files to. Token names are the standard Monaco classes
 * (`keyword`, `type`, `number`, `string`, `comment`, `operator`, `delimiter`)
 * so the built-in `vs` and `vs-dark` themes color them like every other
 * language.
 *
 * Comments are `\*` to end of line and `(* ... *)` blocks, which nest. A
 * PlusCal algorithm (`--algorithm` / `--fair algorithm`) lives inside a block
 * comment; it is tokenized with PlusCal keywords until `end algorithm`, and
 * every other comment's text stays a comment.
 *
 * Like `shadowLanguage.ts`, this module has no runtime Monaco dependency: the
 * namespace is a structurally typed argument handed in by `monaco-setup.ts`.
 */

export const TLA_LANGUAGE_ID = 'tla';

export const tlaLanguageConfiguration = {
    comments: { lineComment: '\\*', blockComment: ['(*', '*)'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')'], ['<<', '>>']],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '<<', close: '>>' },
        { open: '"', close: '"', notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
    ],
};

export const tlaMonarchLanguage = {
    defaultToken: '',
    tokenPostfix: '.tla',

    keywords: [
        'ACTION', 'ASSUME', 'ASSUMPTION', 'AXIOM', 'BY', 'CASE', 'CHOOSE', 'CONSTANT', 'CONSTANTS',
        'COROLLARY', 'DEF', 'DEFINE', 'DEFS', 'DOMAIN', 'ELSE', 'ENABLED', 'EXCEPT', 'EXTENDS',
        'HAVE', 'HIDE', 'IF', 'IN', 'INSTANCE', 'LAMBDA', 'LEMMA', 'LET', 'LOCAL', 'MODULE', 'NEW',
        'OBVIOUS', 'OMITTED', 'ONLY', 'OTHER', 'PICK', 'PROOF', 'PROPOSITION', 'PROVE', 'QED',
        'RECURSIVE', 'STATE', 'SUBSET', 'SUFFICES', 'TAKE', 'TEMPORAL', 'THEN', 'THEOREM',
        'UNCHANGED', 'UNION', 'USE', 'VARIABLE', 'VARIABLES', 'WITH', 'WITNESS',
        'TRUE', 'FALSE',
    ],

    typeKeywords: ['BOOLEAN', 'STRING', 'Nat', 'Int', 'Real', 'Seq'],

    pluscalKeywords: [
        'algorithm', 'fair', 'process', 'procedure', 'macro', 'define', 'variable', 'variables',
        'begin', 'end', 'if', 'then', 'elsif', 'else', 'while', 'do', 'either', 'or', 'with',
        'await', 'when', 'call', 'return', 'goto', 'skip', 'assert', 'print', 'self',
        'TRUE', 'FALSE',
    ],

    brackets: [
        { open: '{', close: '}', token: 'delimiter.curly' },
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    escapes: /\\[\\"tnfr]/,

    tokenizer: {
        root: [
            // Module header `---- MODULE Name ----` and footer `====`.
            [/(-{4,})(\s*)(MODULE)(\s+)([A-Za-z0-9_]+)/, ['keyword', 'white', 'keyword', 'white', 'type.identifier']],
            [/-{4,}|={4,}/, 'keyword'],
            { include: '@common' },
        ],

        common: [
            { include: '@whitespace' },
            // Proof step labels: <1>, <2>3., <1>a
            [/<\d+>[A-Za-z0-9_]*\.?/, 'tag'],
            // Fairness subscripts: WF_vars(Next), SF_vars(Next)
            [/\b[WS]F_/, 'keyword'],
            [/[A-Za-z_][A-Za-z0-9_]*/, {
                cases: { '@keywords': 'keyword', '@typeKeywords': 'type', '@default': 'identifier' },
            }],
            [/\d+\.\d+/, 'number.float'],
            [/\\[bB][01]+|\\[oO][0-7]+|\\[hH][0-9a-fA-F]+/, 'number.hex'],
            [/\d+/, 'number'],
            [/"/, 'string', '@string'],
            // Logic and temporal operators read like keywords: /\ \/ \A \E \in [] <> ~> -+->
            [/\/\\|\\\/|\\[A-Za-z]+|\[\]|<>|~>|-\+->|'/, 'keyword.operator'],
            [/<<|>>/, 'delimiter.angle'],
            [/[{}()[\]]/, '@brackets'],
            [/==|<=>|=>|\|->|->|<-|\/=|=<|<=|>=|:=|::|\.\.|\|-|@@|:>|[=<>#~+\-*/^%&|:@!$?]/, 'operator'],
            [/[;,.]/, 'delimiter'],
        ],

        whitespace: [
            [/[ \t\r\n]+/, 'white'],
            [/\(\*/, 'comment', '@comment'],
            [/\\\*.*$/, 'comment'],
        ],

        comment: [
            [/--(fair\s+)?algorithm\b/, { token: 'keyword', next: '@pluscal' }],
            [/\(\*/, 'comment', '@push'],
            [/\*\)/, 'comment', '@pop'],
            [/[^(*-]+/, 'comment'],
            [/[(*-]/, 'comment'],
        ],

        pluscal: [
            // `end algorithm` hands the rest of the block back to the comment.
            [/(end)(\s+)(algorithm)/, [{ token: 'keyword' }, 'white', { token: 'keyword', next: '@pop' }]],
            // A comment closed without `end algorithm` closes the algorithm too.
            [/\*\)/, { token: 'comment', next: '@popall' }],
            // Statement labels at the start of a line: `Lbl:`
            [/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(:)(?![:=])/, ['white', 'tag', 'delimiter']],
            [/[A-Za-z_][A-Za-z0-9_]*/, {
                cases: {
                    '@pluscalKeywords': 'keyword',
                    '@keywords': 'keyword',
                    '@typeKeywords': 'type',
                    '@default': 'identifier',
                },
            }],
            { include: '@common' },
        ],

        string: [
            [/[^\\"]+/, 'string'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/"/, 'string', '@pop'],
        ],
    },
};

/** The slice of the Monaco namespace this module uses. */
export interface TlaMonaco {
    languages: {
        getLanguages(): Array<{ id: string }>;
        register(definition: { id: string; extensions?: string[]; aliases?: string[] }): void;
        setLanguageConfiguration(languageId: string, configuration: never): unknown;
        setMonarchTokensProvider(languageId: string, definition: never): unknown;
    };
}

/**
 * Register the `tla` language with its configuration and tokenizer. Idempotent:
 * a second call (another bundle evaluation, a test) leaves the first
 * registration alone, since re-registering would stack tokenizers.
 */
export function registerTlaLanguage(monaco: TlaMonaco): void {
    if (monaco.languages.getLanguages().some((language) => language.id === TLA_LANGUAGE_ID)) return;
    monaco.languages.register({ id: TLA_LANGUAGE_ID, extensions: ['.tla'], aliases: ['TLA+', 'tla'] });
    monaco.languages.setLanguageConfiguration(TLA_LANGUAGE_ID, tlaLanguageConfiguration as never);
    monaco.languages.setMonarchTokensProvider(TLA_LANGUAGE_ID, tlaMonarchLanguage as never);
}
