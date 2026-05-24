export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ToolCallPermissionRequest {
    kind: string;
    timestamp: Date;
    resource?: string;
    operation?: string;
}

export interface ToolCallPermissionResult {
    approved: boolean;
    timestamp: Date;
    reason?: string;
}

export interface ToolCall {
    id: string;
    name: string;
    status: ToolCallStatus;
    startTime: Date;
    endTime?: Date;
    args: Record<string, unknown>;
    result?: string;
    error?: string;
    parentToolCallId?: string;
    permissionRequest?: ToolCallPermissionRequest;
    permissionResult?: ToolCallPermissionResult;
}

export interface SerializedToolCall {
    id: string;
    name: string;
    status: ToolCallStatus;
    startTime: string;
    endTime?: string;
    args: Record<string, unknown>;
    result?: string;
    error?: string;
    parentToolCallId?: string;
    permissionRequest?: {
        kind: string;
        timestamp: string;
        resource?: string;
        operation?: string;
    };
    permissionResult?: {
        approved: boolean;
        timestamp: string;
        reason?: string;
    };
}
