import yaml from 'js-yaml';

export interface ParsedNoteFrontMatter {
    raw: string;
    body: string;
    data: Record<string, unknown>;
}

export type NoteFrontMatterParseResult =
    | { kind: 'none' }
    | { kind: 'valid'; frontMatter: ParsedNoteFrontMatter }
    | { kind: 'invalid'; message: string };

const delimiterLine = /^(---|\.\.\.)[ \t]*(\r\n|\n|\r|$)/gm;
const openingDelimiter = /^\uFEFF?---[ \t]*(\r\n|\n|\r)/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && !(value instanceof Date);
}

function normalizeYamlValue(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined) return {};
    return isPlainRecord(value) ? value : { value };
}

function trimLeadingBodyBreaks(body: string): string {
    return body.replace(/^(?:\r\n|\n|\r)+/, '');
}

export function parseNoteFrontMatter(markdown: string): NoteFrontMatterParseResult {
    const opening = openingDelimiter.exec(markdown);
    if (!opening) return { kind: 'none' };

    delimiterLine.lastIndex = opening[0].length;
    const closing = delimiterLine.exec(markdown);
    if (!closing) return { kind: 'none' };

    const closingLineEnding = closing[2] ?? '';
    const rawEnd = closing.index + closing[0].length - closingLineEnding.length;
    const yamlText = markdown.slice(opening[0].length, closing.index);

    try {
        const parsed = yaml.load(yamlText);
        return {
            kind: 'valid',
            frontMatter: {
                raw: markdown.slice(0, rawEnd),
                body: trimLeadingBodyBreaks(markdown.slice(closing.index + closing[0].length)),
                data: normalizeYamlValue(parsed),
            },
        };
    } catch (error) {
        return {
            kind: 'invalid',
            message: error instanceof Error && error.message
                ? error.message
                : 'Metadata could not be parsed.',
        };
    }
}

export function composeMarkdownWithFrontMatter(frontMatter: ParsedNoteFrontMatter, bodyMarkdown: string): string {
    const body = bodyMarkdown.replace(/^(?:\r\n|\n|\r)+/, '');
    if (body.trim() === '') {
        return `${frontMatter.raw}\n`;
    }
    return `${frontMatter.raw}\n\n${body}`;
}

export function getFrontMatterFieldCount(frontMatter: ParsedNoteFrontMatter): number {
    return Object.keys(frontMatter.data).length;
}
