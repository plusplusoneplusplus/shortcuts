/**
 * Script node executor — spawns an external command as a child process.
 *
 * Routes workflow items through stdin/stdout, supporting JSON, CSV, text,
 * and passthrough modes. Uses `shell: true` so `run` may contain pipes,
 * redirections, and other shell syntax.
 *
 * stderr is inherited (forwarded to the parent process) and is NOT part of
 * the data contract.
 */

import * as path from 'path';
import { spawn } from 'child_process';
import { parseCSVContent } from '../../pipeline/csv-reader';
import type { Items, ScriptNodeConfig, WorkflowExecutionOptions } from '../types';

// ---------------------------------------------------------------------------
// CSV serialisation helper
// ---------------------------------------------------------------------------

/**
 * Serialise Items to CSV text.
 *
 * Header row uses keys from the first item. Values containing commas,
 * double-quotes, or newlines are quoted per RFC 4180.
 */
function serializeItemsToCSV(items: Items): string {
    if (items.length === 0) return '';

    const headers = Object.keys(items[0]);
    const escape = (v: string): string => {
        if (v.includes(',') || v.includes('"') || v.includes('\n')) {
            return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
    };

    const rows = items.map(item =>
        headers.map(h => escape(String(item[h] ?? ''))).join(',')
    );

    return [headers.join(','), ...rows].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

function parseJSONOutput(stdout: string): Items {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];

    // Strip markdown code fences if present
    const fencePattern = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;
    const match = trimmed.match(fencePattern);
    const jsonText = match ? match[1] : trimmed;

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) {
        throw new Error('Script json output must be a JSON array of objects');
    }
    return parsed as Items;
}

function parseCSVOutput(stdout: string): Items {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];
    const result = parseCSVContent(trimmed);
    return result.items as Items;
}

function parseOutput(
    stdout: string,
    outputMode: NonNullable<ScriptNodeConfig['output']>,
    inputs: Items,
): Items {
    switch (outputMode) {
        case 'json':
            return parseJSONOutput(stdout);
        case 'csv':
            return parseCSVOutput(stdout);
        case 'text':
            return [{ text: stdout.trim() }];
        case 'passthrough':
            return inputs;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a script node by spawning an external process.
 *
 * @param config  - Script node configuration.
 * @param inputs  - Items from upstream nodes (piped to stdin unless `input` is `'none'`).
 * @param options - Workflow execution options.
 */
export async function executeScript(
    config: ScriptNodeConfig,
    inputs: Items,
    options: WorkflowExecutionOptions,
): Promise<Items> {
    const workflowDir = options.workflowDirectory ?? process.cwd();

    const cwd = config.cwd
        ? path.resolve(workflowDir, config.cwd)
        : workflowDir;

    const timeoutMs = config.timeoutMs ?? options.timeoutMs ?? 60_000;

    return new Promise<Items>((resolve, reject) => {
        const proc = spawn(config.run, config.args ?? [], {
            cwd,
            env: { ...process.env, ...config.env },
            stdio: ['pipe', 'pipe', 'inherit'],
            shell: true,
        });

        let settled = false;
        const settle = (fn: () => void) => {
            if (!settled) {
                settled = true;
                fn();
            }
        };

        // -- Timeout --
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
        }, timeoutMs);

        // -- Spawn error (e.g., executable not found) --
        proc.on('error', (err: Error) => {
            clearTimeout(timer);
            settle(() => reject(new Error(`Failed to spawn script "${config.run}": ${err.message}`)));
        });

        // -- Collect stdout --
        const chunks: Buffer[] = [];
        proc.stdout!.on('data', (chunk: Buffer) => chunks.push(chunk));

        // -- Write stdin --
        const inputMode = config.input ?? 'none';
        switch (inputMode) {
            case 'json':
                proc.stdin!.write(JSON.stringify(inputs, null, 2));
                proc.stdin!.end();
                break;
            case 'csv':
                proc.stdin!.write(serializeItemsToCSV(inputs));
                proc.stdin!.end();
                break;
            case 'none':
                proc.stdin!.end();
                break;
        }

        // -- Process close --
        proc.on('close', (code: number | null) => {
            clearTimeout(timer);

            if (timedOut) {
                settle(() => reject(new Error(`Script timed out after ${timeoutMs}ms`)));
                return;
            }

            const nonZero = code !== 0 && code !== null;
            const onError = config.onError ?? 'abort';

            if (nonZero && onError !== 'warn') {
                settle(() => reject(new Error(`Script "${config.run}" exited with code ${code}`)));
                return;
            }

            if (nonZero && onError === 'warn') {
                settle(() => resolve([]));
                return;
            }

            const stdout = Buffer.concat(chunks).toString('utf-8');
            try {
                const items = parseOutput(stdout, config.output ?? 'passthrough', inputs);
                settle(() => resolve(items));
            } catch (err) {
                settle(() => reject(err as Error));
            }
        });
    });
}
