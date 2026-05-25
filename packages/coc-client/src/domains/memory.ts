import { CocApiError } from '../errors';
import type {
  ListFactsOptions,
  MemoryConfig,
  MemoryEpisode,
  MemoryFact,
  MemoryScopeInfo,
  MemoryV2ExportData,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function memoryV2Path(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/memory/v2${suffix}`;
}

function listFactsPath(workspaceId: string, options: ListFactsOptions = {}): string {
  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (Array.isArray(options.status)) {
    options.status.forEach(status => params.append('status', status));
  } else if (options.status) {
    params.set('status', options.status);
  }
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  return `${memoryV2Path(workspaceId, '/facts')}${query ? `?${query}` : ''}`;
}

export class MemoryV2Client {
  constructor(private readonly transport: RequestAdapter) {}

  async listFacts(workspaceId: string, options: ListFactsOptions = {}): Promise<MemoryFact[]> {
    const response = await this.transport.request<{ facts: MemoryFact[] }>(listFactsPath(workspaceId, options));
    return response.facts;
  }

  async createFact(
    workspaceId: string,
    content: string,
    options: { importance?: number; tags?: string[]; sourceProcessId?: string } = {},
  ): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(memoryV2Path(workspaceId, '/facts'), {
      method: 'POST',
      body: {
        content,
        importance: options.importance,
        tags: options.tags ?? [],
        sourceProcessId: options.sourceProcessId,
      },
    });
    return response.fact;
  }

  async updateFact(
    workspaceId: string,
    factId: string,
    updates: Partial<Pick<MemoryFact, 'content' | 'importance' | 'tags' | 'status'>>,
  ): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(
      memoryV2Path(workspaceId, `/facts/${encodePathSegment(factId)}`),
      { method: 'PATCH', body: { ...updates } },
    );
    return response.fact;
  }

  async deleteFact(workspaceId: string, factId: string): Promise<void> {
    await this.transport.request<{ deleted: boolean }>(
      memoryV2Path(workspaceId, `/facts/${encodePathSegment(factId)}`),
      { method: 'DELETE' },
    );
  }

  async listReview(workspaceId: string): Promise<MemoryFact[]> {
    const response = await this.transport.request<{ facts: MemoryFact[] }>(memoryV2Path(workspaceId, '/review'));
    return response.facts;
  }

  async approveReview(workspaceId: string, factId: string, editedContent?: string): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(
      memoryV2Path(workspaceId, `/review/${encodePathSegment(factId)}/approve`),
      {
        method: 'POST',
        body: editedContent !== undefined ? { content: editedContent } : {},
      },
    );
    return response.fact;
  }

  async rejectReview(workspaceId: string, factId: string): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(
      memoryV2Path(workspaceId, `/review/${encodePathSegment(factId)}/reject`),
      { method: 'POST' },
    );
    return response.fact;
  }

  async listEpisodes(workspaceId: string, limit = 50): Promise<MemoryEpisode[]> {
    const response = await this.transport.request<{ episodes: MemoryEpisode[] }>(
      memoryV2Path(workspaceId, '/episodes'),
      { query: { limit } },
    );
    return response.episodes;
  }

  exportData(workspaceId: string): Promise<MemoryV2ExportData> {
    return this.transport.request<MemoryV2ExportData>(memoryV2Path(workspaceId, '/export'));
  }

  async wipe(workspaceId: string): Promise<void> {
    await this.transport.request<{ wiped: boolean }>(memoryV2Path(workspaceId, '/wipe'), {
      method: 'DELETE',
      body: { confirm: true },
    });
  }

  async listMemoryScopes(): Promise<MemoryScopeInfo[]> {
    const response = await this.transport.request<{ scopes: MemoryScopeInfo[] }>('/memory/v2/scopes');
    return response.scopes;
  }
}
