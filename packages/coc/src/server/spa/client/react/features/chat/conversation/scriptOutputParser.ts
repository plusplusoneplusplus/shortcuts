/**
 * Parser for run-script conversation turn content produced by `formatScriptResponse`
 * (see `packages/coc/src/server/task-strategies/run-script-strategy.ts`).
 *
 * The server formats script results as markdown like:
 *
 *   **Script:** `npm test -- ConversationArea`
 *   **Working directory:** `/abs/path`
 *   **Status:** ✅ Success                          // or `❌ Failed (exit code 1)` / `⏱️ Timed out`
 *   **Duration:** 4812ms
 *
 *   **stdout:**
 *   ```
 *   <captured stdout>
 *   ```
 *
 *   **stderr:**
 *   ```
 *   <captured stderr>
 *   ```
 *
 * This module extracts a structured representation so the SPA can render a
 * dark-terminal style block (matching the conversation redesign) rather than
 * plain markdown.
 */

export type ScriptStatus = 'success' | 'failed' | 'timeout' | 'unknown';

export interface ParsedScriptOutput {
    /** Full shell command, verbatim. */
    script?: string;
    /** Working directory the script ran in, if recorded. */
    workingDirectory?: string;
    /** High-level outcome — derived from the **Status:** line. */
    status: ScriptStatus;
    /**
     * Process exit code (when known). `null` for timed-out runs (matching
     * `ShellExecutionResult.result.exitCode`). `undefined` when the format
     * could not be parsed.
     */
    exitCode?: number | null;
    /** Wall-clock duration in ms. */
    durationMs?: number;
    /** Captured stdout — trailing whitespace preserved as emitted. */
    stdout?: string;
    /** Captured stderr — trailing whitespace preserved as emitted. */
    stderr?: string;
    /**
     * True when the content matches the formatScriptResponse shape (i.e. it
     * starts with a `**Script:**` line). Consumers should fall back to plain
     * markdown rendering when this is false.
     */
    recognised: boolean;
}

const SCRIPT_LINE_RE = /^\*\*Script:\*\*\s+`([^`]*)`\s*$/;
const CWD_LINE_RE = /^\*\*Working directory:\*\*\s+`([^`]*)`\s*$/;
const STATUS_LINE_RE = /^\*\*Status:\*\*\s+(.+?)\s*$/;
const DURATION_LINE_RE = /^\*\*Duration:\*\*\s+(\d+)ms\s*$/;
const FAILED_EXIT_RE = /exit code\s+(-?\d+)/i;
const SECTION_HEADER_RE = /^\*\*(stdout|stderr):\*\*\s*$/;
const FENCE_RE = /^```/;

interface ParseState {
    parsed: ParsedScriptOutput;
    section: 'stdout' | 'stderr' | null;
    inFence: boolean;
    buffer: string[];
}

function flushSection(state: ParseState): void {
    if (!state.section) {
        state.buffer = [];
        return;
    }
    const text = state.buffer.join('\n');
    if (state.section === 'stdout') {
        state.parsed.stdout = text;
    } else if (state.section === 'stderr') {
        state.parsed.stderr = text;
    }
    state.buffer = [];
    state.section = null;
    state.inFence = false;
}

function statusFromLabel(label: string): { status: ScriptStatus; exitCode?: number | null } {
    const trimmed = label.trim();
    if (trimmed.startsWith('✅')) return { status: 'success', exitCode: 0 };
    if (trimmed.startsWith('⏱️') || /timed out/i.test(trimmed)) {
        return { status: 'timeout', exitCode: null };
    }
    if (trimmed.startsWith('❌') || /failed/i.test(trimmed)) {
        const match = FAILED_EXIT_RE.exec(trimmed);
        const exitCode = match ? Number.parseInt(match[1], 10) : undefined;
        return { status: 'failed', exitCode: Number.isFinite(exitCode) ? exitCode : undefined };
    }
    return { status: 'unknown' };
}

/**
 * Parse a `run-script` turn body produced by `formatScriptResponse`.
 *
 * Returns `recognised: false` (with `status: 'unknown'`) when the body does not
 * begin with `**Script:**` so the caller can fall back to plain rendering.
 *
 * The parser is lenient: section ordering may vary, fenced blocks may use any
 * fence info string, and the closing fence may be omitted (everything until
 * the next recognised header is consumed).
 */
export function parseScriptOutput(content: string): ParsedScriptOutput {
    const state: ParseState = {
        parsed: { status: 'unknown', recognised: false },
        section: null,
        inFence: false,
        buffer: [],
    };
    if (!content) return state.parsed;

    const lines = content.replace(/\r\n/g, '\n').split('\n');
    let sawScriptHeader = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (state.section) {
            if (state.inFence) {
                if (FENCE_RE.test(line)) {
                    flushSection(state);
                    continue;
                }
                state.buffer.push(line);
                continue;
            }
            if (FENCE_RE.test(line)) {
                state.inFence = true;
                continue;
            }
            if (line.trim() === '') continue;
            // Treat a structural header as the start of the next region.
            if (
                SECTION_HEADER_RE.test(line)
                || SCRIPT_LINE_RE.test(line)
                || CWD_LINE_RE.test(line)
                || STATUS_LINE_RE.test(line)
                || DURATION_LINE_RE.test(line)
            ) {
                flushSection(state);
                i--;
                continue;
            }
            state.buffer.push(line);
            continue;
        }

        const sectionMatch = SECTION_HEADER_RE.exec(line);
        if (sectionMatch) {
            flushSection(state);
            state.section = sectionMatch[1] as 'stdout' | 'stderr';
            state.inFence = false;
            state.buffer = [];
            continue;
        }

        const scriptMatch = SCRIPT_LINE_RE.exec(line);
        if (scriptMatch) {
            sawScriptHeader = true;
            state.parsed.script = scriptMatch[1];
            continue;
        }

        const cwdMatch = CWD_LINE_RE.exec(line);
        if (cwdMatch) {
            state.parsed.workingDirectory = cwdMatch[1];
            continue;
        }

        const statusMatch = STATUS_LINE_RE.exec(line);
        if (statusMatch) {
            const { status, exitCode } = statusFromLabel(statusMatch[1]);
            state.parsed.status = status;
            if (exitCode !== undefined) state.parsed.exitCode = exitCode;
            continue;
        }

        const durationMatch = DURATION_LINE_RE.exec(line);
        if (durationMatch) {
            state.parsed.durationMs = Number.parseInt(durationMatch[1], 10);
            continue;
        }
    }

    flushSection(state);
    state.parsed.recognised = sawScriptHeader;
    return state.parsed;
}

/**
 * Render the exit code as the design's `exit N` / `timed out` summary suffix
 * shown in the script turn header. Returns `undefined` when there is nothing
 * worth showing.
 */
export function describeScriptExit(parsed: ParsedScriptOutput): string | undefined {
    if (parsed.status === 'timeout') return 'timed out';
    if (parsed.status === 'success') return 'exit 0';
    if (parsed.status === 'failed') {
        return parsed.exitCode != null ? `exit ${parsed.exitCode}` : 'failed';
    }
    if (parsed.exitCode != null) return `exit ${parsed.exitCode}`;
    return undefined;
}
