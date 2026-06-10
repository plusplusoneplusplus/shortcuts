import type {
  ConvertDreamCardRequest,
  DismissDreamCardRequest,
  DreamCard,
  DreamCardResponse,
  DreamRunRequest,
  DreamRunResponse,
  ListDreamCardsOptions,
  ListDreamCardsResponse,
  SupersedeDreamCardRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function dreamsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/dreams${suffix}`;
}

function cardsPath(workspaceId: string, suffix = ''): string {
  return dreamsPath(workspaceId, `/cards${suffix}`);
}

function cardPath(workspaceId: string, cardId: string, suffix = ''): string {
  return cardsPath(workspaceId, `/${encodePathSegment(cardId)}${suffix}`);
}

function listQuery(options: ListDreamCardsOptions | undefined): Record<string, string | string[] | boolean | undefined> | undefined {
  if (!options) return undefined;
  return {
    includeHidden: options.includeHidden,
    status: Array.isArray(options.statuses) ? options.statuses : options.statuses,
  };
}

export class DreamsClient {
  constructor(private readonly transport: RequestAdapter) {}

  async listCards(workspaceId: string, options?: ListDreamCardsOptions): Promise<DreamCard[]> {
    const query = listQuery(options);
    const response = await this.transport.request<ListDreamCardsResponse>(
      cardsPath(workspaceId),
      query ? { query } : undefined,
    );
    return response.cards ?? [];
  }

  async getCard(workspaceId: string, cardId: string): Promise<DreamCard> {
    const response = await this.transport.request<DreamCardResponse>(cardPath(workspaceId, cardId));
    return response.card;
  }

  runNow(workspaceId: string, request: DreamRunRequest = {}): Promise<DreamRunResponse> {
    return this.transport.request<DreamRunResponse>(dreamsPath(workspaceId, '/run'), {
      method: 'POST',
      body: request,
    });
  }

  async approve(workspaceId: string, cardId: string): Promise<DreamCard> {
    const response = await this.transport.request<DreamCardResponse>(cardPath(workspaceId, cardId, '/approve'), {
      method: 'POST',
    });
    return response.card;
  }

  async dismiss(workspaceId: string, cardId: string, request: DismissDreamCardRequest = {}): Promise<DreamCard> {
    const response = await this.transport.request<DreamCardResponse>(cardPath(workspaceId, cardId, '/dismiss'), {
      method: 'POST',
      body: request,
    });
    return response.card;
  }

  async convert(workspaceId: string, cardId: string, request: ConvertDreamCardRequest): Promise<DreamCard> {
    const response = await this.transport.request<DreamCardResponse>(cardPath(workspaceId, cardId, '/convert'), {
      method: 'POST',
      body: request,
    });
    return response.card;
  }

  async markSuperseded(workspaceId: string, cardId: string, request: SupersedeDreamCardRequest): Promise<DreamCard> {
    const response = await this.transport.request<DreamCardResponse>(cardPath(workspaceId, cardId, '/supersede'), {
      method: 'POST',
      body: request,
    });
    return response.card;
  }
}
