/**
 * Process Resume Handler
 *
 * Adds endpoint to launch an interactive Copilot CLI resume session
 * from an existing process/session ID.
 */

import { spawn, type SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { sendError, sendJSON } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';

export interface LaunchResumeInput {
    sessionId: string;
    workingDirectory: string;
}

export interface LaunchResumeResult {
    launched: boolean;
    command: string;
    terminal?: string;
    reason?: string;
}

export type ResumeCommandLauncher = (input: LaunchResumeInput) => Promise<LaunchResumeResult>;

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

function buildResumeCommand(
    sessionId: string,
    workingDirectory: string,
    platform: NodeJS.Platform = process.platform
): string {
    if (platform === 'win32') {
        return `cd /d ${quoteWindows(workingDirectory)} && copilot --yolo --resume ${quoteWindows(sessionId)}`;
    }
    return `cd ${quotePosix(workingDirectory)} && copilot --yolo --resume ${quotePosix(sessionId)}`;
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
            const resolved = path.resolve(candidate);
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                return resolved;
            }
        } catch {
            // Skip invalid directories and try the next candidate.
        }
    }

    return process.cwd();
}

export async function launchResumeCommandInTerminal(input: LaunchResumeInput): Promise<LaunchResumeResult> {
    const platform = process.platform;
    const command = buildResumeCommand(input.sessionId, input.workingDirectory, platform);

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
        const resumeCmd = `copilot --yolo --resume ${quoteWindows(input.sessionId)}`;
        const startLine = `/c start "" /D ${quoteWindows(input.workingDirectory)} cmd.exe /k ${resumeCmd}`;
        await spawnDetached('cmd.exe', [startLine], { windowsVerbatimArguments: true });
        return {
            launched: true,
            command,
            terminal: 'cmd',
        };
    }

    // Linux / Unix-like environments.
    const posixCommand = buildResumeCommand(input.sessionId, input.workingDirectory, 'linux');
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

/**
 * POST /api/processes/:id/resume-cli
 * Launch Copilot CLI in an interactive terminal using persisted session ID.
 */
export function registerProcessResumeRoutes(
    routes: Route[],
    store: ProcessStore,
    launcher: ResumeCommandLauncher = launchResumeCommandInTerminal
): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/resume-cli$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const processRecord = await store.getProcess(id);
            if (!processRecord) {
                return sendError(res, 404, 'Process not found');
            }

            const sessionId = extractProcessSessionId(processRecord);
            if (!sessionId) {
                return sendError(res, 409, 'Process has no resumable session ID');
            }

            const workingDirectory = await resolveWorkingDirectory(store, processRecord);

            try {
                const result = await launcher({ sessionId, workingDirectory });
                process.stderr.write(`[Process] resume-cli id=${id} sessionId=${sessionId} launched=${result.launched}\n`);
                return sendJSON(res, 200, {
                    processId: id,
                    sessionId,
                    workingDirectory,
                    launched: result.launched,
                    terminal: result.terminal,
                    reason: result.reason,
                    command: result.command,
                });
            } catch (error: any) {
                return sendError(
                    res,
                    500,
                    error?.message || 'Failed to launch interactive Copilot resume command'
                );
            }
        },
    });
}

