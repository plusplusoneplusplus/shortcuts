import type { QueryPrimitive, RequestAdapter } from '../types';

export interface PromptCompletionResponse {
    /** Best inline completion suffix to append after the typed prefix, or null. */
    completion: string | null;
    /** Whether the suggestion was AI-generated or came from deterministic history fallback. */
    source?: 'ai' | 'history';
    /** Historical source used when `source` is `history`. */
    historySource?: 'initial' | 'follow-up';
}

export interface PromptCompletionRequest {
    prefix: string;
    workspaceId?: string;
    processId?: string;
    surface?: 'queue' | 'follow-up';
    mode?: 'hybrid' | 'ai' | 'history';
}

export class SuggestionsClient {
  constructor(private readonly transport: RequestAdapter) {}

  /**
   * Fetch the single best inline completion for the given typed prefix.
   * The server returns `{ completion: null }` when nothing matches, the
   * feature is disabled by global preference, or the prefix is too short.
   */
  promptCompletion(input: string | PromptCompletionRequest): Promise<PromptCompletionResponse> {
    const query: Record<string, QueryPrimitive> = typeof input === 'string'
      ? { prefix: input }
      : {
        prefix: input.prefix,
        workspaceId: input.workspaceId,
        processId: input.processId,
        surface: input.surface,
        mode: input.mode,
      };
    return this.transport.request<PromptCompletionResponse>('/prompt-suggestions', {
      query,
    });
  }
}
