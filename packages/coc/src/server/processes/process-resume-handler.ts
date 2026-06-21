/**
 * Process Resume Handler
 *
 * Adds endpoint to launch an interactive Copilot CLI resume session
 * from an existing process/session ID.
 */

import { spawn, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { resolveWorkspaceExecutionContext, translatePathForHostFilesystem } from '@plusplusoneplusplus/forge';
import { sendError, sendJSON, parseBody } from '../core/api-handler';
import type { Route } from '../types';

export type ResumeProvider = 'copilot' | 'codex' | 'claude';

export interface LaunchResumeInput {
    sessionId: string;
    workingDirectory: string;
    provider?: ResumeProvider;
}

export interface LaunchResumeResult {
    launched: boolean;
    command: string;
    terminal?: string;
    reason?: string;
}

export type ResumeCommandLauncher = (input: LaunchResumeInput) => Promise<LaunchResumeResult>;

/** Normalize an arbitrary value to a concrete resume provider, defaulting to copilot. */
function normalizeResumeProvider(value: unknown): ResumeProvider {
    return value === 'codex' ? 'codex'
        : value === 'claude' ? 'claude'
        : 'copilot';
}

/** Return the validated provider, or undefined when the value is not a known provider. */
function asResumeProvider(value: unknown): ResumeProvider | undefined {
    return value === 'copilot' || value === 'codex' || value === 'claude' ? value : undefined;
}

function toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function parseSessionIdFromResult(result: unknown): string | undefined {
    if (typeof result !== 'string') return undefined;
    const trimmed = result.trim();
    if (!trimmed) return undefined;
    try {
        const parsed = JSON.parse(trimmed) as { sessionId?: unknown };
        return toNonEmptyString(parsed?.sessionId);
    } catch {
        return undefined;
    }
}

export function extractProcessSessionId(processRecord: any): string | undefined {
    return toNonEmptyString(processRecord?.sdkSessionId)
        || toNonEmptyString(processRecord?.sessionId)
        || parseSessionIdFromResult(processRecord?.result);
}

function quotePosix(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteWindows(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Bare, paste-ready resume invocation (no `cd`) for the given provider.
 * `quotedSessionId` must already be shell-quoted for the target platform.
 */
function buildResumeInvocation(provider: ResumeProvider, quotedSessionId: string): string {
    if (provider === 'codex') {
        return `codex resume ${quotedSessionId} --dangerously-bypass-approvals-and-sandbox`;
    }
    if (provider === 'claude') {
        return `claude --dangerously-skip-permissions --resume ${quotedSessionId}`;
    }
    return `copilot --yolo --resume ${quotedSessionId}`;
}

/** Bare provider resume invocation with the session ID shell-quoted for the platform. */
function buildBareResumeCommand(
    sessionId: string,
    provider: ResumeProvider = 'copilot',
    platform: NodeJS.Platform = process.platform
): string {
    const quote = platform === 'win32' ? quoteWindows : quotePosix;
    return buildResumeInvocation(provider, quote(sessionId));
}

function buildResumeCommand(
    sessionId: string,
    workingDirectory: string,
    platform: NodeJS.Platform = process.platform,
    provider: ResumeProvider = 'copilot'
): string {
    if (platform === 'win32') {
        return `cd /d ${quoteWindows(workingDirectory)} && ${buildResumeInvocation(provider, quoteWindows(sessionId))}`;
    }
    return `cd ${quotePosix(workingDirectory)} && ${buildResumeInvocation(provider, quotePosix(sessionId))}`;
}

function escapeAppleScriptString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function spawnDetached(command: string, args: string[], extraOptions?: SpawnOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            ...extraOptions,
        });

        let settled = false;
        const finishResolve = () => {
            if (settled) return;
            settled = true;
            child.unref();
            resolve();
        };
        const finishReject = (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
        };

        child.once('spawn', finishResolve);
        child.once('error', finishReject);
    });
}

async function resolveWorkingDirectory(store: ProcessStore, processRecord: any): Promise<string> {
    const candidates: string[] = [];

    const processWorkingDir = toNonEmptyString(processRecord?.workingDirectory);
    if (processWorkingDir) {
        candidates.push(processWorkingDir);
    }

    const payloadWorkingDir = toNonEmptyString(processRecord?.payload?.workingDirectory);
    if (payloadWorkingDir) {
        candidates.push(payloadWorkingDir);
    }

    const workspaceId = toNonEmptyString(processRecord?.metadata?.workspaceId);
    if (workspaceId) {
        const workspaces = await store.getWorkspaces();
        const workspace = workspaces.find((ws) => ws.id === workspaceId);
        if (workspace?.rootPath) {
            candidates.push(workspace.rootPath);
        }
    }

    candidates.push(process.cwd());

    for (const candidate of candidates) {
        try {
            const executionContext = resolveWorkspaceExecutionContext(candidate);
            const resolved = executionContext.kind === 'wsl'
                ? translatePathForHostFilesystem(candidate, executionContext)
                : path.resolve(candidate);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                return resolved;
            }
        } catch {
            // Skip invalid directories and try the next candidate.
        }
    }

    return process.cwd();
}

async function tryLinuxTerminalLaunchers(
    posixCommand: string,
): Promise<LaunchResumeResult> {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        return {
            launched: false,
            command: posixCommand,
            reason: 'No GUI display detected for terminal auto-launch.',
        };
    }

    const linuxLaunchers: Array<{ terminal: string; command: string; args: string[] }> = [
        { terminal: 'x-terminal-emulator', command: 'x-terminal-emulator', args: ['-e', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'gnome-terminal', command: 'gnome-terminal', args: ['--', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'konsole', command: 'konsole', args: ['-e', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'xfce4-terminal', command: 'xfce4-terminal', args: ['-e', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'xterm', command: 'xterm', args: ['-e', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'alacritty', command: 'alacritty', args: ['-e', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'kitty', command: 'kitty', args: ['/bin/sh', '-lc', posixCommand] },
        { terminal: 'tilix', command: 'tilix', args: ['-e', '/bin/sh', '-lc', posixCommand] },
        { terminal: 'terminator', command: 'terminator', args: ['-x', '/bin/sh', '-lc', posixCommand] },
    ];

    let lastError: unknown;
    for (const launcher of linuxLaunchers) {
        try {
            await spawnDetached(launcher.command, launcher.args);
            return {
                launched: true,
                command: posixCommand,
                terminal: launcher.terminal,
            };
        } catch (error) {
            lastError = error;
        }
    }

    return {
        launched: false,
        command: posixCommand,
        reason: lastError instanceof Error
            ? `No supported terminal launcher found (${lastError.message}).`
            : 'No supported terminal launcher found.',
    };
}

export async function launchResumeCommandInTerminal(input: LaunchResumeInput): Promise<LaunchResumeResult> {
    const platform = process.platform;
    const provider = normalizeResumeProvider(input.provider);
    const terminalWorkingDirectory = platform === 'win32'
        ? translatePathForHostFilesystem(input.workingDirectory)
        : input.workingDirectory;
    const command = buildResumeCommand(input.sessionId, terminalWorkingDirectory, platform, provider);

    if (platform === 'darwin') {
        const scriptBody = escapeAppleScriptString(command);
        await spawnDetached('osascript', [
            '-e',
            'tell application "Terminal" to activate',
            '-e',
            `tell application "Terminal" to do script "${scriptBody}"`,
        ]);

        return {
            launched: true,
            command,
            terminal: 'Terminal',
        };
    }

    if (platform === 'win32') {
        // Use `start /D` to set the working directory instead of `cd /d ... &&`.
        // The `&&` approach fails because the outer `cmd.exe /c` interprets `&&`
        // as its own command separator, so `start` only receives the `cd /d` part.
        // `windowsVerbatimArguments` prevents Node.js from C-runtime-escaping quotes.
        const resumeCmd = buildResumeInvocation(provider, quoteWindows(input.sessionId));
        const startLine = `/c start "" /D ${quoteWindows(terminalWorkingDirectory)} powershell.exe -NoExit -Command ${resumeCmd}`;
        await spawnDetached('cmd.exe', [startLine], { windowsVerbatimArguments: true });
        return {
            launched: true,
            command,
            terminal: 'powershell',
        };
    }

    // Linux / Unix-like environments.
    const posixCommand = buildResumeCommand(input.sessionId, input.workingDirectory, 'linux', provider);
    return tryLinuxTerminalLaunchers(posixCommand);
}

export interface LaunchFreshChatInput {
    workingDirectory: string;
    provider?: 'copilot' | 'codex' | 'claude';
}

export type FreshChatTerminalLauncher = (input: LaunchFreshChatInput) => Promise<LaunchResumeResult>;
type MaybePromise<T> = T | Promise<T>;

function buildFreshChatCommand(
    workingDirectory: string,
    platform: NodeJS.Platform = process.platform,
    provider: 'copilot' | 'codex' | 'claude' = 'copilot'
): string {
    let cliCommand: string;
    if (provider === 'codex') {
        cliCommand = 'codex --dangerously-bypass-approvals-and-sandbox';
    } else if (provider === 'claude') {
        cliCommand = 'claude --dangerously-skip-permissions';
    } else {
        cliCommand = 'copilot --yolo';
    }
    if (platform === 'win32') {
        return `cd /d ${quoteWindows(workingDirectory)} && ${cliCommand}`;
    }
    return `cd ${quotePosix(workingDirectory)} && ${cliCommand}`;
}

export async function launchFreshChatInTerminal(input: LaunchFreshChatInput): Promise<LaunchResumeResult> {
    const platform = process.platform;
    const provider: 'copilot' | 'codex' | 'claude' =
        input.provider === 'codex' ? 'codex' :
        input.provider === 'claude' ? 'claude' :
        'copilot';
    const terminalWorkingDirectory = platform === 'win32'
        ? translatePathForHostFilesystem(input.workingDirectory)
        : input.workingDirectory;
    const command = buildFreshChatCommand(terminalWorkingDirectory, platform, provider);

    if (platform === 'darwin') {
        const scriptBody = escapeAppleScriptString(command);
        await spawnDetached('osascript', [
            '-e',
            'tell application "Terminal" to activate',
            '-e',
            `tell application "Terminal" to do script "${scriptBody}"`,
        ]);
        return { launched: true, command, terminal: 'Terminal' };
    }

    if (platform === 'win32') {
        let freshCmd: string;
        if (provider === 'codex') {
            freshCmd = 'codex --dangerously-bypass-approvals-and-sandbox';
        } else if (provider === 'claude') {
            freshCmd = 'claude --dangerously-skip-permissions';
        } else {
            freshCmd = 'copilot --yolo';
        }
        const startLine = `/c start "" /D ${quoteWindows(terminalWorkingDirectory)} powershell.exe -NoExit -Command ${freshCmd}`;
        await spawnDetached('cmd.exe', [startLine], { windowsVerbatimArguments: true });
        return { launched: true, command, terminal: 'powershell' };
    }

    // Linux / Unix-like environments.
    const posixCommand = buildFreshChatCommand(input.workingDirectory, 'linux', provider);
    return tryLinuxTerminalLaunchers(posixCommand);
}

/**
 * POST /api/chat/launch-terminal
 * Spawn a fresh Copilot CLI session in an interactive terminal.
 * Body: { workingDirectory?: string }
 */
export function registerFreshChatTerminalRoutes(
    routes: Route[],
    launcher: FreshChatTerminalLauncher = launchFreshChatInTerminal,
    options?: { getProvider?: () => MaybePromise<'copilot' | 'codex' | 'claude'> }
): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/chat\/launch-terminal$/,
        handler: async (req, res) => {
            let body: { workingDirectory?: unknown } = {};
            try {
                body = (await parseBody(req)) as { workingDirectory?: unknown };
            } catch {
                // Empty body is fine — workingDirectory falls back to cwd
            }
            const workingDirectory = toNonEmptyString(body?.workingDirectory) ?? process.cwd();
            try {
                const rawProvider = await options?.getProvider?.();
                const provider: 'copilot' | 'codex' | 'claude' =
                    rawProvider === 'codex' ? 'codex' :
                    rawProvider === 'claude' ? 'claude' :
                    'copilot';
                const result = await launcher({ workingDirectory, provider });
                process.stderr.write(`[Chat] launch-terminal workingDirectory=${workingDirectory} provider=${provider} launched=${result.launched}\n`);
                return sendJSON(res, 200, {
                    workingDirectory,
                    provider,
                    launched: result.launched,
                    terminal: result.terminal,
                    reason: result.reason,
                    command: result.command,
                });
            } catch (error: any) {
                return sendError(res, 500, error?.message || 'Failed to launch chat terminal');
            }
        },
    });
}

/**
 * POST /api/processes/:id/resume-cli
 * Launch Copilot CLI in an interactive terminal using persisted session ID.
 */
export function registerProcessResumeRoutes(
    routes: Route[],
    store: ProcessStore,
    launcher: ResumeCommandLauncher = launchResumeCommandInTerminal,
    options?: { getDefaultProvider?: () => MaybePromise<ResumeProvider> }
): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/resume-cli$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const processRecord = await store.getProcess(id);
            if (!processRecord) {
                return sendError(res, 404, 'Process not found');
            }

            const sessionId = extractProcessSessionId(processRecord);
            if (!sessionId) {
                return sendError(res, 409, 'Process has no resumable session ID');
            }

            let body: { launch?: unknown } = {};
            try {
                body = (await parseBody(req)) as { launch?: unknown };
            } catch {
                // Empty/invalid body is fine — launch defaults to true.
            }
            const launch = body?.launch !== false;

            // Provider = the session's own metadata.provider; fall back to the
            // configured default provider when absent/invalid. Session IDs are
            // tool-specific, so the resume command must match the creating tool.
            let provider = asResumeProvider(processRecord?.metadata?.provider);
            if (!provider) {
                provider = normalizeResumeProvider(await options?.getDefaultProvider?.());
            }

            const workingDirectory = await resolveWorkingDirectory(store, processRecord);

            if (!launch) {
                const command = buildBareResumeCommand(sessionId, provider);
                process.stderr.write(`[Process] resume-cli id=${id} sessionId=${sessionId} provider=${provider} launched=false (copy)\n`);
                return sendJSON(res, 200, {
                    processId: id,
                    sessionId,
                    workingDirectory,
                    provider,
                    launched: false,
                    command,
                });
            }

            try {
                const result = await launcher({ sessionId, workingDirectory, provider });
                process.stderr.write(`[Process] resume-cli id=${id} sessionId=${sessionId} provider=${provider} launched=${result.launched}\n`);
                return sendJSON(res, 200, {
                    processId: id,
                    sessionId,
                    workingDirectory,
                    provider,
                    launched: result.launched,
                    terminal: result.terminal,
                    reason: result.reason,
                    command: result.command,
                });
            } catch (error: any) {
                return sendError(
                    res,
                    500,
                    error?.message || 'Failed to launch interactive resume command'
                );
            }
        },
    });
}
