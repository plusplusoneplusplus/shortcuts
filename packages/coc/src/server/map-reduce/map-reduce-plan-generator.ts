import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { SystemMessageConfig } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import type { MapReduceChildMode } from './types';
import {
    DEFAULT_MAP_REDUCE_MAX_PARALLEL,
} from './types';
import {
    normalizeMapReducePlan,
} from './map-reduce-plan-validation';
import type { NormalizedMapReducePlan } from './map-reduce-plan-validation';

const PLAN_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `\
You are planning a CoC Map Reduce run.

Your job is to decompose one user request into a reviewed list of independent map item tasks, then provide default reduce instructions that aggregate all completed map item outputs into one final result.

STRICT OUTPUT CONTRACT
======================
Respond with ONLY a valid JSON object. No prose, no markdown, no code fences.

Schema:
{
  "maxParallel": 3,
  "reduceInstructions": "Clear instructions for combining every completed map item output into the final result.",
  "items": [
    {
      "id": "item-1",
      "title": "Short map task title",
      "prompt": "Self-contained item-specific prompt for the child chat",
      "dependsOn": ["item-0"],
      "metadata": { "optional": "JSON object" },
      "status": "pending"
    }
  ]
}

Rules:
- Produce at least one item.
- Every item id must be stable, unique, and filesystem-safe: letters, numbers, dots, underscores, or dashes only.
- Every item status must be exactly "pending".
- Item prompts must be self-contained for that item.
- Do not include sibling item results, parent progress journals, Ralph session state, timers, wakeups, or DAG workflow concepts.
- Use dependsOn only when an item truly cannot start until another listed item completes.
- Prefer independent map items so they can run in parallel.
- Set maxParallel to 3 unless the user explicitly requests a different positive integer concurrency cap.
- Write reduceInstructions that tell the reduce child chat how to aggregate every map item output into the final answer.
- Shared instructions are provided separately to child chats later; do not duplicate them verbatim unless required for the item or reduce instructions to make sense.
`.trim();

export interface MapReducePlanGenerationContext {
    workspaceId: string;
    prompt: string;
    sharedInstructions?: string;
    childMode: MapReduceChildMode;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
}

export type GenerateMapReducePlanFn = (ctx: MapReducePlanGenerationContext) => Promise<NormalizedMapReducePlan>;

export interface MapReducePlanGeneratorOptions {
    aiService: ISDKService;
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
}

function stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

export function parseMapReducePlanResponse(raw: string): NormalizedMapReducePlan {
    const jsonText = stripCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON Map Reduce plan: ${raw.slice(0, 200)}`);
    }

    return normalizeMapReducePlan(parsed);
}

export function buildMapReducePlanPrompt(ctx: MapReducePlanGenerationContext): string {
    const parts: string[] = [
        `Workspace ID: ${ctx.workspaceId}`,
        `Child chat mode for all map and reduce child chats: ${ctx.childMode}`,
        `Default max parallel map items: ${DEFAULT_MAP_REDUCE_MAX_PARALLEL}`,
        `Original user request:\n${ctx.prompt}`,
    ];
    if (ctx.sharedInstructions?.trim()) {
        parts.push(`Optional shared instructions for every map item and the reduce step:\n${ctx.sharedInstructions.trim()}`);
    }
    return parts.join('\n\n');
}

export function createMapReducePlanGenerator(options: MapReducePlanGeneratorOptions): {
    generatePlan: GenerateMapReducePlanFn;
} {
    const generatePlan: GenerateMapReducePlanFn = async (ctx) => {
        const aiService = ctx.provider && options.resolveAiServiceForProvider
            ? options.resolveAiServiceForProvider(ctx.provider)
            : options.aiService;
        const systemMessage: SystemMessageConfig = { mode: 'replace', content: SYSTEM_PROMPT };
        const result = await aiService.sendMessage({
            prompt: buildMapReducePlanPrompt(ctx),
            ...(ctx.model ? { model: ctx.model } : {}),
            ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
            timeoutMs: PLAN_TIMEOUT_MS,
            systemMessage,
        });
        if (!result.success) {
            throw new Error(result.error ?? 'AI Map Reduce plan generation failed');
        }
        return parseMapReducePlanResponse(result.response ?? '');
    };

    return { generatePlan };
}
