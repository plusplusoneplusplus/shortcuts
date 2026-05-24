/**
 * Container Session Routing Classifier
 *
 * Determines which agent:workspace should handle a user message based on
 * message content, conversation history, and available agents.
 *
 * Strategy:
 * 1. If a routing override is set, use it immediately (confidence 1.0).
 * 2. Otherwise, call the LLM with a concise system prompt listing agents/repos.
 * 3. If the LLM's confidence is below threshold, fall back to the last-used route.
 */

import type { RoutingDecision, ContainerAgentInfo, ContainerSessionTurn } from './container-session-types';

// ============================================================================
// Types
// ============================================================================

export interface RoutingClassifierOptions {
    /** Available agents with their workspaces. */
    agents: ContainerAgentInfo[];
    /** Conversation history (recent turns for context). */
    history: ContainerSessionTurn[];
    /** User's new message. */
    message: string;
    /** Manual override (if set, skip classification). */
    override?: { agentId: string; workspaceId: string } | null;
}

export interface RoutingClassifierDeps {
    /** Invoke the LLM for routing classification. Returns raw text response. */
    invokeClassifier: (systemPrompt: string, userPrompt: string) => Promise<string>;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum confidence to accept a routing decision. Below this, fall back. */
const CONFIDENCE_THRESHOLD = 0.5;

/** Maximum history turns to include in the classifier prompt. */
const MAX_HISTORY_TURNS = 6;

// ============================================================================
// Classifier
// ============================================================================

/**
 * Classify which agent:workspace should handle the user's message.
 */
export async function classifyRouting(
    options: RoutingClassifierOptions,
    deps: RoutingClassifierDeps,
): Promise<RoutingDecision> {
    const { agents, history, message, override } = options;

    // Fast path: manual override
    if (override?.agentId && override?.workspaceId) {
        return {
            agentId: override.agentId,
            workspaceId: override.workspaceId,
            confidence: 1.0,
            reason: 'Manual override',
        };
    }

    // If only one agent with one workspace, skip LLM
    const allWorkspaces = agents.flatMap(a => a.workspaces.map(w => ({ agentId: a.id, ...w })));
    if (allWorkspaces.length === 1) {
        const only = allWorkspaces[0];
        return {
            agentId: only.agentId,
            workspaceId: only.id,
            confidence: 1.0,
            reason: `Only one workspace available: ${only.name}`,
        };
    }

    if (allWorkspaces.length === 0) {
        throw new Error('No agents or workspaces available for routing');
    }

    // Build classifier prompt
    const systemPrompt = buildSystemPrompt(agents);
    const userPrompt = buildUserPrompt(message, history);

    // Call LLM
    const rawResponse = await deps.invokeClassifier(systemPrompt, userPrompt);

    // Parse response
    const decision = parseClassifierResponse(rawResponse, agents);

    // If confidence is below threshold, fall back to last-used route
    if (decision.confidence < CONFIDENCE_THRESHOLD) {
        const fallback = getLastUsedRoute(history);
        if (fallback) {
            return { ...fallback, confidence: 0.6, reason: `Low confidence (${decision.confidence.toFixed(2)}); using last-used route` };
        }
    }

    return decision;
}

// ============================================================================
// Prompt Building
// ============================================================================

function buildSystemPrompt(agents: ContainerAgentInfo[]): string {
    const agentList = agents.map(a => {
        const workspaces = a.workspaces.map(w =>
            `  - workspace_id: "${w.id}", name: "${w.name}", path: "${w.rootPath}"${w.description ? `, description: "${w.description}"` : ''}`,
        ).join('\n');
        return `Agent "${a.name}" (id: "${a.id}"):\n${workspaces}`;
    }).join('\n\n');

    return `You are a routing classifier for a multi-agent system. Your job is to decide which agent and workspace should handle the user's message.

Available agents and their workspaces:
${agentList}

Respond with EXACTLY one line in this format:
ROUTE: agent_id=<agent_id> workspace_id=<workspace_id> confidence=<0.0-1.0> reason=<brief reason>

Rules:
- Pick the most relevant workspace based on the message content and conversation context.
- If the message mentions a specific project, repo, or file path, route to the matching workspace.
- If ambiguous, pick the workspace most recently discussed in the history.
- Confidence should reflect how certain you are (1.0 = perfect match, 0.5 = uncertain).`;
}

function buildUserPrompt(message: string, history: ContainerSessionTurn[]): string {
    const recentHistory = history.slice(-MAX_HISTORY_TURNS);
    const historyText = recentHistory.length > 0
        ? 'Recent conversation:\n' + recentHistory.map(t =>
            `[${t.role}→${t.routing.agentId}/${t.routing.workspaceId}] ${t.content.slice(0, 200)}`,
        ).join('\n') + '\n\n'
        : '';

    return `${historyText}New message from user:\n${message}`;
}

// ============================================================================
// Response Parsing
// ============================================================================

const ROUTE_PATTERN = /ROUTE:\s*agent_id=([^\s]+)\s+workspace_id=([^\s]+)\s+confidence=([\d.]+)\s+reason=(.+)/i;

export function parseClassifierResponse(
    response: string,
    agents: ContainerAgentInfo[],
): RoutingDecision {
    const match = response.match(ROUTE_PATTERN);
    if (!match) {
        // Fall back to first available workspace
        const first = agents[0];
        const ws = first.workspaces[0];
        return {
            agentId: first.id,
            workspaceId: ws.id,
            confidence: 0.3,
            reason: 'Could not parse classifier response; defaulting to first workspace',
        };
    }

    const [, agentId, workspaceId, confidenceStr, reason] = match;
    const confidence = Math.min(1.0, Math.max(0.0, parseFloat(confidenceStr) || 0.5));

    // Validate that the agent/workspace exist
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
        return {
            agentId: agents[0].id,
            workspaceId: agents[0].workspaces[0].id,
            confidence: 0.3,
            reason: `Agent "${agentId}" not found; defaulting`,
        };
    }

    const workspace = agent.workspaces.find(w => w.id === workspaceId);
    if (!workspace) {
        return {
            agentId: agent.id,
            workspaceId: agent.workspaces[0]?.id ?? agents[0].workspaces[0].id,
            confidence: 0.4,
            reason: `Workspace "${workspaceId}" not found on agent "${agentId}"; using first`,
        };
    }

    return { agentId, workspaceId, confidence, reason: reason.trim() };
}

// ============================================================================
// Fallback
// ============================================================================

function getLastUsedRoute(history: ContainerSessionTurn[]): RoutingDecision | null {
    for (let i = history.length - 1; i >= 0; i--) {
        const turn = history[i];
        if (turn.routing.agentId && turn.routing.workspaceId) {
            return {
                agentId: turn.routing.agentId,
                workspaceId: turn.routing.workspaceId,
                confidence: turn.routing.confidence,
                reason: turn.routing.reason,
            };
        }
    }
    return null;
}
