/**
 * Workflow Validator — structural validation for WorkflowConfig.
 *
 * Validates a workflow config for correctness before execution:
 * non-empty graph, no dangling references, no cycles, and
 * node-type-specific field requirements.
 *
 * Throws {@link WorkflowValidationError} on the first violated rule.
 */

import { PipelineCoreError } from '../errors/pipeline-core-error';
import type { ErrorCodeType } from '../errors/error-codes';
import { WorkflowErrorCode, type WorkflowErrorCodeType } from '../errors/error-codes';
import { getLogger } from '../logger';
import type { WorkflowConfig, NodeConfig } from './types';
import { buildGraph, detectCycle } from './graph';

/**
 * Typed validation error for workflow configuration problems.
 *
 * Extends {@link PipelineCoreError} so that callers can use `isPipelineCoreError`
 * checks and access `.code`, `.meta`, `.toDetailedString()` consistently.
 */
export class WorkflowValidationError extends PipelineCoreError {
    constructor(message: string, code: WorkflowErrorCodeType, meta?: Record<string, unknown>) {
        super(message, { code: code as ErrorCodeType, meta });
        this.name = 'WorkflowValidationError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Validate a workflow configuration for structural correctness.
 *
 * Rules are applied in order; the function throws on the first violation.
 * If no rules are violated the function returns normally.
 *
 * @throws {WorkflowValidationError}
 */
export function validate(config: WorkflowConfig): void {
    // Rule 1 — Non-empty nodes
    if (Object.keys(config.nodes).length === 0) {
        throw new WorkflowValidationError(
            'Workflow must contain at least one node.',
            WorkflowErrorCode.WORKFLOW_EMPTY,
        );
    }

    // Rule 2 — No dangling `from` references
    for (const [nodeId, node] of Object.entries(config.nodes)) {
        for (const ref of node.from ?? []) {
            if (!(ref in config.nodes)) {
                throw new WorkflowValidationError(
                    `Node "${nodeId}" references unknown node "${ref}" in its \`from\` array.`,
                    WorkflowErrorCode.UNKNOWN_NODE_REF,
                    { nodeId, unknownRef: ref },
                );
            }
        }
    }

    // Rule 3 — No cycles
    const graph = buildGraph(config.nodes);
    const cycle = detectCycle(graph);
    if (cycle !== null) {
        throw new WorkflowValidationError(
            `Workflow contains a cycle: ${cycle.join(' → ')}.`,
            WorkflowErrorCode.CYCLE_DETECTED,
            { cycle },
        );
    }

    // Rules 4–10 — per-node type requirements (single pass)
    const logger = getLogger();
    for (const [nodeId, node] of Object.entries(config.nodes)) {
        validateNode(nodeId, node, graph, logger);
    }
}

/**
 * Per-node validation. Called from `validate` in a single loop.
 * @internal
 */
function validateNode(
    nodeId: string,
    node: NodeConfig,
    graph: ReturnType<typeof buildGraph>,
    logger: { warn(category: string, message: string): void },
): void {
    switch (node.type) {
        case 'load':
            // Rule 4 — load nodes with parents are a warning, not an error
            if ((node.from?.length ?? 0) > 0) {
                logger.warn(
                    'Workflow',
                    `Node "${nodeId}" is a load node but declares \`from\` entries. ` +
                    `Load nodes typically have no parents; the \`from\` entries will be ignored during scheduling.`,
                );
            }
            break;

        case 'merge': {
            // Rule 5 — merge nodes need 2+ parents
            const parentCount = graph.reverseEdges.get(nodeId)?.length ?? 0;
            if (parentCount < 2) {
                throw new WorkflowValidationError(
                    `Merge node "${nodeId}" has ${parentCount} parent(s); merge nodes require at least 2.`,
                    WorkflowErrorCode.MERGE_NEEDS_MULTIPLE_PARENTS,
                    { nodeId, parentCount },
                );
            }
            break;
        }

        case 'map':
            // Rule 6 — map nodes need prompt or promptFile
            if (!node.prompt && !node.promptFile) {
                throw new WorkflowValidationError(
                    `Map node "${nodeId}" must have either \`prompt\` or \`promptFile\`.`,
                    WorkflowErrorCode.MISSING_PROMPT,
                    { nodeId },
                );
            }
            break;

        case 'filter':
            // Rule 7 — filter nodes need rule
            if (!node.rule) {
                throw new WorkflowValidationError(
                    `Filter node "${nodeId}" must have a \`rule\` configuration.`,
                    WorkflowErrorCode.MISSING_RULE,
                    { nodeId },
                );
            }
            break;

        case 'reduce':
            // Rule 8 — reduce nodes need strategy
            if (!node.strategy) {
                throw new WorkflowValidationError(
                    `Reduce node "${nodeId}" must have a \`strategy\` field.`,
                    WorkflowErrorCode.MISSING_STRATEGY,
                    { nodeId },
                );
            }
            break;

        case 'script':
            // Rule 9 — script nodes need run
            if (!node.run) {
                throw new WorkflowValidationError(
                    `Script node "${nodeId}" must have a \`run\` command.`,
                    WorkflowErrorCode.MISSING_COMMAND,
                    { nodeId },
                );
            }
            break;

        case 'ai':
            // Rule 10 — ai nodes need prompt
            if (!node.prompt) {
                throw new WorkflowValidationError(
                    `AI node "${nodeId}" must have a \`prompt\` field.`,
                    WorkflowErrorCode.MISSING_PROMPT,
                    { nodeId },
                );
            }
            break;

        case 'transform':
            // No additional validation beyond type check
            break;

        default: {
            // Exhaustive check — if a new node type is added, TypeScript will
            // error here until a case is added.
            const _exhaustive: never = node;
            throw new Error(`Unhandled node type: ${(_exhaustive as NodeConfig).type}`);
        }
    }
}
