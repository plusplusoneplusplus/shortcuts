/**
 * Semantic tokens from a language server, translated for Monaco.
 *
 * A server describes its tokens with its own legend: clangd's index 2 is not
 * pyright's index 2. Monaco also styles *every* token it is handed — a type the
 * theme has no rule for falls back to the plain foreground and would wipe out
 * the Monarch colors underneath. So the server's data is never passed through.
 * It is decoded against the server's legend and re-encoded against one fixed
 * CoC legend that contains only the types the themes below color. Anything else
 * (operators, brackets, inactive-code comments, unknown types) is dropped and
 * keeps its basic syntax color.
 *
 * The CoC legend names are prefixed (`lsp.class`, not `class`) so the theme
 * rules cannot match a Monarch token such as `type.identifier` and recolor
 * editors that have no language server at all.
 *
 * Runtime-Monaco-free: the theme installer takes the namespace structurally.
 */

import type { LanguageServerSessionStateView } from './languageServerClient';

// ============================================================================
// Legends
// ============================================================================

export interface SemanticTokensLegend {
    tokenTypes: string[];
    tokenModifiers: string[];
}

/** Standard LSP token types CoC colors, in CoC legend order. */
const STYLED_TOKEN_TYPES = [
    'namespace',
    'type',
    'class',
    'enum',
    'interface',
    'struct',
    'typeParameter',
    'concept',
    'parameter',
    'variable',
    'property',
    'enumMember',
    'event',
    'function',
    'method',
    'macro',
    'decorator',
] as const;

/** Modifiers CoC colors. Bit `i` of a CoC modifier set is entry `i`. */
const STYLED_TOKEN_MODIFIERS = ['readonly'] as const;

export const SEMANTIC_TOKEN_PREFIX = 'lsp';

/** The only legend Monaco ever sees from CoC. */
export const COC_SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
    tokenTypes: STYLED_TOKEN_TYPES.map(type => `${SEMANTIC_TOKEN_PREFIX}.${type}`),
    tokenModifiers: [...STYLED_TOKEN_MODIFIERS],
};

const STYLED_TYPE_INDEX = new Map<string, number>(STYLED_TOKEN_TYPES.map((type, index) => [type, index]));
const STYLED_MODIFIER_INDEX = new Map<string, number>(STYLED_TOKEN_MODIFIERS.map((modifier, index) => [modifier, index]));

/** Client capability values: every type and modifier the LSP specification names. */
export const LSP_SEMANTIC_TOKEN_TYPES = [
    'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter',
    'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
    'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator',
];

// ============================================================================
// Capability
// ============================================================================

export interface SemanticTokensSupport {
    legend: SemanticTokensLegend;
    /** `textDocument/semanticTokens/full` is available. */
    full: boolean;
    /** `textDocument/semanticTokens/range` is available. */
    range: boolean;
}

function readStrings(value: unknown): string[] | null {
    if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string')) {
        return null;
    }
    return value as string[];
}

function readProviderOptions(value: unknown): SemanticTokensSupport | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const options = value as { legend?: unknown; full?: unknown; range?: unknown };
    const legend = options.legend as { tokenTypes?: unknown; tokenModifiers?: unknown } | undefined;
    const tokenTypes = readStrings(legend?.tokenTypes);
    if (!tokenTypes || tokenTypes.length === 0) {
        return null;
    }
    const tokenModifiers = legend?.tokenModifiers === undefined ? [] : readStrings(legend.tokenModifiers);
    if (!tokenModifiers) {
        return null;
    }
    const full = options.full === true || (typeof options.full === 'object' && options.full !== null);
    const range = options.range === true || (typeof options.range === 'object' && options.range !== null);
    if (!full && !range) {
        return null;
    }
    return { legend: { tokenTypes, tokenModifiers }, full, range };
}

/**
 * What one session offers, read from its `initialize` capabilities or, when it
 * registered the feature later, from that dynamic registration. Null means no
 * usable semantic tokens: missing, malformed legend, or neither request mode.
 */
export function readSemanticTokensSupport(
    state: LanguageServerSessionStateView | null | undefined,
): SemanticTokensSupport | null {
    const capabilities = state?.capabilities as Record<string, unknown> | undefined;
    const advertised = readProviderOptions(capabilities?.semanticTokensProvider);
    if (advertised) {
        return advertised;
    }
    const registrations = state?.dynamicRegistrations;
    if (!Array.isArray(registrations)) {
        return null;
    }
    for (const registration of registrations) {
        const entry = registration as { method?: unknown; registerOptions?: unknown } | null;
        if (entry?.method === 'textDocument/semanticTokens') {
            const registered = readProviderOptions(entry.registerOptions);
            if (registered) {
                return registered;
            }
        }
    }
    return null;
}

/** Stable text for a support record, so a registration rebuilds only when it changes. */
export function semanticTokensFingerprint(support: SemanticTokensSupport | null): string {
    if (!support) {
        return 'none';
    }
    return [
        support.full ? 'full' : '',
        support.range ? 'range' : '',
        support.legend.tokenTypes.join(','),
        support.legend.tokenModifiers.join(','),
    ].join(';');
}

// ============================================================================
// Data translation
// ============================================================================

const MAX_UINT32 = 0xffffffff;

/**
 * Decodes the server's relative five-integer encoding against its legend and
 * re-encodes the styled tokens against `COC_SEMANTIC_TOKENS_LEGEND`.
 *
 * Returns null for data that is not a well-formed token array, so a malformed
 * reply clears semantic colors instead of painting garbage. Tokens of a type
 * outside the CoC legend, out-of-range indices and empty tokens are skipped.
 */
export function translateSemanticTokens(data: unknown, legend: SemanticTokensLegend): Uint32Array | null {
    if (!Array.isArray(data) && !(data instanceof Uint32Array)) {
        return null;
    }
    const values = data as ArrayLike<unknown>;
    if (values.length % 5 !== 0) {
        return null;
    }
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
            return null;
        }
    }
    const numbers = values as ArrayLike<number>;

    // Server modifier bit -> CoC modifier bit, built once per response.
    const modifierMap: number[] = legend.tokenModifiers.map((modifier) => {
        const index = STYLED_MODIFIER_INDEX.get(modifier);
        return index === undefined ? 0 : 1 << index;
    });

    const out: number[] = [];
    let line = 0;
    let character = 0;
    let lastLine = 0;
    let lastCharacter = 0;
    for (let offset = 0; offset < numbers.length; offset += 5) {
        const deltaLine = numbers[offset];
        const deltaStart = numbers[offset + 1];
        const length = numbers[offset + 2];
        const typeIndex = numbers[offset + 3];
        const modifierSet = numbers[offset + 4];
        line += deltaLine;
        character = deltaLine === 0 ? character + deltaStart : deltaStart;

        const typeName = legend.tokenTypes[typeIndex];
        const styledType = typeName === undefined ? undefined : STYLED_TYPE_INDEX.get(typeName);
        if (styledType === undefined || length === 0) {
            continue;
        }
        let styledModifiers = 0;
        for (let bit = 0; bit < modifierMap.length && bit < 32; bit += 1) {
            if ((modifierSet >>> bit) & 1) {
                styledModifiers |= modifierMap[bit];
            }
        }
        out.push(
            line - lastLine,
            line === lastLine ? character - lastCharacter : character,
            length,
            styledType,
            styledModifiers,
        );
        lastLine = line;
        lastCharacter = character;
    }
    return Uint32Array.from(out);
}

// ============================================================================
// Theme
// ============================================================================

export interface SemanticThemeRule {
    token: string;
    foreground: string;
}

type ThemeBase = 'vs' | 'vs-dark';

/** VS Code Light+ / Dark+ semantic colors, so the palette looks familiar. */
const SEMANTIC_COLORS: Array<{ tokens: string[]; light: string; dark: string }> = [
    {
        tokens: ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'concept'],
        light: '267F99',
        dark: '4EC9B0',
    },
    { tokens: ['function', 'method', 'decorator'], light: '795E26', dark: 'DCDCAA' },
    { tokens: ['parameter', 'variable', 'property', 'event'], light: '001080', dark: '9CDCFE' },
    { tokens: ['enumMember', 'variable.readonly', 'property.readonly'], light: '0070C1', dark: '4FC1FF' },
    { tokens: ['macro'], light: '0000FF', dark: '569CD6' },
];

/** Theme rules for every CoC legend type, for one built-in base theme. */
export function semanticThemeRules(base: ThemeBase): SemanticThemeRule[] {
    return SEMANTIC_COLORS.flatMap(({ tokens, light, dark }) => tokens.map(token => ({
        token: `${SEMANTIC_TOKEN_PREFIX}.${token}`,
        foreground: base === 'vs-dark' ? dark : light,
    })));
}

export interface SemanticThemeMonaco {
    editor: {
        defineTheme(
            name: string,
            data: { base: ThemeBase; inherit: boolean; rules: SemanticThemeRule[]; colors: Record<string, string> },
        ): void;
    };
}

/**
 * Adds the semantic rules to the built-in `vs` and `vs-dark` themes in place.
 * Every editor keeps naming the same theme, and the prefixed rules only ever
 * match tokens produced by `translateSemanticTokens`.
 */
export function installSemanticTokenThemes(monaco: SemanticThemeMonaco): void {
    for (const base of ['vs', 'vs-dark'] as const) {
        monaco.editor.defineTheme(base, { base, inherit: true, rules: semanticThemeRules(base), colors: {} });
    }
}
