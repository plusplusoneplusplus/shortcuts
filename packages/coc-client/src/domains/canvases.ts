import type {
  AddCanvasCommentRequest,
  Canvas,
  CanvasExtension,
  CanvasExtensionResponse,
  CanvasComment,
  CanvasCommentResponse,
  CanvasCommentStatus,
  CanvasResponse,
  CanvasSummary,
  CanvasVersion,
  CanvasVersionMeta,
  CanvasVersionResponse,
  CreateCanvasRequest,
  ListCanvasCommentsResponse,
  ListCanvasesResponse,
  ListCanvasVersionsResponse,
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

  /**
   * Create a new canvas (AC-07 manual Kusto create). The server gates
   * this on the Kusto feature flag and currently accepts only
   * `type: 'kusto'`.
   */
  async create(workspaceId: string, request: CreateCanvasRequest): Promise<Canvas> {
    const response = await this.transport.request<CanvasResponse>(
      canvasesPath(workspaceId),
      { method: 'POST', body: request },
    );
    return response.canvas;
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

  /**
   * Run a Kusto canvas's query server-side (AC-02/AC-04). Optional
   * overrides update the stored query/cluster/database before executing. The
   * updated canvas (with fresh columns/rows/lastRun) is returned.
   */
  async run(
    workspaceId: string,
    canvasId: string,
    overrides?: { query?: string; clusterUrl?: string; database?: string },
  ): Promise<Canvas> {
    const response = await this.transport.request<CanvasResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/run`),
      { method: 'POST', body: overrides ?? {} },
    );
    return response.canvas;
  }

  async listVersions(workspaceId: string, canvasId: string): Promise<CanvasVersionMeta[]> {
    const response = await this.transport.request<ListCanvasVersionsResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/versions`),
    );
    return response.versions ?? [];
  }

  async getVersion(workspaceId: string, canvasId: string, revision: number): Promise<CanvasVersion> {
    const response = await this.transport.request<CanvasVersionResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/versions/${revision}`),
    );
    return response.version;
  }

  async listComments(workspaceId: string, canvasId: string, query?: { status?: CanvasCommentStatus }): Promise<CanvasComment[]> {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    const queryString = params.toString();
    const response = await this.transport.request<ListCanvasCommentsResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/comments${queryString ? `?${queryString}` : ''}`),
    );
    return response.comments ?? [];
  }

  async addComment(workspaceId: string, canvasId: string, request: AddCanvasCommentRequest): Promise<CanvasComment> {
    const response = await this.transport.request<CanvasCommentResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/comments`),
      { method: 'POST', body: request },
    );
    return response.comment;
  }

  async setCommentStatus(workspaceId: string, canvasId: string, commentId: string, status: CanvasCommentStatus): Promise<CanvasComment> {
    const response = await this.transport.request<CanvasCommentResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/comments/${encodePathSegment(commentId)}`),
      { method: 'PATCH', body: { status } },
    );
    return response.comment;
  }

  async deleteComment(workspaceId: string, canvasId: string, commentId: string): Promise<void> {
    await this.transport.request(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/comments/${encodePathSegment(commentId)}`),
      { method: 'DELETE' },
    );
  }

  async getExtension(workspaceId: string, canvasId: string): Promise<CanvasExtension> {
    const response = await this.transport.request<CanvasExtensionResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/extension`),
    );
    return response.extension;
  }

  async invokeCapability(workspaceId: string, canvasId: string, capability: string, params?: Record<string, unknown>): Promise<Canvas> {
    const response = await this.transport.request<CanvasResponse>(
      canvasesPath(workspaceId, `/${encodePathSegment(canvasId)}/capabilities/${encodePathSegment(capability)}`),
      { method: 'POST', body: { params: params ?? {} } },
    );
    return response.canvas;
  }
}
