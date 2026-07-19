/**
 * shellCommandClassifier — deterministic, display-only classification of a
 * shell command string into a small allow-list of clear activity families
 * (Search / Read / Files / Git).
 *
 * Codex reports every command through one generic tool that CoC stores as the
 * canonical `shell` tool. The raw command is real (`rg`, `sed`, `cat`, `git`,
 * `find`, ...), often wrapped in an interpreter invocation such as
 * `/bin/zsh -lc '...'`. This module reads the command *string only* — it never
 * executes, evaluates, or expands anything — and returns a friendly label plus
 * a concise summary when it can do so with high confidence. Anything ambiguous,
 * mutating, or unrecognized returns `null`, and the caller keeps the existing
 * Shell display.
 *
 * The stored tool identity, raw command, output, status, timing, and errors are
 * untouched; this is purely a presentation hint.
 */

import { shortenFilePath } from '../../../../shared';
import type { ToolKindClass } from './toolKindUtils';

export type ShellSemanticFamily = 'search' | 'read' | 'files' | 'git';

export interface ShellSemanticInfo {
    /** Coarse activity family. */
    family: ShellSemanticFamily;
    /** Title-cased pill label (e.g. "Search", "Read", "Files", "Git"). */
    label: string;
    /** Reused kind-pill color class (green search / blue read / purple git). */
    cls: ToolKindClass;
    /** Compact whisper-row metric noun derived from the result line count. */
    metricKind: 'hits' | 'lines' | 'files';
    /** Concise one-line summary; never empty (falls back to the command text). */
    summary: string;
}

// ---------------------------------------------------------------------------
// Parsing — a conservative, quote-aware POSIX-ish tokenizer/splitter.
// Returns null whenever it meets anything it will not reason about safely.
// ---------------------------------------------------------------------------

/** One simple command as a list of already-unquoted tokens. */
type Stage = string[];
/** A pipeline: stages joined by `|`. */
type ChainSegment = Stage[];

interface ParsedCommandLine {
    /** Top-level chain segments (joined by `&&`, `||`, or `;`). */
    chains: ChainSegment[];
}

type LexItem = { word: string } | { op: '|' | '&&' | '||' | ';' };

/**
 * Lex + split a command line into chains → pipelines → token stages.
 * Returns null on malformed quoting or any construct we refuse to interpret
 * (command substitution, subshells, redirection/heredocs, background `&`).
 */
function parseCommandLine(input: string): ParsedCommandLine | null {
    const items: LexItem[] = [];
    let buf = '';
    let hasWord = false;
    const flush = () => {
        if (hasWord) items.push({ word: buf });
        buf = '';
        hasWord = false;
    };

    let i = 0;
    const n = input.length;
    while (i < n) {
        const ch = input[i];

        // Single quotes: everything literal until the next single quote.
        if (ch === "'") {
            hasWord = true;
            i++;
            let closed = false;
            while (i < n) {
                if (input[i] === "'") { closed = true; i++; break; }
                buf += input[i++];
            }
            if (!closed) return null;
            continue;
        }

        // Double quotes: honor backslash escapes; reject substitutions.
        if (ch === '"') {
            hasWord = true;
            i++;
            let closed = false;
            while (i < n) {
                const c = input[i];
                if (c === '"') { closed = true; i++; break; }
                if (c === '`') return null;
                if (c === '$' && input[i + 1] === '(') return null;
                if (c === '\\') {
                    const nx = input[i + 1];
                    if (nx === '"' || nx === '\\' || nx === '$' || nx === '`') { buf += nx; i += 2; continue; }
                    buf += '\\'; i++; continue;
                }
                buf += c; i++;
            }
            if (!closed) return null;
            continue;
        }

        // Backslash escape outside quotes.
        if (ch === '\\') {
            const nx = input[i + 1];
            if (nx === undefined) return null;
            buf += nx; hasWord = true; i += 2; continue;
        }

        // Whitespace ends a word.
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { flush(); i++; continue; }

        // Pipe / logical-or.
        if (ch === '|') {
            flush();
            if (input[i + 1] === '|') { items.push({ op: '||' }); i += 2; }
            else { items.push({ op: '|' }); i++; }
            continue;
        }

        // Logical-and only; a lone `&` (background / `&>`) is refused.
        if (ch === '&') {
            if (input[i + 1] === '&') { flush(); items.push({ op: '&&' }); i += 2; continue; }
            return null;
        }

        if (ch === ';') { flush(); items.push({ op: ';' }); i++; continue; }

        // Redirection, heredoc, process substitution, subshell, backtick,
        // command substitution — all refused.
        if (ch === '>' || ch === '<') return null;
        if (ch === '(' || ch === ')') return null;
        if (ch === '`') return null;
        if (ch === '$' && input[i + 1] === '(') return null;

        // A `#` at the start of a word begins a comment.
        if (ch === '#' && !hasWord) break;

        buf += ch; hasWord = true; i++;
    }
    flush();
    if (items.length === 0) return null;

    const chains: ChainSegment[] = [];
    let chain: ChainSegment = [];
    let stage: Stage = [];
    for (const it of items) {
        if ('word' in it) { stage.push(it.word); continue; }
        if (stage.length === 0) return null; // empty stage → malformed
        if (it.op === '|') {
            chain.push(stage);
            stage = [];
        } else {
            chain.push(stage);
            stage = [];
            chains.push(chain);
            chain = [];
        }
    }
    if (stage.length === 0) return null; // trailing operator
    chain.push(stage);
    chains.push(chain);
    return { chains };
}

// ---------------------------------------------------------------------------
// Interpreter-wrapper unwrapping (one level only).
// ---------------------------------------------------------------------------

const SHELL_EXECS = new Set(['sh', 'bash', 'zsh', 'dash']);

/** Basename of a possibly path-qualified executable token. */
function basename(token: string): string {
    const slash = token.lastIndexOf('/');
    return slash >= 0 ? token.slice(slash + 1) : token;
}

/**
 * When `tokens` is a single `sh|bash|zsh|dash -c/-lc <script> ...` invocation,
 * returns the inner script string; otherwise null.
 */
function detectWrapperScript(tokens: string[]): string | null {
    if (tokens.length < 2) return null;
    if (!SHELL_EXECS.has(basename(tokens[0]))) return null;
    for (let i = 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) {
            if (/^-[A-Za-z]*c[A-Za-z]*$/.test(t)) {
                return i + 1 < tokens.length ? tokens[i + 1] : null;
            }
            continue; // other leading option (e.g. `-l` before `-c`)
        }
        return null; // a non-flag token before any `-c` → not a wrapper
    }
    return null;
}

// ---------------------------------------------------------------------------
// Family classification of a single simple command.
// ---------------------------------------------------------------------------

function classifyCommand(tokens: Stage): ShellSemanticFamily | null {
    if (tokens.length === 0) return null;
    const exec = basename(tokens[0]);
    const rest = tokens.slice(1);
    switch (exec) {
        case 'grep':
        case 'egrep':
        case 'fgrep':
        case 'ag':
        case 'ack':
        case 'ack-grep':
            return 'search';
        case 'rg':
        case 'ripgrep':
            return rest.some(t => t === '--files' || t.startsWith('--files')) ? 'files' : 'search';
        case 'cat':
        case 'head':
        case 'tail':
        case 'nl':
            return 'read';
        case 'sed':
            return isReadOnlySed(rest) ? 'read' : null;
        case 'ls':
            return 'files';
        case 'fd':
        case 'fdfind':
            return rest.some(t => t === '-x' || t === '--exec' || t === '-X' || t === '--exec-batch')
                ? null
                : 'files';
        case 'find':
            return isSafeFind(rest) ? 'files' : null;
        case 'git':
            return 'git';
        default:
            return null;
    }
}

/** sed is a read only when it prints (`-n`) and never edits in place (`-i`). */
function isReadOnlySed(rest: string[]): boolean {
    const hasInPlace = rest.some(t =>
        t.startsWith('--in-place') ||
        t.startsWith('-i') ||
        (/^-[A-Za-z]+$/.test(t) && t.includes('i')),
    );
    if (hasInPlace) return false;
    return rest.some(t =>
        t === '-n' ||
        (/^-[A-Za-z]+$/.test(t) && t.includes('n')),
    );
}

const UNSAFE_FIND_PREDICATES = new Set([
    '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fprint0', '-fls',
]);

function isSafeFind(rest: string[]): boolean {
    return !rest.some(t => UNSAFE_FIND_PREDICATES.has(t));
}

/** Harmless read-only presentation stages allowed downstream in a pipeline. */
function isPresentationStage(tokens: Stage): boolean {
    if (tokens.length === 0) return false;
    const exec = basename(tokens[0]);
    switch (exec) {
        case 'head':
        case 'tail':
        case 'nl':
        case 'cat':
        case 'sort':
        case 'uniq':
        case 'wc':
            return true;
        case 'sed':
            return isReadOnlySed(tokens.slice(1));
        default:
            return false;
    }
}

// ---------------------------------------------------------------------------
// Summary derivation (best-effort; empty → caller uses the command text).
// ---------------------------------------------------------------------------

function shortenPathSafe(p: string): string {
    try {
        return shortenFilePath(p);
    } catch {
        return p;
    }
}

/** grep/rg flags that consume the following token as a value (both tools). */
const SEARCH_VALUE_FLAGS = new Set([
    '-A', '-B', '-C', '-m', '-d', '-g', '-t', '-T', '-f', '-M',
    '--after-context', '--before-context', '--context', '--max-count', '--max-depth',
    '--glob', '--iglob', '--type', '--type-not', '--color', '--colors', '--file', '--max-columns',
]);

function summarizeSearch(tokens: Stage): string {
    const rest = tokens.slice(1);
    let pattern: string | null = null;
    const paths: string[] = [];
    let i = 0;
    while (i < rest.length) {
        const t = rest[i];
        if (t === '--') {
            i++;
            while (i < rest.length) {
                if (pattern === null) pattern = rest[i];
                else paths.push(rest[i]);
                i++;
            }
            break;
        }
        if (t === '-e' || t === '--regexp') {
            if (i + 1 < rest.length) { if (pattern === null) pattern = rest[i + 1]; i += 2; continue; }
            i++; continue;
        }
        if (t.startsWith('--regexp=')) { if (pattern === null) pattern = t.slice('--regexp='.length); i++; continue; }
        if (t.startsWith('-')) {
            if (SEARCH_VALUE_FLAGS.has(t)) { i += 2; continue; }
            i++; continue;
        }
        if (pattern === null) pattern = t;
        else paths.push(t);
        i++;
    }
    if (pattern === null || pattern === '') return '';
    const scope = paths.length ? ` in ${paths.map(shortenPathSafe).join(', ')}` : '';
    return `${pattern}${scope}`;
}

function summarizeRead(tokens: Stage): string {
    const exec = basename(tokens[0]);
    const rest = tokens.slice(1);
    if (exec === 'sed') return summarizeSedRead(rest);

    const valueFlags = exec === 'head' || exec === 'tail'
        ? new Set(['-n', '--lines', '-c', '--bytes'])
        : new Set<string>();
    const files: string[] = [];
    let i = 0;
    while (i < rest.length) {
        const t = rest[i];
        if (t === '--') { i++; while (i < rest.length) files.push(rest[i++]); break; }
        if (t.startsWith('-')) { if (valueFlags.has(t)) i += 2; else i++; continue; }
        files.push(t); i++;
    }
    if (files.length === 0) return '';
    if (files.length === 1) return shortenPathSafe(files[0]);
    return `${shortenPathSafe(files[0])} +${files.length - 1}`;
}

function summarizeSedRead(rest: string[]): string {
    const positionals: string[] = [];
    let script: string | null = null;
    let i = 0;
    while (i < rest.length) {
        const t = rest[i];
        if (t === '-e') { if (i + 1 < rest.length) { if (script === null) script = rest[i + 1]; i += 2; continue; } i++; continue; }
        if (t.startsWith('-')) { i++; continue; }
        positionals.push(t); i++;
    }
    if (script === null && positionals.length > 0) script = positionals.shift() ?? null;
    const file = positionals.length ? positionals[positionals.length - 1] : '';
    let rangeText = '';
    if (script) {
        const m = script.match(/^(\d+),(\d+)p?$/);
        if (m) rangeText = `lines ${m[1]}–${m[2]}`;
        else {
            const m2 = script.match(/^(\d+)p?$/);
            if (m2) rangeText = `line ${m2[1]}`;
        }
    }
    if (file && rangeText) return `${shortenPathSafe(file)}, ${rangeText}`;
    if (file) return shortenPathSafe(file);
    return '';
}

function summarizeFiles(tokens: Stage): string {
    const exec = basename(tokens[0]);
    const rest = tokens.slice(1);
    if (exec === 'find') return summarizeFind(rest);
    if (exec === 'fd' || exec === 'fdfind') {
        const pos = rest.filter(t => !t.startsWith('-'));
        if (pos.length === 0) return '';
        return pos[1] ? `${pos[0]} in ${shortenPathSafe(pos[1])}` : pos[0];
    }
    // ls or `rg --files`
    const pos = rest.filter(t => !t.startsWith('-') && t !== '--files');
    if (pos.length === 0) return '';
    return pos.map(shortenPathSafe).join(', ');
}

function summarizeFind(rest: string[]): string {
    const paths: string[] = [];
    let i = 0;
    while (i < rest.length && !rest[i].startsWith('-') && rest[i] !== '(') { paths.push(rest[i]); i++; }
    let namePat = '';
    for (let j = 0; j < rest.length - 1; j++) {
        if (rest[j] === '-name' || rest[j] === '-iname' || rest[j] === '-path' || rest[j] === '-wholename') {
            namePat = rest[j + 1];
            break;
        }
    }
    const scope = paths.length ? paths.map(shortenPathSafe).join(', ') : '';
    if (namePat && scope) return `${namePat} in ${scope}`;
    if (namePat) return namePat;
    return scope;
}

/** git global options that consume the following token as a value. */
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

function summarizeGit(tokens: Stage): string {
    const rest = tokens.slice(1);
    let i = 0;
    while (i < rest.length) {
        const t = rest[i];
        if (GIT_VALUE_FLAGS.has(t)) { i += 2; continue; }
        if (t.startsWith('-')) { i++; continue; }
        break;
    }
    if (i >= rest.length) return 'git';
    const sub = rest[i];
    const args = rest.slice(i + 1);
    return args.length ? `${sub} ${args.join(' ')}` : sub;
}

const FAMILY_META: Record<ShellSemanticFamily, { label: string; cls: ToolKindClass; metricKind: 'hits' | 'lines' | 'files' }> = {
    search: { label: 'Search', cls: 'grep', metricKind: 'hits' },
    read: { label: 'Read', cls: 'read', metricKind: 'lines' },
    files: { label: 'Files', cls: 'glob', metricKind: 'files' },
    git: { label: 'Git', cls: 'shell', metricKind: 'lines' },
};

function summarizeCommand(family: ShellSemanticFamily, primary: Stage): string {
    switch (family) {
        case 'search': return summarizeSearch(primary);
        case 'read': return summarizeRead(primary);
        case 'files': return summarizeFiles(primary);
        case 'git': return summarizeGit(primary);
    }
}

const MAX_SUMMARY = 80;
function truncate(value: string, max = MAX_SUMMARY): string {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

/**
 * Classify a shell command string into a semantic family, or null when the
 * command is ambiguous, mutating, mixed, or otherwise not confidently in a
 * single clear family (the caller then keeps the existing Shell display).
 */
export function classifyShellCommand(rawCommand: unknown): ShellSemanticInfo | null {
    if (typeof rawCommand !== 'string') return null;
    const command = rawCommand.trim();
    if (!command) return null;

    const outer = parseCommandLine(command);
    if (!outer) return null;

    let chains = outer.chains;
    let unwrapped = command;

    // Unwrap a single interpreter wrapper for analysis only (one level).
    if (chains.length === 1 && chains[0].length === 1) {
        const script = detectWrapperScript(chains[0][0]);
        if (script !== null) {
            const inner = parseCommandLine(script);
            if (!inner) return null;
            chains = inner.chains;
            unwrapped = script.trim();
        }
    }

    // Every top-level command (and its pipeline) must belong to one family.
    const families: ShellSemanticFamily[] = [];
    for (const stages of chains) {
        const primary = stages[0];
        const family = classifyCommand(primary);
        if (!family) return null;
        for (let s = 1; s < stages.length; s++) {
            if (!isPresentationStage(stages[s])) return null;
        }
        families.push(family);
    }
    const family = families[0];
    if (!families.every(f => f === family)) return null;

    const raw = chains.length === 1 ? summarizeCommand(family, chains[0][0]) : '';
    const summary = raw ? truncate(raw) : truncate(unwrapped);
    const meta = FAMILY_META[family];
    return { family, label: meta.label, cls: meta.cls, metricKind: meta.metricKind, summary };
}
