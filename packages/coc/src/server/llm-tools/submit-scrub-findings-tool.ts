/**
 * Factory for `submit_scrub_findings`: the only output of a Sentinel To-do
 * Scrubber child chat. It is bound to the run on the chat's task payload, so
 * the model can report findings for that run alone. The server applies them
 * once the chat finishes; nothing here writes the ledger.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ScrubberRunService, ScrubChildContext } from '../sentinel-scrubber/scrubber-runs';
import { SUBMIT_SCRUB_FINDINGS_TOOL_NAME } from '../sentinel-scrubber/scrubber-runs';

export interface SubmitScrubFindingsToolDeps {
    service: Pick<ScrubberRunService, 'submit'>;
    context: ScrubChildContext;
}

interface SubmitScrubFindingsArgs {
    runId?: string;
    findings?: unknown;
}

const evidenceSchema = {
    type: 'object',
    properties: {
        kind: { type: 'string', enum: ['pr', 'commit', 'job', 'reference', 'other'] },
        ref: { type: 'string', description: 'URL or id of the artifact.' },
        state: { type: 'string', enum: ['merged', 'open', 'closed', 'on_default_branch', 'succeeded', 'failed', 'other'] },
        observedAt: { type: 'string', description: 'ISO time the artifact reached this state, when known.' },
        checkedAt: { type: 'string', description: 'ISO time you checked it in this run.' },
    },
    required: ['kind', 'ref', 'state', 'checkedAt'],
};

export function createSubmitScrubFindingsTool(deps: SubmitScrubFindingsToolDeps) {
    return defineTool<SubmitScrubFindingsArgs>(SUBMIT_SCRUB_FINDINGS_TOOL_NAME, {
        description: 'Report this scrub run\'s findings, one per snapshot item. Call exactly once; later calls are rejected. '
            + 'The server applies auto-Done and records every other verdict as a proposal for the user.',
        parameters: {
            type: 'object',
            properties: {
                runId: { type: 'string', description: 'The run id from the prompt.' },
                findings: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            itemId: { type: 'string' },
                            verdict: { type: 'string', enum: ['done', 'obsolete', 'in_progress', 'deferred', 'needs_attention', 'unchanged', 'unverified'] },
                            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                            autoApply: { type: 'boolean', description: 'Only on done with high confidence.' },
                            summary: { type: 'string', description: 'One line, at most 300 characters.' },
                            rationale: { type: 'string', description: 'At most 2000 characters.' },
                            unverifiedReason: { type: 'string', description: 'Required with verdict unverified.' },
                            evidence: { type: 'array', items: evidenceSchema },
                        },
                        required: ['itemId', 'verdict', 'confidence', 'summary'],
                    },
                },
            },
            required: ['runId', 'findings'],
        },
        handler: async (args: SubmitScrubFindingsArgs) => {
            if (args?.runId !== deps.context.runId) {
                return { error: `runId must be "${deps.context.runId}"` };
            }
            try {
                return { status: 'submitted', ...deps.service.submit(deps.context, args.findings) };
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
        },
    });
}
