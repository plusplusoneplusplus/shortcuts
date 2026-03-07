/**
 * Workflow Executor — tier-by-tier DAG orchestration.
 *
 * Validates, builds the graph, schedules tiers, and dispatches each node
 * to the appropriate node executor. Produces a {@link WorkflowResult}.
 */

import { validate } from './validator';
import { buildGraph } from './graph';
import { schedule } from './scheduler';
import { executeMerge } from './nodes/merge';
import { executeTransform } from './nodes/transform';
import { executeLoad } from './nodes/load';
import { executeScript } from './nodes/script';
import { executeFilter } from './nodes/filter';
import { executeMap } from './nodes/map';
import { executeReduce } from './nodes/reduce';
import { executeAI } from './nodes/ai';
import { getLogger, LogCategory } from '../logger';
import type {
    WorkflowConfig, WorkflowExecutionOptions, WorkflowSettings, WorkflowResult,
    NodeResult, Items,
} from './types';
import type { WorkflowContext } from './context';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Merge workflow-level settings into execution options.
 * Caller-provided values take precedence over settings.
 */
function applySettingsDefaults(
    settings: WorkflowSettings | undefined,
    options: WorkflowExecutionOptions,
): WorkflowExecutionOptions {
    if (!settings) return options;
    return {
        ...options,
        model: options.model ?? settings.model,
        concurrency: options.concurrency ?? settings.concurrency,
        timeoutMs: options.timeoutMs ?? settings.timeoutMs,
        workingDirectory: options.workingDirectory ?? settings.workingDirectory,
    };
}

class CancellationError extends Error {
    constructor() {
        super('Workflow execution was cancelled');
        this.name = 'CancellationError';
    }
}

function gatherInputs(parentIds: string[], results: Map<string, NodeResult>): Items {
    return parentIds.flatMap(id => results.get(id)?.items ?? []);
}

function gatherInputsPerParent(parentIds: string[], results: Map<string, NodeResult>): Items[] {
    return parentIds.map(id => results.get(id)?.items ?? []);
}

// ---------------------------------------------------------------------------
// Node dispatch
// ---------------------------------------------------------------------------

async function executeNode(
    nodeId: string,
    ctx: WorkflowContext,
): Promise<void> {
    const nodeConfig = ctx.config.nodes[nodeId];
    const nodeStartTime = Date.now();
    const parentIds = nodeConfig.from ?? [];
    const inputs = gatherInputs(parentIds, ctx.results);

    // Emit 'running' event
    ctx.options.onProgress?.({
        nodeId,
        phase: 'running',
        timestamp: new Date().toISOString(),
        inputItemCount: inputs.length,
    });
    getLogger().debug(LogCategory.PIPELINE, `[Workflow] Node start: ${nodeId} (type=${nodeConfig.type})`);

    // Set currentNodeId so sub-node executors (map) can emit per-item progress
    const nodeOptions = { ...ctx.options, currentNodeId: nodeId };

    try {
        let output: Items;

        switch (nodeConfig.type) {
            case 'load':
                output = await executeLoad(nodeConfig, nodeOptions);
                break;
            case 'script':
                output = await executeScript(nodeConfig, inputs, nodeOptions);
                break;
            case 'filter':
                output = await executeFilter(nodeConfig, inputs, nodeOptions);
                break;
            case 'map':
                output = await executeMap(nodeConfig, inputs, nodeOptions);
                break;
            case 'reduce':
                output = await executeReduce(nodeConfig, inputs, nodeOptions);
                break;
            case 'merge':
                output = executeMerge(nodeConfig, gatherInputsPerParent(parentIds, ctx.results));
                break;
            case 'transform':
                output = executeTransform(nodeConfig, inputs);
                break;
            case 'ai':
                output = await executeAI(nodeConfig, inputs, nodeOptions);
                break;
            default:
                throw new Error(`Unknown node type: ${(nodeConfig as any).type}`);
        }

        const durationMs = Date.now() - nodeStartTime;
        ctx.results.set(nodeId, {
            nodeId,
            success: true,
            items: output,
            stats: {
                durationMs,
                inputCount: inputs.length,
                outputCount: output.length,
            },
        });

        // Emit 'completed' event
        ctx.options.onProgress?.({
            nodeId,
            phase: 'completed',
            timestamp: new Date().toISOString(),
            durationMs,
            inputItemCount: inputs.length,
            outputItemCount: output.length,
        });
        getLogger().debug(
            LogCategory.PIPELINE,
            `[Workflow] Node complete: ${nodeId} (out=${output.length}, ms=${durationMs})`,
        );
    } catch (err) {
        const durationMs = Date.now() - nodeStartTime;
        if (nodeConfig.onError === 'warn') {
            const msg = err instanceof Error ? err.message : String(err);
            getLogger().warn(LogCategory.PIPELINE, `[Workflow] Node warn: ${nodeId} — ${msg}`);
            ctx.results.set(nodeId, {
                nodeId,
                success: false,
                items: [],
                stats: {
                    durationMs,
                    inputCount: inputs.length,
                    outputCount: 0,
                },
                error: msg,
            });
            // Emit 'warned' event
            ctx.options.onProgress?.({
                nodeId,
                phase: 'warned',
                timestamp: new Date().toISOString(),
                durationMs,
                inputItemCount: inputs.length,
                error: msg,
            });
        } else {
            getLogger().error(
                LogCategory.PIPELINE,
                `[Workflow] Node error: ${nodeId}`,
                err instanceof Error ? err : new Error(String(err)),
            );
            // Emit 'failed' event
            ctx.options.onProgress?.({
                nodeId,
                phase: 'failed',
                timestamp: new Date().toISOString(),
                durationMs,
                inputItemCount: inputs.length,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a complete workflow: validate → build graph → schedule → run tiers.
 *
 * @throws {WorkflowValidationError} if the config is structurally invalid.
 * @throws {CancellationError} if cancelled via `options.signal`.
 */
export async function executeWorkflow(
    config: WorkflowConfig,
    options: WorkflowExecutionOptions,
): Promise<WorkflowResult> {
    const startTime = Date.now();

    // 1. Validate — throws WorkflowValidationError on structural problems
    validate(config);

    // 1b. Merge settings defaults and parameters into options
    const mergedParams = (config.parameters || options.parameters)
        ? { ...config.parameters, ...options.parameters }
        : undefined;
    const effectiveOptions = applySettingsDefaults(config.settings, {
        ...options,
        ...(mergedParams ? { parameters: mergedParams } : {}),
    });

    // 2. Build graph and derive execution schedule
    const graph = buildGraph(config.nodes);
    const tiers = schedule(graph);

    getLogger().info(
        LogCategory.PIPELINE,
        `[Workflow] Starting "${config.name}" — ${Object.keys(config.nodes).length} nodes, ${tiers.length} tiers`,
    );

    // 3. Shared execution context
    const ctx: WorkflowContext = {
        config,
        options: effectiveOptions,
        results: new Map(),
        tiers,
        startTime,
    };

    // 4. Execute tiers sequentially; nodes within a tier run in parallel
    for (let i = 0; i < tiers.length; i++) {
        const tier = tiers[i];

        // Cancellation check — before starting any new tier
        if (effectiveOptions.signal?.aborted) {
            throw new CancellationError();
        }

        getLogger().info(LogCategory.PIPELINE, `[Workflow] Tier ${i + 1}/${tiers.length}: [${tier.join(', ')}]`);

        await Promise.all(tier.map(nodeId => executeNode(nodeId, ctx)));

        getLogger().info(
            LogCategory.PIPELINE,
            `[Workflow] Tier ${i + 1} complete (elapsed ${Date.now() - startTime}ms)`,
        );
    }

    // 5. Identify leaf nodes (nodes with no successors) as the primary output
    const leaves = new Map(
        graph.leaves.map(id => [id, ctx.results.get(id)!]),
    );

    const totalDurationMs = Date.now() - startTime;
    getLogger().info(
        LogCategory.PIPELINE,
        `[Workflow] "${config.name}" complete — ${totalDurationMs}ms, ${ctx.results.size} nodes executed`,
    );

    return {
        success: true,
        results: ctx.results,
        leaves,
        tiers,
        totalDurationMs,
    };
}
