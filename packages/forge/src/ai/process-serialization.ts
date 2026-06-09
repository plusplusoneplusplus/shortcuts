/**
 * AI process serialization / deserialization helpers.
 *
 * Converts between the in-memory `AIProcess` domain object (which uses `Date`
 * instances) and the `SerializedAIProcess` wire format (which uses ISO strings)
 * for persistence in SQLite / JSON stores.
 */

import type { AIProcess, SerializedAIProcess, TrackedProcessFields } from './process-interfaces';

/**
 * Convert AIProcess to serialized format for storage
 */
export function serializeProcess(process: AIProcess & Partial<TrackedProcessFields>): SerializedAIProcess {
    return {
        id: process.id,
        type: process.type,
        promptPreview: process.promptPreview,
        fullPrompt: process.fullPrompt,
        status: process.status,
        startTime: process.startTime.toISOString(),
        endTime: process.endTime?.toISOString(),
        error: process.error,
        result: process.result,
        resultFilePath: process.resultFilePath,
        rawStdoutFilePath: process.rawStdoutFilePath,
        metadata: process.metadata,
        groupMetadata: process.groupMetadata,
        codeReviewMetadata: process.codeReviewMetadata,
        discoveryMetadata: process.discoveryMetadata,
        codeReviewGroupMetadata: process.codeReviewGroupMetadata,
        structuredResult: process.structuredResult,
        parentProcessId: process.parentProcessId,
        // Session resume fields
        sdkSessionId: process.sdkSessionId,
        backend: process.backend,
        workingDirectory: process.workingDirectory,
        // Title
        title: process.title,
        customTitle: process.customTitle,
        lastMessagePreview: process.lastMessagePreview,
        // Conversation turns (Date → ISO string)
        conversationTurns: process.conversationTurns?.map(turn => ({
            role: turn.role,
            content: turn.content,
            timestamp: turn.timestamp.toISOString(),
            turnIndex: turn.turnIndex,
            streaming: turn.streaming,
            interrupted: turn.interrupted,
            interruptionReason: turn.interruptionReason,
            toolCalls: turn.toolCalls?.map(tc => ({
                id: tc.id,
                name: tc.name,
                status: tc.status,
                startTime: tc.startTime.toISOString(),
                endTime: tc.endTime?.toISOString(),
                args: tc.args,
                result: tc.result,
                error: tc.error,
                ...(tc.parentToolCallId ? { parentToolCallId: tc.parentToolCallId } : {}),
                permissionRequest: tc.permissionRequest ? {
                    kind: tc.permissionRequest.kind,
                    timestamp: tc.permissionRequest.timestamp.toISOString(),
                    resource: tc.permissionRequest.resource,
                    operation: tc.permissionRequest.operation
                } : undefined,
                permissionResult: tc.permissionResult ? {
                    approved: tc.permissionResult.approved,
                    timestamp: tc.permissionResult.timestamp.toISOString(),
                    reason: tc.permissionResult.reason
                } : undefined
            })),
            timeline: (turn.timeline ?? []).map(item => ({
                type: item.type,
                timestamp: item.timestamp.toISOString(),
                content: item.content,
                toolCall: item.toolCall ? {
                    id: item.toolCall.id,
                    name: item.toolCall.name,
                    status: item.toolCall.status,
                    startTime: item.toolCall.startTime.toISOString(),
                    endTime: item.toolCall.endTime?.toISOString(),
                    args: item.toolCall.args,
                    result: item.toolCall.result,
                    error: item.toolCall.error,
                    ...(item.toolCall.parentToolCallId ? { parentToolCallId: item.toolCall.parentToolCallId } : {}),
                    permissionRequest: item.toolCall.permissionRequest ? {
                        kind: item.toolCall.permissionRequest.kind,
                        timestamp: item.toolCall.permissionRequest.timestamp.toISOString(),
                        resource: item.toolCall.permissionRequest.resource,
                        operation: item.toolCall.permissionRequest.operation
                    } : undefined,
                    permissionResult: item.toolCall.permissionResult ? {
                        approved: item.toolCall.permissionResult.approved,
                        timestamp: item.toolCall.permissionResult.timestamp.toISOString(),
                        reason: item.toolCall.permissionResult.reason
                    } : undefined
                } : undefined
            })),
            images: turn.images,
            suggestions: turn.suggestions,
            tokenUsage: turn.tokenUsage,
            pasteExternalized: turn.pasteExternalized,
            model: turn.model,
            deletedAt: turn.deletedAt?.toISOString(),
            pinnedAt: turn.pinnedAt?.toISOString(),
            archived: turn.archived,
        })),
        // Context window tracking fields
        tokenLimit: process.tokenLimit,
        currentTokens: process.currentTokens,
        systemTokens: process.systemTokens,
        toolDefinitionsTokens: process.toolDefinitionsTokens,
        conversationTokens: process.conversationTokens,
        cumulativeTokenUsage: process.cumulativeTokenUsage,
        // Pending messages (plain JSON, no Date conversion needed)
        pendingMessages: process.pendingMessages,
        pendingAskUser: process.pendingAskUser,
        // Last event timestamp
        lastEventAt: process.lastEventAt?.toISOString(),
    };
}

/**
 * Convert serialized format back to AIProcess
 */
export function deserializeProcess(serialized: SerializedAIProcess): AIProcess {
    return {
        id: serialized.id,
        type: serialized.type || 'clarification',
        promptPreview: serialized.promptPreview,
        fullPrompt: serialized.fullPrompt,
        status: serialized.status,
        startTime: new Date(serialized.startTime),
        endTime: serialized.endTime ? new Date(serialized.endTime) : undefined,
        error: serialized.error,
        result: serialized.result,
        resultFilePath: serialized.resultFilePath,
        rawStdoutFilePath: serialized.rawStdoutFilePath,
        metadata: serialized.metadata,
        groupMetadata: serialized.groupMetadata,
        codeReviewMetadata: serialized.codeReviewMetadata,
        discoveryMetadata: serialized.discoveryMetadata,
        codeReviewGroupMetadata: serialized.codeReviewGroupMetadata,
        structuredResult: serialized.structuredResult,
        parentProcessId: serialized.parentProcessId,
        // Session resume fields
        sdkSessionId: serialized.sdkSessionId,
        backend: serialized.backend,
        workingDirectory: serialized.workingDirectory,
        // Title
        title: serialized.title,
        customTitle: serialized.customTitle,
        lastMessagePreview: serialized.lastMessagePreview,
        conversationTurns: serialized.conversationTurns?.map(turn => ({
            role: turn.role,
            content: turn.content,
            timestamp: new Date(turn.timestamp),
            turnIndex: turn.turnIndex,
            streaming: turn.streaming,
            interrupted: turn.interrupted,
            interruptionReason: turn.interruptionReason,
            toolCalls: turn.toolCalls?.map(tc => ({
                id: tc.id,
                name: tc.name,
                status: tc.status,
                startTime: new Date(tc.startTime),
                endTime: tc.endTime ? new Date(tc.endTime) : undefined,
                args: tc.args,
                result: tc.result,
                error: tc.error,
                parentToolCallId: tc.parentToolCallId,
                permissionRequest: tc.permissionRequest ? {
                    kind: tc.permissionRequest.kind,
                    timestamp: new Date(tc.permissionRequest.timestamp),
                    resource: tc.permissionRequest.resource,
                    operation: tc.permissionRequest.operation
                } : undefined,
                permissionResult: tc.permissionResult ? {
                    approved: tc.permissionResult.approved,
                    timestamp: new Date(tc.permissionResult.timestamp),
                    reason: tc.permissionResult.reason
                } : undefined
            })),
            timeline: (turn.timeline ?? []).map(item => ({
                type: item.type,
                timestamp: new Date(item.timestamp),
                content: item.content,
                toolCall: item.toolCall ? {
                    id: item.toolCall.id,
                    name: item.toolCall.name,
                    status: item.toolCall.status,
                    startTime: new Date(item.toolCall.startTime),
                    endTime: item.toolCall.endTime ? new Date(item.toolCall.endTime) : undefined,
                    args: item.toolCall.args,
                    result: item.toolCall.result,
                    error: item.toolCall.error,
                    parentToolCallId: item.toolCall.parentToolCallId,
                    permissionRequest: item.toolCall.permissionRequest ? {
                        kind: item.toolCall.permissionRequest.kind,
                        timestamp: new Date(item.toolCall.permissionRequest.timestamp),
                        resource: item.toolCall.permissionRequest.resource,
                        operation: item.toolCall.permissionRequest.operation
                    } : undefined,
                    permissionResult: item.toolCall.permissionResult ? {
                        approved: item.toolCall.permissionResult.approved,
                        timestamp: new Date(item.toolCall.permissionResult.timestamp),
                        reason: item.toolCall.permissionResult.reason
                    } : undefined
                } : undefined
            })),
            images: turn.images,
            suggestions: turn.suggestions,
            tokenUsage: turn.tokenUsage,
            pasteExternalized: turn.pasteExternalized,
            model: turn.model,
            deletedAt: turn.deletedAt ? new Date(turn.deletedAt) : undefined,
            pinnedAt: turn.pinnedAt ? new Date(turn.pinnedAt) : undefined,
            archived: turn.archived,
        })),
        // Context window tracking fields
        tokenLimit: serialized.tokenLimit,
        currentTokens: serialized.currentTokens,
        systemTokens: serialized.systemTokens,
        toolDefinitionsTokens: serialized.toolDefinitionsTokens,
        conversationTokens: serialized.conversationTokens,
        cumulativeTokenUsage: serialized.cumulativeTokenUsage,
        // Pending messages (plain JSON, no Date conversion needed)
        pendingMessages: serialized.pendingMessages,
        pendingAskUser: serialized.pendingAskUser,
        // Last event timestamp
        lastEventAt: serialized.lastEventAt ? new Date(serialized.lastEventAt) : undefined,
    };
}
