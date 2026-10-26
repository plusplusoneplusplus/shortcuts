import { defineTool, type Tool, type ToolResultObject } from '@plusplusoneplusplus/coc-agent-sdk';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRepoDataPath } from '../paths';
import { getServerLogger } from '../logging/server-logger';
import {
    BROWSER_TOOL_DESCRIPTION, BROWSER_TOOL_PARAMETERS, parseBrowserCommand,
    type BrowserCommand, type BrowserCommandResult, type BrowserControlElement, type BrowserControlFrame, type BrowserControlRuntime,
} from '@plusplusoneplusplus/coc-client';

export { BROWSER_TOOL_DESCRIPTION, BROWSER_SCHEMA_CHAR_BUDGET } from '@plusplusoneplusplus/coc-client';
export const BROWSER_SNAPSHOT_CAP = 6000;
export const BROWSER_READ_CAP = 8000;
export const BROWSER_EVAL_CAP = 4000;
export const BROWSER_DELTA_LINES = 40;

interface BrowserToolState {
    selectedTab?: string;
    snapshots: Map<string, { scope: string; elements: Map<string, string> }>;
    tail: Promise<void>;
    deleted?: boolean;
}

/** Plain owner-qualified conversation data, shared across turns, never provider sessions. */
export class BrowserToolStateStore {
    private readonly states = new Map<string, BrowserToolState>();
    private screenshotSequence = 0;

    constructor(private readonly dataDir: string) {}

    screenshotDir(workspaceId: string, processId: string): string {
        if (!processId || processId === '.' || processId === '..' || /[/\\]/.test(processId)) {
            throw new Error('Invalid browser screenshot process ID');
        }
        return path.resolve(getRepoDataPath(this.dataDir, workspaceId, 'browser-screenshots'), processId);
    }

    saveScreenshot(workspaceId: string, processId: string, image: NonNullable<BrowserCommandResult['image']>): string {
        const dir = this.screenshotDir(workspaceId, processId);
        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
        let file: string;
        do {
            file = path.join(dir, `${timestamp}-${++this.screenshotSequence}.${extension}`);
        } while (fs.existsSync(file));
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(temp, Buffer.from(image.data, 'base64'), { flag: 'wx' });
            fs.renameSync(temp, file);
        } catch (error) {
            throw new Error(`Failed to save browser screenshot: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            try {
                fs.rmSync(temp, { force: true });
            } catch (error) {
                getServerLogger().warn({ err: error }, 'Failed to remove browser screenshot temporary file');
            }
        }
        return file;
    }

    run<T>(workspaceId: string, processId: string, operation: (state: BrowserToolState) => Promise<T>): Promise<T> {
        const key = JSON.stringify([workspaceId, processId]);
        let state = this.states.get(key);
        if (!state) {
            state = { snapshots: new Map(), tail: Promise.resolve() };
            this.states.set(key, state);
        }
        const current = state;
        const result = current.tail.then(() => operation(current));
        current.tail = result.then(() => {}, () => {});
        return result;
    }

    acceptHandoff(workspaceId: string, processId: string, result: BrowserCommandResult): void {
        const state = this.states.get(JSON.stringify([workspaceId, processId]));
        if (!state || state.deleted) return;
        if (result.tab) state.selectedTab = result.tab;
        state.snapshots.clear();
    }

    delete(workspaceId: string, processId: string): void {
        const key = JSON.stringify([workspaceId, processId]);
        const state = this.states.get(key);
        if (state) state.deleted = true;
        this.states.delete(key);
        try {
            fs.rmSync(this.screenshotDir(workspaceId, processId), { recursive: true, force: true });
        } catch (error) {
            getServerLogger().warn({ err: error, workspaceId, processId }, 'Failed to remove browser screenshots');
        }
    }
}

export interface BrowserToolDeps {
    workspaceId: string;
    processId: string;
    runtime: BrowserControlRuntime;
    stateStore: BrowserToolStateStore;
    signal?: AbortSignal;
}

const clean = (text: string) => text.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
const bounded = (text: string, cap: number, hint: string) => text.length <= cap ? text : text.slice(0, cap - hint.length) + hint;
const line = (element: BrowserControlElement) =>
    `${element.ref} ${element.role} ${JSON.stringify(clean(element.name))}${element.checked === undefined ? '' : element.checked ? ' [checked]' : ' [unchecked]'}`;

export function formatBrowserSnapshot(elements: BrowserControlElement[], all = false): string {
    const lines: string[] = [];
    let length = 0;
    for (const element of elements) {
        const text = `${all ? '  '.repeat(Math.min(element.depth, 8)) : ''}${line(element)}`;
        const hint = `\ntruncated - snapshot ref=${element.ref} to expand`;
        if (length + text.length + (lines.length ? 1 : 0) + hint.length > BROWSER_SNAPSHOT_CAP) {
            return [...lines, text].join('\n').slice(0, BROWSER_SNAPSHOT_CAP - hint.length) + hint;
        }
        lines.push(text);
        length += text.length + (lines.length > 1 ? 1 : 0);
    }
    return lines.join('\n') || '(no matching elements)';
}

function elementMap(elements: BrowserControlElement[]): Map<string, string> {
    return new Map(elements.map(element => [element.ref, `${element.frame ? `[frame ${clean(element.frame)}] ` : ''}${line(element)}`]));
}

const frameLabel = (value: string, cap: number) => JSON.stringify(clean(value).slice(0, cap));
const frameHeader = (frame: BrowserControlFrame) =>
    `[frame ${clean(frame.id)} | ${frame.parent ? `name ${frameLabel(frame.name, 160)}` : 'main'} | origin ${frameLabel(frame.origin, 256)} | ${frame.status} | document ${clean(frame.document)}]`;
const frameScope = (result: BrowserCommandResult) => result.frame && result.document
    ? `[frame ${clean(result.frame)} | document ${clean(result.document)}]` : '';
const frameWarning = (result: BrowserCommandResult) => result.truncated
    ? `[truncated: ${clean(result.truncated).slice(0, 256)}]` : '';

export function formatBrowserFrameSnapshot(result: BrowserCommandResult, all = false): string {
    const frames = result.frames ?? [];
    const output: string[] = [];
    const closing: string[] = [];
    const visited = new Set<string>();
    let size = 0;
    let stopped = false;
    const hint = '[truncated: output-limit; use frames/read with an available handle]';
    const warning = frameWarning(result);
    const add = (text: string): boolean => {
        if (size + text.length + 1 + closing.reduce((total, end) => total + end.length + 1, 0)
            + hint.length + warning.length + 2 > BROWSER_SNAPSHOT_CAP) { stopped = true; return false; }
        output.push(text);
        size += text.length + 1;
        return true;
    };
    const visit = (frame: BrowserControlFrame) => {
        if (visited.has(frame.id) || stopped) return;
        visited.add(frame.id);
        const indent = '  '.repeat(Math.min(frame.depth, 8));
        const end = `${indent}[/frame ${clean(frame.id)}]`;
        closing.push(end);
        if (!add(`${indent}${frameHeader(frame)}`)) { closing.pop(); return; }
        for (const element of result.elements ?? []) if (element.frame === frame.id) {
            if (!add(`${indent}${all ? '  '.repeat(Math.min(element.depth, 8)) : ''}${line(element)}`)) break;
        }
        if (!result.elements?.length && !frame.parent && frame.status === 'ready') add('(no matching content in inspected frames)');
        for (const child of frames) if (child.parent === frame.id) visit(child);
        if (stopped && !output.includes(hint)) { output.push(hint); size += hint.length + 1; }
        output.push(closing.pop()!);
        size += end.length + 1;
    };
    for (const frame of frames) if (!frame.parent || !frames.some(parent => parent.id === frame.parent)) visit(frame);
    if (warning) output.push(warning);
    return output.join('\n') || '(no matching content in inspected frames)';
}

function snapshotScope(tab: string, result: BrowserCommandResult): string {
    if (!result.document && !result.frame && !result.frames) return tab;
    return JSON.stringify([tab, result.document, result.frame, result.frames?.map(frame => [frame.id, frame.document])]);
}

function formatFrameRead(command: BrowserCommand, result: BrowserCommandResult): string {
    const scope = frameScope(result);
    const close = `[/frame ${clean(result.frame!)}]`;
    const offset = command.offset ?? 0;
    const target = command.ref ? ` ref=${command.ref}` : command.frame ? ` frame=${command.frame}` : '';
    const warning = frameWarning(result);
    const contentCap = BROWSER_READ_CAP - scope.length - close.length - warning.length - target.length - 160;
    const page = boundedFrameText(result.text!, contentCap);
    const hint = warning || (offset + page.consumed < result.textTotal!
        ? `truncated - read${target} offset=${offset + page.consumed} to continue` : '');
    return [scope, page.text, close, hint].filter(Boolean).join('\n');
}

function boundedFrameText(text: string, cap: number): { text: string; consumed: number } {
    if (text.length <= cap) return { text, consumed: text.length };
    const closing: string[] = [];
    let output = '';
    let consumed = 0;
    for (const segment of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
        const start = /^\s*\[frame ([^\s|\]]+)(?:\s*\|[^\n]*)?\]\s*$/.exec(segment.trimEnd());
        const end = /^\s*\[\/frame ([^\s|\]]+)\]\s*$/.exec(segment.trimEnd());
        const next = [...closing];
        if (start) next.push(`[/frame ${start[1]}]`);
        if (end && next.at(-1) === `[/frame ${end[1]}]`) next.pop();
        const reserve = next.reduce((sum, line) => sum + line.length + 1, 0);
        if (output.length + segment.length + reserve > cap) {
            if (!start && !end) {
                const count = Math.max(0, cap - output.length - reserve - 1);
                output += segment.slice(0, count);
                consumed += count;
            }
            break;
        }
        output += segment;
        consumed += segment.length;
        closing.splice(0, closing.length, ...next);
    }
    return { text: [output.trimEnd(), ...closing.reverse()].join('\n'), consumed };
}

export function formatBrowserDelta(previous: Map<string, string>, current: Map<string, string>): string {
    const changes: string[] = [];
    for (const [ref, text] of previous) if (current.get(ref) !== text) changes.push(`- ${text}`);
    for (const [ref, text] of current) if (previous.get(ref) !== text) changes.push(`+ ${text}`);
    const shown = changes.slice(0, BROWSER_DELTA_LINES);
    if (changes.length > BROWSER_DELTA_LINES) shown[shown.length - 1] = 'truncated - snapshot to inspect remaining changes';
    return bounded(shown.join('\n'), BROWSER_SNAPSHOT_CAP - 1024, '\ntruncated - snapshot to inspect remaining changes');
}

function status(result: BrowserCommandResult): string {
    return `ok · ${clean(result.title ?? '').slice(0, 160)} · ${clean(result.url ?? '').slice(0, 800)}`;
}

function success(textResultForLlm: string): ToolResultObject {
    return { resultType: 'success', textResultForLlm };
}

export function createBrowserTool(deps: BrowserToolDeps): Tool<BrowserCommand> {
    const turnId = randomUUID();
    return defineTool<BrowserCommand>('browser', {
        description: BROWSER_TOOL_DESCRIPTION,
        parameters: BROWSER_TOOL_PARAMETERS,
        handler: async (raw, invocation): Promise<ToolResultObject> => {
            try {
                const command = { ...parseBrowserCommand(raw) };
                const signals = [deps.signal, invocation?.signal].filter((signal): signal is AbortSignal => !!signal);
                const signal = signals.length ? AbortSignal.any(signals) : undefined;
                signal?.throwIfAborted();
                const observedTakeoverRevision = deps.runtime.getHumanTakeoverRevision?.(deps.workspaceId, deps.processId);
                if (!deps.runtime.getEnabled()) throw new Error('Browser control is disabled');
                if (command.action === 'request_human') {
                    // Assistance must pause now, even when another browser tool call is still pending.
                    const result = await deps.runtime.execute(deps.workspaceId, deps.processId, command, undefined, signal, turnId);
                    signal?.throwIfAborted();
                    if (!Array.isArray(result.elements)) throw new Error('Browser returned no refreshed page context');
                    deps.stateStore.acceptHandoff(deps.workspaceId, deps.processId, result);
                    return success([`Control returned to agent. Already observed information cannot be erased.`,
                        result.handoffNote ? `Handoff note: ${result.handoffNote}` : '', status(result), formatBrowserSnapshot(result.elements)].filter(Boolean).join('\n'));
                }
                return await deps.stateStore.run(deps.workspaceId, deps.processId, async state => {
                    signal?.throwIfAborted();
                    if (state.deleted) throw new Error('Browser process was removed');
                    const framesEnabled = deps.runtime.getFramesEnabled?.();
                    const result = await deps.runtime.execute(deps.workspaceId, deps.processId, command, state.selectedTab, signal, turnId, ...(observedTakeoverRevision === undefined ? [] : [observedTakeoverRevision]));
                    signal?.throwIfAborted();
                    if (state.deleted) throw new Error('Browser process was removed');
                    if (framesEnabled !== deps.runtime.getFramesEnabled?.()) throw new Error('Browser frame policy changed during command');
                    if (result.tab) state.selectedTab = result.tab;
                    const tab = result.tab ?? state.selectedTab;
                    const respond = (text: string) => success(result.handoffNote ? `Handoff note: ${result.handoffNote}\n${text}` : text);
                    if (command.action === 'tabs') {
                        if (!Array.isArray(result.tabs)) throw new Error('Browser returned no tab list');
                        return respond(bounded(result.tabs.map(tab =>
                            `${tab.id}${tab.id === state.selectedTab ? ' *' : ''} ${JSON.stringify(clean(tab.title))} · ${clean(tab.url)} · ${tab.engine}`,
                        ).join('\n') || '(no URL tabs)', BROWSER_SNAPSHOT_CAP, '\ntruncated - select a tab'));
                    }
                    if (command.action === 'frames') {
                        if (!Array.isArray(result.frames)) throw new Error('Browser returned no frame inventory');
                        const output: string[] = [];
                        const warning = frameWarning(result);
                        let size = warning.length;
                        for (const frame of result.frames) {
                            const text = `${'  '.repeat(Math.min(frame.depth, 8))}${frameHeader(frame)}`;
                            if (size + text.length + 160 > BROWSER_SNAPSHOT_CAP) break;
                            output.push(text);
                            size += text.length + 1;
                        }
                        const shown = output.length;
                        if (warning) output.push(warning);
                        if (shown && (shown < result.frames.length || result.truncated)) {
                            output.push(`[truncated: frames offset=${(command.offset ?? 0) + shown} to continue]`);
                        }
                        return respond(output.join('\n') || '(no inspected frames)');
                    }
                    if (command.action === 'read') {
                        if (typeof result.text !== 'string') throw new Error('Browser returned no page text');
                        const offset = command.offset ?? 0;
                        const text = result.text;
                        const total = result.textTotal;
                        if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 || text.length > BROWSER_READ_CAP) throw new Error('Browser returned an invalid page text result');
                        if (result.frame && result.document) return respond(formatFrameRead(command, result));
                        const hint = `\ntruncated - read${command.ref ? ` ref=${command.ref}` : ''} offset=${offset + BROWSER_READ_CAP - 80} to continue`;
                        const contentCap = BROWSER_READ_CAP - 80;
                        const content = text.slice(0, contentCap);
                        return respond(content + (offset + content.length < total ? hint : ''));
                    }
                    if (command.action === 'eval') {
                        if (typeof result.valueJson !== 'string') throw new Error('Browser returned no evaluation result');
                        if (result.valueJson.length > BROWSER_EVAL_CAP || typeof result.valueTruncated !== 'boolean') throw new Error('Browser returned an invalid evaluation result');
                        const hint = '\ntruncated - return a smaller result';
                        if (result.frame && result.document) {
                            const header = frameScope(result) + '\n';
                            const warning = frameWarning(result);
                            const suffix = result.valueTruncated || header.length + result.valueJson.length + warning.length > BROWSER_EVAL_CAP
                                ? hint : warning ? `\n${warning}` : '';
                            return respond(header + result.valueJson.slice(0, BROWSER_EVAL_CAP - header.length - suffix.length) + suffix);
                        }
                        return respond(result.valueTruncated ? result.valueJson.slice(0, BROWSER_EVAL_CAP - hint.length) + hint : result.valueJson);
                    }
                    if (command.action === 'screenshot') {
                        if (!result.image?.data || !['image/jpeg', 'image/png'].includes(result.image.mimeType)) throw new Error('Browser returned no screenshot');
                        const file = deps.stateStore.saveScreenshot(deps.workspaceId, deps.processId, result.image);
                        const response = respond(`${status(result)}\nsaved: ![screenshot](<${file.replace(/\\/g, '/')}>)`);
                        if (command.view === true) {
                            response.binaryResultsForLlm = [{ type: 'image', data: result.image.data, mimeType: result.image.mimeType, description: 'Browser screenshot' }];
                        }
                        return response;
                    }
                    if (command.action === 'wait') return respond([status(result), frameScope(result), frameWarning(result)].filter(Boolean).join('\n'));
                    if (!Array.isArray(result.elements)) throw new Error('Browser returned no snapshot');
                    const current = elementMap(result.interactiveElements ?? result.elements ?? []);
                    const scope = tab ? snapshotScope(tab, result) : undefined;
                    const baseline = tab ? state.snapshots.get(tab) : undefined;
                    const previous = baseline && baseline.scope === scope ? baseline.elements : new Map<string, string>();
                    if (tab && result.truncated) state.snapshots.delete(tab);
                    if (tab && scope && !result.truncated) state.snapshots.set(tab, { scope, elements: current });
                    if (command.action === 'snapshot') return respond(result.frames
                        ? formatBrowserFrameSnapshot(result, command.all) : formatBrowserSnapshot(result.elements ?? [], command.all));
                    const delta = formatBrowserDelta(previous, current);
                    const header = [status(result), frameScope(result)].filter(Boolean).join('\n');
                    const warning = frameWarning(result);
                    const changes = bounded(delta, BROWSER_SNAPSHOT_CAP - header.length - warning.length - 2,
                        '\n[truncated: output-limit; snapshot to inspect]');
                    return respond([header, changes, warning].filter(Boolean).join('\n'));
                });
            } catch (error) {
                const message = bounded(error instanceof Error ? error.message : String(error), BROWSER_EVAL_CAP, '\ntruncated error');
                return { resultType: 'failure', textResultForLlm: message, error: message };
            }
        },
    });
}
