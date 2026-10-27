import type {
  MarkUnseenResponse,
  SeenStateEntry,
  SeenStateMap,
  UnseenCountResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function seenStatePath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/seen-state${suffix}`;
}

export class SeenStateClient {
  constructor(private readonly transport: RequestAdapter) {}

  getMap(workspaceId: string): Promise<SeenStateMap> {
    return this.transport.request<SeenStateMap>(seenStatePath(workspaceId));
  }

  updateMany(workspaceId: string, entries: SeenStateEntry[], options?: Pick<CocRequestOptions, 'signal'>): Promise<SeenStateMap> {
    return this.transport.request<SeenStateMap>(seenStatePath(workspaceId), {
      method: 'PATCH',
      body: { entries: entries.map(entry => ({ ...entry })) },
      signal: options?.signal,
    });
  }

  markUnseen(workspaceId: string, processId: string): Promise<MarkUnseenResponse> {
    return this.transport.request<MarkUnseenResponse>(
      seenStatePath(workspaceId, `/${encodePathSegment(processId)}`),
      { method: 'DELETE' },
    );
  }

  getUnseenCount(workspaceId: string): Promise<UnseenCountResponse> {
    return this.transport.request<UnseenCountResponse>(seenStatePath(workspaceId, '/count'));
  }
}
