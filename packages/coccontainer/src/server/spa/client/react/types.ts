/**
 * Shared types for the CoCContainer SPA client.
 */

export interface Agent {
    id: string;
    name: string;
    address: string;
    status: 'online' | 'offline' | 'unknown';
    lastSeenAt: string | null;
    createdAt: string;
}

export interface RemoteWorkspace {
    id: string;
    rootPath: string;
    name?: string;
    agentId?: string;
    agentName?: string;
    agentAddress?: string;
    color?: string;
    gitInfo?: {
        branch?: string;
        remote?: string;
    };
}

export interface RemoteProcess {
    id: string;
    title?: string;
    prompt?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
}

export interface ProcessDetail {
    id: string;
    title?: string;
    prompt?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    workspaceId?: string;
    turns: Turn[];
}

export interface Turn {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: string;
    toolCalls?: ToolCall[];
}

export interface ToolCall {
    name?: string;
    callId?: string;
    type?: string;
    arguments?: string;
    result?: unknown;
}

export interface SSEEnvelope {
    agentId: string;
    agentName: string;
    payload: string;
}

/** Selected context: which agent + workspace we're viewing */
export interface Selection {
    agentId: string;
    workspaceId: string;
}

/** Queue task from CoC's queue system */
export interface QueueTask {
    id: string;
    processId?: string;
    type: string;
    status: string; // queued, running, completed, failed, cancelled
    payload: {
        kind?: string;
        prompt?: string;
        workspaceId?: string;
        mode?: string;
    };
    displayName?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    result?: unknown;
    error?: string;
}
