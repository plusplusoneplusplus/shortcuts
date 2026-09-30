/**
 * `system_one` LLM tool — fast, cheap yes/no, choice, or score judgments.
 *
 * The chat model points at content it already has (earlier tool results,
 * workspace files, short text) instead of re-typing it. The handler resolves
 * those refs into a labeled `state` string and runs it through the shared
 * {@link DecisionService} on the Copilot backend, whatever the chat provider.
 *
 * Errors come back as `{ error, message, source? }` results, never throws, so
 * the model can fix a ref and retry.
 *
 * Gated by the `LLMToolSystemOne.enabled` admin flag at the addon level.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { DecisionQuestion } from '@plusplusoneplusplus/coc-client';
import { getServerLogger } from '../logging/server-logger';
import { DecisionBackendError } from '../decisions/decision-backend';
import type { DecisionService } from '../decisions/decision-service';
import type { ToolCallLedger } from '../executors/tool-call-ledger';
import {
    buildSystemOneState,
    resolveSources,
    type SystemOneError,
    type SystemOneSource,
} from './system-one/source-resolver';

export interface SystemOneToolDeps {
    service: Pick<DecisionService, 'evaluate'>;
    workspaceId: string;
    workingDirectory: string;
    /** Ledger bound to the calling process — refs never reach other processes. */
    getLedger: () => ToolCallLedger;
}

export interface SystemOneArgs {
    sources?: SystemOneSource[];
    questions?: Record<string, DecisionQuestion>;
}

const DESCRIPTION = [
    'Fast, cheap yes/no, choice, or score judgments over content you already have.',
    'Point at content with `sources`. Do NOT paste earlier tool output or file contents.',
    'Use `{ "tool": "<name>", "nth": -1 }` for the latest result of a tool in this chat (`-2` = the one before, `1` = the first; add `"turn": "current"` to limit to this turn),',
    '`{ "last": N }` for the last N tool results of any tool,',
    'and `{ "file": "<path>", "lines": "a-b" }` for workspace files.',
    'Use `{ "text": ... }` only for short facts that exist nowhere else (max 4 KB).',
    'Call it after the referenced tool call finishes, not in the same parallel batch.',
    'Question types: `noul` (yes/no → value in [0,1]), `choice` (criteria keys are the options), `score` (criteria is an ordered list of levels).',
    'Confidence values come from the decision model itself and are not calibrated.',
    'Runs on Copilot (gpt-5.4-mini) no matter which provider this chat uses, so referenced content is sent to Copilot.',
].join(' ');

function errorResult(error: SystemOneError): string {
    return JSON.stringify(error);
}

export function createSystemOneTool(deps: SystemOneToolDeps): { tool: Tool<SystemOneArgs> } {
    const tool = defineTool<SystemOneArgs>('system_one', {
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                sources: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    description: 'What to judge, in order. Each item is one of: { tool, nth?, turn? }, { last }, { file, lines? }, { text }.',
                    items: {
                        type: 'object',
                        properties: {
                            tool: { type: 'string', description: 'Tool name as you see it (bash, view, grep, kusto_query, …). Case-insensitive.' },
                            nth: { type: 'integer', description: '-1 = latest (default), -2 = the one before, 1 = the first.' },
                            turn: { type: 'string', enum: ['current', 'any'], description: 'Limit to the current turn, or search the whole chat (default).' },
                            last: { type: 'integer', minimum: 1, maximum: 5, description: 'The last N completed tool results of any tool, oldest first.' },
                            file: { type: 'string', description: 'Workspace-relative file path.' },
                            lines: { type: 'string', description: 'Optional 1-based inclusive line range, e.g. "10-120".' },
                            text: { type: 'string', description: 'A short fact that exists nowhere else (max 4 KB).' },
                        },
                    },
                },
                questions: {
                    type: 'object',
                    description: 'Named questions. Each is { type: "noul", instructions } | { type: "choice", instructions, criteria: { <option>: <description|null> } } | { type: "score", instructions, criteria: [<level>, …] }.',
                    additionalProperties: { type: 'object' },
                },
            },
            required: ['sources', 'questions'],
        },
        handler: async (args, invocation) => {
            if (!args || typeof args !== 'object' || !Array.isArray(args.sources)) {
                return errorResult({ error: 'DECISION_INVALID_REQUEST', message: '`sources` must be an array.' });
            }
            const resolved = await resolveSources({
                sources: args.sources,
                ledger: deps.getLedger(),
                workspaceRoot: deps.workingDirectory,
                excludeId: invocation?.toolCallId,
            });
            if (!resolved.ok) return errorResult(resolved.error);
            const built = buildSystemOneState(resolved.sections);
            if (!built.ok) return errorResult(built.error);

            try {
                const response = await deps.service.evaluate(
                    { backend: 'copilot', state: built.state, questions: args.questions },
                    { workspaceId: deps.workspaceId, workingDirectory: deps.workingDirectory, signal: invocation?.signal },
                );
                if (response.usage) {
                    getServerLogger().info({ workspaceId: deps.workspaceId, tool: 'system_one', usage: response.usage }, 'system_one usage');
                }
                return JSON.stringify({
                    answers: response.answers,
                    sources: resolved.sections.map(section => section.meta),
                    model: response.model,
                    durationMs: response.metadata.durationMs,
                });
            } catch (err) {
                if (err instanceof DecisionBackendError) {
                    return errorResult({ error: err.code, message: err.message });
                }
                return errorResult({ error: 'DECISION_UPSTREAM_FAILED', message: err instanceof Error ? err.message : String(err) });
            }
        },
    });
    return { tool };
}
