import type {
  Canvas,
  CanvasResponse,
  CanvasSummary,
  ListCanvasesResponse,
  SaveCanvasRequest,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function canvasesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/canvases${suffix}`;
}

export class CanvasesClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string, query?: { processId?: string }): Promise<CanvasSummary[]> {
    const params = new URLSearchParams();
    if (query?.processId) params.set('processId', query.processId);
    const queryString = params.toString();
    const response = await this.transport.request<ListCanvasesResponse>(
      canvasesPath(workspaceId, queryString ? `?${queryString}` : ''),
    );
    return response.canvases ?? [];
  }

  async get(workspaceId: string, canvasId: string): Promise<Canvas> {
    const response = await this.transport.request<CanvasResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}`),
    );
    return response.canvas;
  }

  async save(workspaceId: string, canvasId: string, request: SaveCanvasRequest): Promise<Canvas> {
    const response = await this.transport.request<CanvasResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}`),
      { method: 'PUT', body: request },
    );
    return response.canvas;
  }
}
