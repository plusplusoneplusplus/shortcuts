/**
 * The engine behind `POST /api/repos/:repoId/search/replace`.
 *
 * Everything here is pure: it takes a file's text plus the lines the client
 * says it matched, and returns the rewritten text or a reason to skip the file.
 * The filesystem half lives in `RepoTreeService.replaceContent`.
 *
 * The contract with the client is deliberately narrow. A replace never
 * re-searches the repo: the client sends back exactly the matches it is looking
 * at — path, line, the line's text *at search time*, and the matched span — and
 * only those spans are rewritten. That is what makes "nothing outside the
 * current result set is ever written" true by construction, and it also gives
 * the staleness check for free: if the line on disk no longer reads the way it
 * did when the search ran, the file changed underneath us and is skipped.
 */

/** One matched span the client wants rewritten, as it looked when the search ran. */
export interface ContentReplaceTarget {
    /** One-based line number. */
    line: number;
    /** The line's full text at search time, without its line terminator. */
    text: string;
    /** UTF-16 offset of the match within `text`. */
    startColumn: number;
    /** UTF-16 offset one past the end of the match within `text`. */
    endColumn: number;
}

/** Every span to rewrite in one file. */
export interface ContentReplaceFile {
    /** Repo-relative path with `/` separators. */
    path: string;
    /** The spans to rewrite. Order does not matter. */
    targets: ContentReplaceTarget[];
}

/** Query modes for a replace — the same knobs the search that produced it used. */
export interface ContentReplaceOptions {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    /** Carry the matched text's casing over to the replacement. Default false. */
    preserveCase?: boolean;
}

/** Why one file was left alone. */
export type ContentReplaceSkipReason = 'stale' | 'missing' | 'unreadable';

export interface ContentReplaceSkip {
    path: string;
    reason: ContentReplaceSkipReason;
    /** Human-readable detail, safe to show in the UI. */
    message: string;
}

export interface ContentReplaceResult {
    /** How many matched spans were rewritten. */
    replacedMatches: number;
    /** How many files were written. */
    replacedFiles: number;
    /** Files that were not written, and why. Never silently empty. */
    skipped: ContentReplaceSkip[];
}

/** An error the route turns into a 400 rather than a 500. */
export function invalidArg(message: string): Error {
    return Object.assign(new Error(message), { code: 'InvalidArg' });
}

function escapeLiteral(query: string): string {
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the matcher a replace uses to re-find its spans on disk.
 *
 * Mirrors the searcher's own semantics: literal unless `regex`, `\b` fences
 * under `wholeWord`, case-insensitive unless `caseSensitive`. Always global,
 * because a line can hold several matches.
 *
 * @throws InvalidArg for an empty query, a multi-line query (see
 *   {@link applyReplacements}) or a pattern the regex engine rejects.
 */
export function buildReplaceMatcher(query: string, options: ContentReplaceOptions = {}): RegExp {
    if (!query) {
        throw invalidArg('Missing required field: query');
    }
    if (/[\r\n]/.test(query)) {
        throw invalidArg('Replace does not support multi-line queries');
    }
    const body = options.regex ? query : escapeLiteral(query);
    const pattern = options.wholeWord ? `\\b(?:${body})\\b` : body;
    const flags = options.caseSensitive ? 'g' : 'gi';
    try {
        return new RegExp(pattern, flags);
    } catch (err) {
        throw invalidArg(`Invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * VS Code's "preserve case": carry the *matched* text's casing over to the
 * replacement, so replacing `foo` with `bar` turns `FOO` into `BAR` and `Foo`
 * into `Bar`. Anything mixed is left exactly as the user typed it — guessing
 * at camelCase would corrupt more than it fixed.
 */
export function applyPreserveCase(matched: string, replacement: string): string {
    if (!matched || !replacement) return replacement;
    const hasLetters = /[a-z]/i.test(matched);
    if (!hasLetters) return replacement;
    if (matched === matched.toUpperCase() && matched !== matched.toLowerCase()) {
        return replacement.toUpperCase();
    }
    if (matched === matched.toLowerCase()) {
        return replacement.toLowerCase();
    }
    if (matched[0] === matched[0].toUpperCase() && matched.slice(1) === matched.slice(1).toLowerCase()) {
        return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
    }
    return replacement;
}

/**
 * Expand `$1`-style backreferences against one regex match.
 *
 * Only in regex mode — in literal mode a `$` is a dollar sign, which is what a
 * user typing `$5.00` into the replace box means. `$&` is the whole match and
 * `$$` is a literal `$`; an unknown group number is left as written, as it is
 * in JavaScript's own `String.replace`.
 */
export function expandReplacement(replacement: string, match: RegExpExecArray, regex: boolean): string {
    if (!regex) return replacement;
    return replacement.replace(/\$(\$|&|\d{1,2})/g, (whole, token: string) => {
        if (token === '$') return '$';
        if (token === '&') return match[0];
        const index = Number(token);
        const value = match[index];
        return value === undefined ? whole : value;
    });
}

/** Split text into lines while remembering each line's terminator. */
function splitLines(content: string): { text: string; eol: string }[] {
    const parts = content.split('\n');
    return parts.map((part, index) => {
        const last = index === parts.length - 1;
        const hasCr = part.endsWith('\r');
        return {
            text: hasCr ? part.slice(0, -1) : part,
            eol: last ? '' : hasCr ? '\r\n' : '\n',
        };
    });
}

export type ApplyReplacementsOutcome =
    | { ok: true; content: string; replaced: number }
    | { ok: false; reason: ContentReplaceSkipReason; message: string };

/**
 * Rewrite every target span in `content`.
 *
 * The file is left untouched — the outcome is `ok: false` — as soon as any one
 * target no longer describes what is on disk: a line number past the end, a
 * line whose text has changed, or a span that no longer matches the query at
 * that exact column. All-or-nothing per file is the only safe reading of
 * "skipped and reported, not silently overwritten": a half-applied replace
 * would be a corruption the user never asked for and cannot see.
 *
 * Targets on one line are applied right-to-left so the columns of the ones
 * still to come stay valid.
 */
export function applyReplacements(
    content: string,
    targets: readonly ContentReplaceTarget[],
    matcher: RegExp,
    replacement: string,
    options: ContentReplaceOptions = {},
): ApplyReplacementsOutcome {
    const lines = splitLines(content);
    const byLine = new Map<number, ContentReplaceTarget[]>();
    for (const target of targets) {
        const bucket = byLine.get(target.line);
        if (bucket) bucket.push(target);
        else byLine.set(target.line, [target]);
    }

    let replaced = 0;
    for (const [lineNumber, lineTargets] of byLine) {
        const row = lines[lineNumber - 1];
        if (!row) {
            return { ok: false, reason: 'stale', message: `Line ${lineNumber} no longer exists` };
        }
        if (row.text !== lineTargets[0].text) {
            return { ok: false, reason: 'stale', message: `Line ${lineNumber} changed on disk` };
        }

        let text = row.text;
        const ordered = [...lineTargets].sort((a, b) => b.startColumn - a.startColumn);
        for (const target of ordered) {
            matcher.lastIndex = 0;
            let found: RegExpExecArray | undefined;
            let hit: RegExpExecArray | null;
            while ((hit = matcher.exec(row.text)) !== null) {
                if (hit.index === target.startColumn && hit.index + hit[0].length === target.endColumn) {
                    found = hit;
                    break;
                }
                // A zero-width match would spin forever otherwise.
                if (hit.index === matcher.lastIndex) matcher.lastIndex++;
            }
            if (!found) {
                return {
                    ok: false,
                    reason: 'stale',
                    message: `Match at line ${lineNumber}, column ${target.startColumn} no longer matches`,
                };
            }
            const expanded = expandReplacement(replacement, found, options.regex ?? false);
            const cased = options.preserveCase ? applyPreserveCase(found[0], expanded) : expanded;
            text = text.slice(0, target.startColumn) + cased + text.slice(target.endColumn);
            replaced++;
        }
        lines[lineNumber - 1] = { text, eol: row.eol };
    }

    return { ok: true, content: lines.map(line => line.text + line.eol).join(''), replaced };
}
