/**
 * Container Session Types
 *
 * A container session is a meta-level chat that routes each user message
 * to the appropriate agent:repo based on context. It tracks per-turn
 * routing decisions and linked downstream process IDs.
 */

// ============================================================================
// Routing Decision
// ============================================================================

export interface RoutingDecision {
    /** Target agent ID. */
    agentId: string;
    /** Target workspace ID. */
    workspaceId: string;
    /** Confidence score (0–1). */
    confidence: number;
    /** Brief explanation of why this agent was chosen. */
    reason: string;
}

// ============================================================================
// Container Session Turn
// ============================================================================

export interface ContainerSessionTurn {
    /** Zero-based turn index. */
    index: number;
    /** 'user' or 'assistant'. */
    role: 'user' | 'assistant';
    /** Message content. */
    content: string;
    /** Routing decision for this turn (set on user turns, inherited on assistant turns). */
    routing: RoutingDecision;
    /** Downstream process ID on the target agent (created when first message routed there). */
    downstreamProcessId: string | null;
    /** ISO timestamp. */
    timestamp: string;
}

// ============================================================================
// Container Session
// ============================================================================

export type ContainerSessionStatus = 'active' | 'closed';

export interface ContainerSession {
    /** Unique session ID (e.g. `csess_<random>`). */
    id: string;
    /** Current status. */
    status: ContainerSessionStatus;
    /** Manual routing override — when set, skips the classifier. */
    routingOverride: { agentId: string; workspaceId: string } | null;
    /** ISO timestamp of creation. */
    createdAt: string;
    /** ISO timestamp of last activity. */
    updatedAt: string;
    /** Session turns (in-memory representation). */
    turns: ContainerSessionTurn[];
}

// ============================================================================
// Agent Info (for routing)
// ============================================================================

export interface ContainerAgentInfo {
    /** Agent ID. */
    id: string;
    /** Agent display name. */
    name: string;
    /** Workspaces managed by this agent. */
    workspaces: Array<{
        id: string;
        name: string;
        rootPath: string;
        description?: string;
    }>;
}
