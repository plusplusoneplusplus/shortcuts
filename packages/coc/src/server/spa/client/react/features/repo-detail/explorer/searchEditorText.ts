/**
 * searchEditorText — renders a content-search result set as one plain-text
 * buffer, VS Code's `search-editor` shape minus its re-run affordances (§2.7's
 * "Open in Editor").
 *
 * Pure and DOM-free on purpose: the buffer is the whole feature, so it is worth
 * testing directly rather than through a rendered pane.
 *
 * The shape is a header of `#` comment lines (query, flags, globs, summary),
 * then one block per file: `path:` followed by right-aligned `line  text` rows.
 * Leading indentation of the source line is kept — this is a text buffer, and
 * the indentation is part of what the reader is looking at.
 */

import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';
import { groupMatchesByFile } from './ContentSearchResults';
import { parseGlobList, type ContentSearchFilters, type ContentSearchModes } from './types';

export interface SearchEditorInput {
    /** The query as searched — already trimmed by the panel. */
    query: string;
    modes: ContentSearchModes;
    filters: ContentSearchFilters;
    /**
     * The matches to render. The panel hands over the dismissal-filtered set:
     * Open in Editor is an export of the view, so a row the user dismissed has
     * no business reappearing in it.
     */
    matches: readonly ExplorerContentMatch[];
    /** True when the search hit the engine's caps — said so in the header. */
    truncated: boolean;
}

/** The flag names VS Code writes into a search editor's header, in its order. */
function flagNames(modes: ContentSearchModes): string[] {
    const flags: string[] = [];
    if (modes.regex) flags.push('RegExp');
    if (modes.caseSensitive) flags.push('CaseSensitive');
    if (modes.wholeWord) flags.push('WordMatch');
    return flags;
}

/** `# Query: …` and friends — only the lines that say something. */
function headerLines(input: SearchEditorInput, matchCount: number, fileCount: number): string[] {
    const lines = [`# Query: ${input.query}`];

    const flags = flagNames(input.modes);
    if (flags.length > 0) lines.push(`# Flags: ${flags.join(' ')}`);

    const include = parseGlobList(input.filters.include);
    if (include) lines.push(`# Including: ${include.join(', ')}`);
    const exclude = parseGlobList(input.filters.exclude);
    if (exclude) lines.push(`# Excluding: ${exclude.join(', ')}`);
    // Only worth a line when it is off — honouring ignore files is the default
    // and saying so on every export would be noise.
    if (!input.filters.useIgnoreFiles) lines.push('# Ignore files: off');

    lines.push(
        `# ${matchCount} ${matchCount === 1 ? 'result' : 'results'}`
        + ` in ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`,
    );
    if (input.truncated) lines.push('# Results truncated — showing the first 500 matches.');
    return lines;
}

/**
 * Build the buffer text. Always returns a header, even with no matches, so an
 * empty export still records what was searched.
 */
export function buildSearchEditorText(input: SearchEditorInput): string {
    const groups = groupMatchesByFile(input.matches);
    const lines = headerLines(input, input.matches.length, groups.length);

    for (const group of groups) {
        lines.push('', `${group.path}:`);
        // Right-align within the file, so the text column stays straight in a
        // block whose line numbers span 7 and 1204.
        const width = Math.max(...group.matches.map(entry => String(entry.line).length));
        for (const entry of group.matches) {
            lines.push(`  ${String(entry.line).padStart(width, ' ')}  ${entry.text.replace(/\s+$/, '')}`);
        }
    }

    return `${lines.join('\n')}\n`;
}
