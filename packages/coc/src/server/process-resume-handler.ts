/**
 * Process Resume Handler
 *
 * Adds endpoint to launch an interactive Copilot CLI resume session
 * from an existing process/session ID.
 */

import { spawn } from 'child_process';
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

function buildResumeCommand(sessionId: string, workingDirectory: string): string {
    return `cd ${quotePosix(workingDirectory)} && copilot --yolo --resume ${quotePosix(sessionId)}`;
}

function escapeAppleScriptString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
    const command = buildResumeCommand(input.sessionId, input.workingDirectory);

    // Keep this conservative for now: reliable auto-launch on macOS Terminal.
    if (process.platform !== 'darwin') {
        return {
            launched: false,
            command,
            reason: 'Automatic terminal launch is currently supported on macOS only.',
        };
    }

    const scriptBody = escapeAppleScriptString(command);
    const child = spawn('osascript', [
        '-e',
        'tell application "Terminal" to activate',
        '-e',
        `tell application "Terminal" to do script "${scriptBody}"`,
    ], {
        detached: true,
        stdio: 'ignore',
    });
    child.unref();

    return {
        launched: true,
        command,
        terminal: 'Terminal',
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

