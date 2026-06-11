import type { ClientConversationTurn, ClientToolCall } from '../types/dashboard';
import { getApplyPatchText, parseApplyPatchFileChanges } from './applyPatchParser';
import { FILE_WRITE_TOOLS } from './fileWriteTools';

/** File extensions considered "plan/doc" files worth pinning */
export const PINNED_EXTENSIONS = ['.md', '.txt', '.yaml', '.yml', '.json'];

/** Regex to extract file path from tool-complete result prose. */
const CREATED_FILE_RE = /Created file (.+\.\w+)/;

/** Regex to extract file paths from apply_patch result: "Added N file(s): path1, path2" */
const ADDED_FILES_RE = /Added \d+ file\(s\): (.+)/;

/** Regex to extract file paths from Codex apply_patch result lines: "add: path" */
const ADD_FILE_RE = /^add:\s*(.+)$/gm;

/** Shell tool names whose command args may contain file moves. */
const SHELL_MOVE_TOOLS = new Set(['shell', 'bash']);

export interface CreatedFileRecord {
    filePath: string;
    toolCall: ClientToolCall;
    turnIndex: number;
}

/** Resolve the effective tool name, falling back to the raw `name` field on persisted entries. */
function resolveToolName(tc: ClientToolCall): string {
    return tc.toolName || (tc as any).name || '';
}

/**
 * Build a map from toolCallId → args using tool-start timeline entries.
 * tool-start events carry the full parameters while tool-complete may not.
 */
function buildToolStartArgsMap(
    timeline: ClientConversationTurn['timeline']
): Map<string, Record<string, any>> {
    const map = new Map<string, Record<string, any>>();
    for (const item of timeline ?? []) {
        if (item.type === 'tool-start' && item.toolCall) {
            const args = typeof item.toolCall.args === 'object' ? item.toolCall.args ?? {} : {};
            if (item.toolCall.id && Object.keys(args).length > 0) {
                map.set(item.toolCall.id, args);
            }
        }
    }
    return map;
}

/**
 * Build a map from toolCallId → raw string args from tool-start entries.
 * Used for tools like apply_patch where args is a string (patch text).
 */
function buildToolStartStringArgsMap(
    timeline: ClientConversationTurn['timeline']
): Map<string, string> {
    const map = new Map<string, string>();
    for (const item of timeline ?? []) {
        if (item.type === 'tool-start' && item.toolCall) {
            const patchText = getApplyPatchText(item.toolCall.args);
            if (patchText && item.toolCall.id) {
                map.set(item.toolCall.id, patchText);
            }
        }
    }
    return map;
}

/** Try to extract a file path from tool-complete result text. */
function parseFilePathFromResult(result: string | undefined): string {
    if (!result) return '';
    const match = CREATED_FILE_RE.exec(result);
    return match?.[1] ?? '';
}

function getCommandText(args: unknown): string {
    if (!args || typeof args !== 'object') return '';
    const record = args as Record<string, unknown>;
    const value = record.command ?? record.cmd;
    return typeof value === 'string' ? value : '';
}

function splitShellCommands(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\' && quote !== "'") {
            current += ch;
            escaped = true;
            continue;
        }
        if ((ch === '"' || ch === "'") && !quote) {
            quote = ch;
            current += ch;
            continue;
        }
        if (quote === ch) {
            quote = null;
            current += ch;
            continue;
        }
        if (!quote && (ch === '\n' || ch === ';' || (ch === '&' && command[i + 1] === '&'))) {
            const trimmed = current.trim();
            if (trimmed) parts.push(trimmed);
            current = '';
            if (ch === '&') i++;
            continue;
        }
        current += ch;
    }

    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    return parts;
}

function parseShellWords(command: string): string[] {
    const words: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\' && quote !== "'") {
            escaped = true;
            continue;
        }
        if ((ch === '"' || ch === "'") && !quote) {
            quote = ch;
            continue;
        }
        if (quote === ch) {
            quote = null;
            continue;
        }
        if (!quote && /\s/.test(ch)) {
            if (current) {
                words.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }

    if (current) words.push(current);
    return words;
}

function extractMovedFilePathsFromCommand(command: string, depth = 0): string[] {
    if (!command || depth > 2) return [];
    const paths: string[] = [];

    for (const part of splitShellCommands(command)) {
        const words = parseShellWords(part);
        if (words.length === 0) continue;

        const executable = words[0].replace(/\\/g, '/').split('/').pop() ?? words[0];
        if ((executable === 'bash' || executable === 'sh') && words.length >= 3) {
            const commandIndex = words.findIndex(word => word === '-c' || word === '-lc');
            if (commandIndex >= 0 && words[commandIndex + 1]) {
                paths.push(...extractMovedFilePathsFromCommand(words[commandIndex + 1], depth + 1));
            }
            continue;
        }

        if (executable !== 'mv' && executable !== 'move') continue;
        const operands = words.slice(1).filter(word => word === '--' || !word.startsWith('-'));
        const dashDashIndex = operands.indexOf('--');
        const fileOperands = dashDashIndex >= 0 ? operands.slice(dashDashIndex + 1) : operands;
        if (fileOperands.length < 2) continue;
        paths.push(fileOperands[fileOperands.length - 1]);
    }

    return paths;
}

function extractApplyPatchResultPaths(result: string): string[] {
    const paths: string[] = [];
    const addedMatch = ADDED_FILES_RE.exec(result);
    if (addedMatch) {
        paths.push(...addedMatch[1].split(',').map(p => p.trim()).filter(Boolean));
    }
    for (const match of result.matchAll(ADD_FILE_RE)) {
        const path = match[1].trim();
        if (path) paths.push(path);
    }
    return paths;
}

/** Extract created file paths from an apply_patch tool call. */
function extractApplyPatchPaths(
    tc: ClientToolCall,
    toolStartStringArgs: Map<string, string>
): string[] {
    const paths: string[] = [];
    const localSeen = new Set<string>();

    // 1. Parse result text from either apply_patch implementation.
    if (tc.result) {
        for (const p of extractApplyPatchResultPaths(tc.result)) {
            const trimmed = p.trim();
            if (trimmed && !localSeen.has(trimmed)) {
                localSeen.add(trimmed);
                paths.push(trimmed);
            }
        }
    }

    // 2. Parse tool-start args when tool-complete args no longer include the patch text.
    const stringArgs = getApplyPatchText(tc.args)
        || (tc.id ? toolStartStringArgs.get(tc.id) : '')
        || '';
    if (stringArgs) {
        for (const change of parseApplyPatchFileChanges(stringArgs)) {
            if (!change.isCreate) continue;
            const trimmed = change.path.trim();
            if (trimmed && !localSeen.has(trimmed)) {
                localSeen.add(trimmed);
                paths.push(trimmed);
            }
        }
    }

    return paths;
}

/**
 * Scan all turns for completed create/write_file/create_file/apply_patch tool calls.
 * Uses turn.timeline (has status) with fallback to turn.toolCalls
 * for historical turns loaded without timeline data.
 *
 * Handles three data-shape variations:
 * 1. Normal: toolName + args.path present on tool-complete
 * 2. Persisted: name (not toolName) field, args may be empty
 * 3. Live SSE: toolName='unknown', args={} — resolved via tool-start or result parsing
 * 4. apply_patch: string args with "*** Add File:" lines, result "Added N file(s): ..."
 */
export function scanTurnsForCreatedFiles(
    turns: ClientConversationTurn[]
): CreatedFileRecord[] {
    const seen = new Set<string>();
    const results: CreatedFileRecord[] = [];

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const toolCalls: ClientToolCall[] = [];

        // Build args lookup from tool-start entries (carries full parameters)
        const toolStartArgs = buildToolStartArgsMap(turn.timeline);
        const toolStartStringArgs = buildToolStartStringArgsMap(turn.timeline);

        // Also build a toolName lookup from tool-start entries
        const toolStartNames = new Map<string, string>();
        for (const item of turn.timeline ?? []) {
            if (item.type === 'tool-start' && item.toolCall) {
                const name = resolveToolName(item.toolCall);
                if (item.toolCall.id && name) {
                    toolStartNames.set(item.toolCall.id, name);
                }
            }
        }

        // Primary: timeline events (live + recent history)
        for (const item of turn.timeline ?? []) {
            if (item.type === 'tool-complete' && item.toolCall) {
                toolCalls.push(item.toolCall);
            }
        }
        // Fallback: flat toolCalls array (older history format)
        if (toolCalls.length === 0 && turn.toolCalls?.length) {
            toolCalls.push(...turn.toolCalls);
        }

        for (const tc of toolCalls) {
            // Resolve tool name: tc.toolName > tc.name > matching tool-start name
            const effectiveName = resolveToolName(tc) !== 'unknown'
                ? resolveToolName(tc)
                : (tc.id && toolStartNames.get(tc.id)) || resolveToolName(tc);

            if (SHELL_MOVE_TOOLS.has(effectiveName)) {
                const args = typeof tc.args === 'object' ? tc.args ?? {} : {};
                const command = getCommandText(args)
                    || (tc.id ? getCommandText(toolStartArgs.get(tc.id)) : '');
                const filePaths = extractMovedFilePathsFromCommand(command);
                for (const filePath of filePaths) {
                    if (seen.has(filePath)) continue;
                    const ext = filePath.slice(filePath.lastIndexOf('.'));
                    if (!PINNED_EXTENSIONS.includes(ext)) continue;
                    seen.add(filePath);
                    results.push({ filePath, toolCall: tc, turnIndex: i });
                }
                continue;
            }

            if (!FILE_WRITE_TOOLS.has(effectiveName)) continue;

            // Special handling for apply_patch: may create multiple files
            if (effectiveName === 'apply_patch') {
                const filePaths = extractApplyPatchPaths(tc, toolStartStringArgs);
                for (const filePath of filePaths) {
                    if (seen.has(filePath)) continue;
                    const ext = filePath.slice(filePath.lastIndexOf('.'));
                    if (!PINNED_EXTENSIONS.includes(ext)) continue;
                    seen.add(filePath);
                    results.push({ filePath, toolCall: tc, turnIndex: i });
                }
                continue;
            }

            // Resolve args: tc.args > tool-start args (by toolCallId)
            let args = typeof tc.args === 'object' ? tc.args ?? {} : {};
            const hasPath = args.path || args.filePath;
            if (!hasPath && tc.id && toolStartArgs.has(tc.id)) {
                args = toolStartArgs.get(tc.id)!;
            }

            let filePath: string = args.path || args.filePath || '';

            // Last resort: parse file path from result text
            if (!filePath && tc.result) {
                filePath = parseFilePathFromResult(tc.result);
            }

            if (!filePath || seen.has(filePath)) continue;

            const ext = filePath.slice(filePath.lastIndexOf('.'));
            if (!PINNED_EXTENSIONS.includes(ext)) continue;

            seen.add(filePath);
            results.push({ filePath, toolCall: tc, turnIndex: i });
        }
    }

    return results;
}
