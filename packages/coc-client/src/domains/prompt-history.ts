import type { QueryPrimitive, RequestAdapter } from '../types';

export interface PromptHistoryListRequest {
    workspaceId: string;
    /** Number of items to return. Defaults to server default (50); clamped to [1, 200]. */
    limit?: number;
}

export interface PromptHistoryListResponse {
    /** Recent unique initial prompts in the workspace, ordered most-recent first. */
    items: string[];
}

export class PromptHistoryClient {
    constructor(private readonly transport: RequestAdapter) {}

    /**
     * Fetch the user's recent unique initial prompts in a workspace, ordered
     * most-recent first. Powers up/down arrow history navigation in chat
     * inputs. Returns `{ items: [] }` for missing/unknown workspace, server
     * errors, or stores without history support.
     */
    list(input: PromptHistoryListRequest): Promise<PromptHistoryListResponse> {
        const query: Record<string, QueryPrimitive> = {
            workspaceId: input.workspaceId,
            limit: input.limit,
        };
        return this.transport.request<PromptHistoryListResponse>('/prompt-history', {
            query,
        });
    }
}
