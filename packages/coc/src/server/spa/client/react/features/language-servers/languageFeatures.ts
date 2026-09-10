/**
 * Pure conversions from LSP *result payloads* into the shapes Monaco's
 * language providers return (AC-03).
 *
 * `monacoBridge.ts` owns positions and diagnostics — the things needed to keep
 * a buffer synchronized. This module owns the answers: hover, definition,
 * references, completion and signature help. It is separate for one practical
 * reason: every function here is a total function from an untrusted JSON blob
 * to a Monaco value, and a language server is free to omit any optional field
 * or send a shape the specification allows but our first server never does. So
 * each one takes `unknown` and narrows, rather than trusting a cast.
 *
 * Nothing here imports Monaco at runtime, and nothing here talks to the
 * transport. The provider layer above supplies the request and turns the
 * `uri` strings below into `monaco.Uri` values; it is also the layer that
 * decides which models are eligible for language support at all.
 *
 * Two deliberate omissions:
 *   - A completion item's `command` is dropped. Executing a command a server
 *     names would run editor actions we have not implemented, and none of the
 *     selected features need it.
 *   - A documentation `MarkupContent` marked `plaintext` is escaped rather than
 *     passed through, because Monaco renders every markdown string as markdown.
 */

import type { LspRange } from './documentStore';
import { toMonacoRange, type MonacoRange } from './monacoBridge';

/** Monaco's `IMarkdownString`, structurally typed so tests need no Monaco. */
export interface MonacoMarkdownString {
    value: string;
}

export interface MonacoHover {
    contents: MonacoMarkdownString[];
    range?: MonacoRange;
}

/**
 * Monaco's `languages.LocationLink` with the URI still a string. The provider
 * layer parses it, because only that layer knows which URIs name a live repo
 * document and which name a dependency outside the workspace.
 */
export interface MonacoLocationLink {
    uri: string;
    range: MonacoRange;
    originSelectionRange?: MonacoRange;
    targetSelectionRange?: MonacoRange;
}

export interface MonacoTextEdit {
    range: MonacoRange;
    text: string;
}

/** Monaco's insert/replace pair, used when the server sends an `InsertReplaceEdit`. */
export interface MonacoCompletionRanges {
    insert: MonacoRange;
    replace: MonacoRange;
}

export interface MonacoCompletionItemLabel {
    label: string;
    detail?: string;
    description?: string;
}

export interface MonacoCompletionItem {
    label: string | MonacoCompletionItemLabel;
    kind: number;
    insertText: string;
    range: MonacoRange | MonacoCompletionRanges;
    insertTextRules?: number;
    detail?: string;
    documentation?: MonacoMarkdownString;
    sortText?: string;
    filterText?: string;
    preselect?: boolean;
    commitCharacters?: string[];
    tags?: number[];
    additionalTextEdits?: MonacoTextEdit[];
}

export interface MonacoCompletionList {
    suggestions: MonacoCompletionItem[];
    incomplete: boolean;
}

export interface MonacoParameterInformation {
    label: string | [number, number];
    documentation?: MonacoMarkdownString;
}

export interface MonacoSignatureInformation {
    label: string;
    documentation?: MonacoMarkdownString;
    parameters: MonacoParameterInformation[];
    activeParameter?: number;
}

export interface MonacoSignatureHelp {
    signatures: MonacoSignatureInformation[];
    activeSignature: number;
    activeParameter: number;
}

/**
 * Monaco's `languages.CompletionItemKind`, mirrored as literals. The two
 * enumerations agree on none of their numbering, so the table below is the
 * whole point of this constant: LSP's `Text` is 1 and Monaco's is 18.
 */
export const MONACO_COMPLETION_KIND = {
    method: 0,
    function: 1,
    constructor: 2,
    field: 3,
    variable: 4,
    class: 5,
    struct: 6,
    interface: 7,
    module: 8,
    property: 9,
    event: 10,
    operator: 11,
    unit: 12,
    value: 13,
    constant: 14,
    enum: 15,
    enumMember: 16,
    keyword: 17,
    text: 18,
    color: 19,
    file: 20,
    reference: 21,
    folder: 23,
    typeParameter: 24,
    snippet: 27,
} as const;

/**
 * LSP `CompletionItemKind` (1-based) to Monaco's. A Map rather than an object
 * literal because the keys are numbers, not identifiers.
 */
const COMPLETION_KIND_BY_LSP = new Map<number, number>([
    [1, MONACO_COMPLETION_KIND.text],
    [2, MONACO_COMPLETION_KIND.method],
    [3, MONACO_COMPLETION_KIND.function],
    [4, MONACO_COMPLETION_KIND.constructor],
    [5, MONACO_COMPLETION_KIND.field],
    [6, MONACO_COMPLETION_KIND.variable],
    [7, MONACO_COMPLETION_KIND.class],
    [8, MONACO_COMPLETION_KIND.interface],
    [9, MONACO_COMPLETION_KIND.module],
    [10, MONACO_COMPLETION_KIND.property],
    [11, MONACO_COMPLETION_KIND.unit],
    [12, MONACO_COMPLETION_KIND.value],
    [13, MONACO_COMPLETION_KIND.enum],
    [14, MONACO_COMPLETION_KIND.keyword],
    [15, MONACO_COMPLETION_KIND.snippet],
    [16, MONACO_COMPLETION_KIND.color],
    [17, MONACO_COMPLETION_KIND.file],
    [18, MONACO_COMPLETION_KIND.reference],
    [19, MONACO_COMPLETION_KIND.folder],
    [20, MONACO_COMPLETION_KIND.enumMember],
    [21, MONACO_COMPLETION_KIND.constant],
    [22, MONACO_COMPLETION_KIND.struct],
    [23, MONACO_COMPLETION_KIND.event],
    [24, MONACO_COMPLETION_KIND.operator],
    [25, MONACO_COMPLETION_KIND.typeParameter],
]);

/** Monaco's `languages.CompletionItemInsertTextRule.InsertAsSnippet`. */
export const MONACO_INSERT_AS_SNIPPET = 4;

/** Monaco's `languages.CompletionItemTag.Deprecated`. */
export const MONACO_COMPLETION_TAG_DEPRECATED = 1;

/** LSP `CompletionItemKind` to Monaco's, defaulting to `text` for anything unknown. */
export function toCompletionKind(kind: unknown): number {
    const mapped = typeof kind === 'number' ? COMPLETION_KIND_BY_LSP.get(kind) : undefined;
    return mapped ?? MONACO_COMPLETION_KIND.text;
}

/**
 * `MarkedString | MarkupContent | (MarkedString | MarkupContent)[]` to one
 * markdown string, or null when there is nothing to show.
 *
 * A `{ language, value }` marked string becomes a fenced code block, which is
 * how a TypeScript server sends the signature line of a hover.
 */
export function toMarkdownString(value: unknown): MonacoMarkdownString | null {
    const parts: string[] = [];
    collectMarkdown(value, parts);
    const text = parts.join('\n\n').trim();
    return text.length === 0 ? null : { value: text };
}

function collectMarkdown(value: unknown, parts: string[]): void {
    if (value === null || value === undefined) {
        return;
    }
    if (typeof value === 'string') {
        if (value.length > 0) {
            parts.push(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectMarkdown(entry, parts);
        }
        return;
    }
    if (typeof value !== 'object') {
        return;
    }
    const record = value as { kind?: unknown; language?: unknown; value?: unknown };
    if (typeof record.value !== 'string' || record.value.length === 0) {
        return;
    }
    if (typeof record.language === 'string') {
        parts.push('```' + record.language + '\n' + record.value + '\n```');
        return;
    }
    if (record.kind === 'plaintext') {
        parts.push(escapeMarkdown(record.value));
        return;
    }
    parts.push(record.value);
}

/**
 * Escapes the characters that would otherwise turn plain text into markup.
 * Monaco has no plaintext mode for hover contents, so text a server declared
 * plain has to be neutralized here or it renders as formatting.
 */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, (character) => '\\' + character);
}

/** `textDocument/hover` result to a Monaco hover, or null when empty. */
export function toHover(result: unknown): MonacoHover | null {
    if (!result || typeof result !== 'object') {
        return null;
    }
    const record = result as { contents?: unknown; range?: unknown };
    const contents = toMarkdownString(record.contents);
    if (!contents) {
        return null;
    }
    const range = asLspRange(record.range);
    return range ? { contents: [contents], range: toMonacoRange(range) } : { contents: [contents] };
}

/**
 * `textDocument/definition` or `textDocument/references` result to location
 * links. Accepts all three shapes the specification allows — a single
 * `Location`, a `Location[]`, and a `LocationLink[]` — and drops entries that
 * carry no usable URI or range instead of failing the whole navigation.
 */
export function toLocationLinks(result: unknown): MonacoLocationLink[] {
    if (!result) {
        return [];
    }
    const entries = Array.isArray(result) ? result : [result];
    const links: MonacoLocationLink[] = [];
    for (const entry of entries) {
        const link = toLocationLink(entry);
        if (link) {
            links.push(link);
        }
    }
    return links;
}

function toLocationLink(entry: unknown): MonacoLocationLink | null {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const record = entry as {
        uri?: unknown;
        range?: unknown;
        targetUri?: unknown;
        targetRange?: unknown;
        targetSelectionRange?: unknown;
        originSelectionRange?: unknown;
    };
    const uri = typeof record.targetUri === 'string' ? record.targetUri
        : typeof record.uri === 'string' ? record.uri
            : null;
    if (!uri) {
        return null;
    }
    // A `LocationLink` reveals `targetRange` but selects `targetSelectionRange`;
    // a plain `Location` has only the one range and uses it for both.
    const target = asLspRange(record.targetRange) ?? asLspRange(record.range);
    if (!target) {
        return null;
    }
    const link: MonacoLocationLink = { uri, range: toMonacoRange(target) };
    const selection = asLspRange(record.targetSelectionRange);
    if (selection) {
        link.targetSelectionRange = toMonacoRange(selection);
    }
    const origin = asLspRange(record.originSelectionRange);
    if (origin) {
        link.originSelectionRange = toMonacoRange(origin);
    }
    return link;
}

/**
 * `textDocument/completion` result to a Monaco completion list.
 *
 * `fallbackRange` is the word range Monaco computed at the cursor. It is used
 * for every item the server did not give an explicit edit for, which is the
 * common case for a TypeScript server answering a plain identifier prefix.
 */
export function toCompletionList(result: unknown, fallbackRange: MonacoRange): MonacoCompletionList {
    if (!result) {
        return { suggestions: [], incomplete: false };
    }
    const isList = !Array.isArray(result) && typeof result === 'object';
    const record = isList ? (result as { items?: unknown; isIncomplete?: unknown }) : null;
    const items = Array.isArray(result) ? result : Array.isArray(record?.items) ? record!.items : [];
    const suggestions: MonacoCompletionItem[] = [];
    for (const item of items) {
        const suggestion = toCompletionItem(item, fallbackRange);
        if (suggestion) {
            suggestions.push(suggestion);
        }
    }
    return { suggestions, incomplete: record?.isIncomplete === true };
}

function toCompletionItem(item: unknown, fallbackRange: MonacoRange): MonacoCompletionItem | null {
    if (!item || typeof item !== 'object') {
        return null;
    }
    const record = item as Record<string, unknown>;
    const label = toCompletionLabel(record.label);
    if (!label) {
        return null;
    }
    const labelText = typeof label === 'string' ? label : label.label;
    const edit = asRecord(record.textEdit);
    const range = toCompletionRange(edit, fallbackRange);
    const insertText = typeof edit?.newText === 'string' ? edit.newText
        : typeof record.insertText === 'string' ? record.insertText
            : labelText;

    const suggestion: MonacoCompletionItem = {
        label,
        kind: toCompletionKind(record.kind),
        insertText,
        range,
    };
    if (record.insertTextFormat === 2) {
        suggestion.insertTextRules = MONACO_INSERT_AS_SNIPPET;
    }
    if (typeof record.detail === 'string') {
        suggestion.detail = record.detail;
    }
    const documentation = toMarkdownString(record.documentation);
    if (documentation) {
        suggestion.documentation = documentation;
    }
    if (typeof record.sortText === 'string') {
        suggestion.sortText = record.sortText;
    }
    if (typeof record.filterText === 'string') {
        suggestion.filterText = record.filterText;
    }
    if (record.preselect === true) {
        suggestion.preselect = true;
    }
    if (Array.isArray(record.commitCharacters)) {
        const characters = record.commitCharacters.filter((entry): entry is string => typeof entry === 'string');
        if (characters.length > 0) {
            suggestion.commitCharacters = characters;
        }
    }
    // `deprecated` is the pre-3.15 spelling and some servers still send it.
    const tags = Array.isArray(record.tags) ? record.tags : [];
    if (tags.includes(1) || record.deprecated === true) {
        suggestion.tags = [MONACO_COMPLETION_TAG_DEPRECATED];
    }
    const additional = toTextEdits(record.additionalTextEdits);
    if (additional.length > 0) {
        suggestion.additionalTextEdits = additional;
    }
    return suggestion;
}

function toCompletionLabel(label: unknown): string | MonacoCompletionItemLabel | null {
    if (typeof label === 'string') {
        return label.length === 0 ? null : label;
    }
    const record = asRecord(label);
    if (!record || typeof record.label !== 'string' || record.label.length === 0) {
        return null;
    }
    const result: MonacoCompletionItemLabel = { label: record.label };
    if (typeof record.detail === 'string') {
        result.detail = record.detail;
    }
    if (typeof record.description === 'string') {
        result.description = record.description;
    }
    return result;
}

function toCompletionRange(
    edit: Record<string, unknown> | null,
    fallbackRange: MonacoRange,
): MonacoRange | MonacoCompletionRanges {
    if (!edit) {
        return fallbackRange;
    }
    const plain = asLspRange(edit.range);
    if (plain) {
        return toMonacoRange(plain);
    }
    const insert = asLspRange(edit.insert);
    const replace = asLspRange(edit.replace);
    if (insert && replace) {
        return { insert: toMonacoRange(insert), replace: toMonacoRange(replace) };
    }
    return fallbackRange;
}

/** `TextEdit[]` to Monaco's edit shape, dropping anything without a range. */
export function toTextEdits(value: unknown): MonacoTextEdit[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const edits: MonacoTextEdit[] = [];
    for (const entry of value) {
        const record = asRecord(entry);
        const range = asLspRange(record?.range);
        if (!record || !range || typeof record.newText !== 'string') {
            continue;
        }
        edits.push({ range: toMonacoRange(range), text: record.newText });
    }
    return edits;
}

/**
 * `textDocument/signatureHelp` result to Monaco's.
 *
 * Both active indices default to zero: Monaco highlights whatever they point
 * at, and a server that omits them means "the first one".
 */
export function toSignatureHelp(result: unknown): MonacoSignatureHelp | null {
    const record = asRecord(result);
    if (!record || !Array.isArray(record.signatures)) {
        return null;
    }
    const signatures: MonacoSignatureInformation[] = [];
    for (const entry of record.signatures) {
        const signature = asRecord(entry);
        if (!signature || typeof signature.label !== 'string') {
            continue;
        }
        const converted: MonacoSignatureInformation = {
            label: signature.label,
            parameters: toParameters(signature.parameters),
        };
        const documentation = toMarkdownString(signature.documentation);
        if (documentation) {
            converted.documentation = documentation;
        }
        if (typeof signature.activeParameter === 'number') {
            converted.activeParameter = signature.activeParameter;
        }
        signatures.push(converted);
    }
    if (signatures.length === 0) {
        return null;
    }
    return {
        signatures,
        activeSignature: typeof record.activeSignature === 'number' ? record.activeSignature : 0,
        activeParameter: typeof record.activeParameter === 'number' ? record.activeParameter : 0,
    };
}

function toParameters(value: unknown): MonacoParameterInformation[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const parameters: MonacoParameterInformation[] = [];
    for (const entry of value) {
        const record = asRecord(entry);
        if (!record) {
            continue;
        }
        const label = toParameterLabel(record.label);
        if (label === null) {
            continue;
        }
        const parameter: MonacoParameterInformation = { label };
        const documentation = toMarkdownString(record.documentation);
        if (documentation) {
            parameter.documentation = documentation;
        }
        parameters.push(parameter);
    }
    return parameters;
}

/**
 * A parameter label is either the substring itself or a pair of offsets into
 * the signature label. The offsets are UTF-16 code-unit offsets in both
 * protocols, so the pair passes through unchanged.
 */
function toParameterLabel(label: unknown): string | [number, number] | null {
    if (typeof label === 'string') {
        return label;
    }
    if (
        Array.isArray(label)
        && label.length === 2
        && typeof label[0] === 'number'
        && typeof label[1] === 'number'
    ) {
        return [label[0], label[1]];
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/** Narrows an untrusted value to an LSP range, or null when it is not one. */
export function asLspRange(value: unknown): LspRange | null {
    const record = asRecord(value);
    const start = asPosition(record?.start);
    const end = asPosition(record?.end);
    return start && end ? { start, end } : null;
}

function asPosition(value: unknown): { line: number; character: number } | null {
    const record = asRecord(value);
    if (!record || typeof record.line !== 'number' || typeof record.character !== 'number') {
        return null;
    }
    return { line: record.line, character: record.character };
}
