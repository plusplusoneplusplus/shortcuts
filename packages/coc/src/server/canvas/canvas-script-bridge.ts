/**
 * Backs `host.runScript(code, { state? })` inside an async extension-canvas
 * capability with the `run_tool_script` engine, run as the chat that OWNS the
 * canvas (its `processId`) — never the caller's chat — on an unattended turn
 * (no `ask_user`, approval-gated tools denied, no nested scripts).
 *
 * The script sees only the tools the manifest declares in `tools`, intersected
 * with the owner's enabled tools; anything else is simply absent, so
 * `tools.x(...)` throws `ToolCallError` inside the script. Manifest tools must
 * be registered, scriptable and `readOnly` (see {@link validateCanvasManifestTools}).
 * With `features.toolScriptingMcp` the owner's `mcp_list_tools` / `mcp_call`
 * pair is added regardless of the manifest; `mcp_call` stays approval-gated.
 *
 * Like `host.complete` this is capability-side only: the iframe has no
 * `CanvasHost.runScript`. Every run logs ids and counts, never the code, state
 * or result.
 */

import type { ToolScriptRunResult } from '@plusplusoneplusplus/coc-agent-sdk';
import { RUN_TOOL_SCRIPT_TOOL_NAME } from '@plusplusoneplusplus/coc-agent-sdk';
import { DEFAULT_CONFIG } from '../../config';
import { LLM_TOOL_REGISTRY, isScriptableLlmTool } from '../llm-tools/llm-tool-registry';
import { OwnerScriptUnavailableError, type OwnerScriptRunner } from '../executors/owner-script-runner';
import type { CapabilityRunScriptFn, CapabilityScriptOutcome } from './canvas-capability-runner';

/** Ceiling on one script's serialized result, checked before it reaches the worker. */
export const MAX_HOST_SCRIPT_RESULT_BYTES = 16 * 1024 * 1024;

/** Most tool names one manifest may declare. */
export const MAX_CANVAS_MANIFEST_TOOLS = 16;

/** The three live flags `host.runScript` needs. */
export interface CanvasToolScriptFlags {
    canvasHostApis?: boolean;
    toolScripting?: boolean;
    canvasToolScripts?: boolean;
}

/** True only when canvas host APIs, tool scripting and canvas tool scripts are all on. */
export function isCanvasToolScriptsEnabled(features: CanvasToolScriptFlags | undefined): boolean {
    return features?.canvasHostApis === true
        && (features.toolScripting ?? DEFAULT_CONFIG.features.toolScripting) === true
        && features.canvasToolScripts === true;
}

const READ_ONLY_TOOL_NAMES = new Set(LLM_TOOL_REGISTRY.filter(tool => tool.readOnly === true).map(tool => tool.name));
const REGISTERED_TOOL_NAMES = new Set(LLM_TOOL_REGISTRY.map(tool => tool.name));

/** Whether a canvas script may call this tool: registered, scriptable, read-only, not `run_tool_script`. */
export function isCanvasScriptTool(name: string): boolean {
    return name !== RUN_TOOL_SCRIPT_TOOL_NAME && isScriptableLlmTool(name) && READ_ONLY_TOOL_NAMES.has(name);
}

/** Validate a manifest's `tools` list. Absent is valid and means no tool access. */
export function validateCanvasManifestTools(tools: unknown): { ok: true; tools: string[] } | { ok: false; error: string } {
    if (tools === undefined || tools === null) return { ok: true, tools: [] };
    if (!Array.isArray(tools) || tools.some(name => typeof name !== 'string')) {
        return { ok: false, error: 'tools must be an array of tool names' };
    }
    if (tools.length > MAX_CANVAS_MANIFEST_TOOLS) {
        return { ok: false, error: `tools may list at most ${MAX_CANVAS_MANIFEST_TOOLS} names` };
    }
    const seen = new Set<string>();
    for (const name of tools as string[]) {
        if (seen.has(name)) return { ok: false, error: `tools lists "${name}" more than once` };
        seen.add(name);
        if (name === RUN_TOOL_SCRIPT_TOOL_NAME) {
            return { ok: false, error: 'tools cannot include run_tool_script — canvas scripts do not nest' };
        }
        if (!REGISTERED_TOOL_NAMES.has(name)) return { ok: false, error: `tools: unknown tool "${name}"` };
        if (!isScriptableLlmTool(name)) return { ok: false, error: `tools: "${name}" cannot be called from a script` };
        if (!READ_ONLY_TOOL_NAMES.has(name)) {
            return { ok: false, error: `tools: "${name}" is not read-only — canvas scripts may only call read-only tools` };
        }
    }
    return { ok: true, tools: [...seen] };
}

/** Who a script runs for. `processId` is the canvas's owner chat. */
export interface CanvasScriptAttribution {
    workspaceId: string;
    canvasId: string;
    capability: string;
    processId?: string;
    /** Manifest `tools`. */
    tools: readonly string[];
}

export interface CanvasScriptBridgeDeps {
    /** Live feature flags, read on every call. */
    getFeatures: () => CanvasToolScriptFlags | undefined;
    /** Late-bound owner runner; absent → `disabled`. */
    getOwnerScriptRunner: () => OwnerScriptRunner | undefined;
    /** Test seam for the result cap. */
    maxResultBytes?: number;
    log?: (message: string) => void;
}

export type CanvasRunScriptFactory = (attribution: CanvasScriptAttribution) => CapabilityRunScriptFn;

export function createCanvasRunScriptFactory(deps: CanvasScriptBridgeDeps): CanvasRunScriptFactory {
    const maxResultBytes = deps.maxResultBytes ?? MAX_HOST_SCRIPT_RESULT_BYTES;
    const log = deps.log ?? ((message: string) => console.log(message));

    return attribution => async (request, signal) => {
        const startedAt = Date.now();
        let callCount = 0;
        const finish = (outcome: CapabilityScriptOutcome): CapabilityScriptOutcome => {
            log(
                `[canvas runScript] workspace=${attribution.workspaceId} canvas=${attribution.canvasId} `
                + `capability=${attribution.capability} process=${attribution.processId ?? 'none'} `
                + `calls=${callCount} outcome=${outcome.ok ? 'ok' : outcome.code} durationMs=${Date.now() - startedAt}`,
            );
            return outcome;
        };
        const fail = (code: string, error: string) => finish({ ok: false, code, error });
        const abortedOutcome = () => (signal.reason as { code?: string } | undefined)?.code === 'timeout'
            ? fail('timeout', 'The capability budget ran out while the script was running')
            : fail('aborted', 'The capability run ended while the script was running');

        const runner = deps.getOwnerScriptRunner();
        if (!isCanvasToolScriptsEnabled(deps.getFeatures()) || !runner) {
            return fail('disabled', 'host.runScript is unavailable — canvas tool scripts are off on this server');
        }
        if (!attribution.processId) {
            return fail('no-owner', 'This canvas has no owner chat, so its scripts have no tools to run as');
        }
        if (signal.aborted) return abortedOutcome();

        let run: ToolScriptRunResult;
        try {
            run = await runner({
                workspaceId: attribution.workspaceId,
                processId: attribution.processId,
                code: request.code,
                ...(request.state === undefined ? {} : { state: request.state }),
                allowTools: attribution.tools.filter(isCanvasScriptTool),
                signal,
            });
        } catch (err) {
            if (err instanceof OwnerScriptUnavailableError) return fail('no-owner', err.message);
            if (signal.aborted) return abortedOutcome();
            return fail('script-error', err instanceof Error ? err.message : String(err));
        }
        callCount = run.callCount;
        if (signal.aborted) return abortedOutcome();
        if (!run.ok) return fail('script-error', run.error?.message ?? 'Script failed');

        const serialized = JSON.stringify(run.result ?? null);
        if (Buffer.byteLength(serialized, 'utf-8') > maxResultBytes) {
            return fail('script-error', `Script result exceeds the ${maxResultBytes} byte limit`);
        }
        return finish({ ok: true, result: run.result ?? null, logs: run.logs.map(entry => entry.text), callCount });
    };
}
