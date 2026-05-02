import type {
  CreateWikiRequest,
  CreateWikiResponse,
  UpdateWikiRequest,
  WikiAdminResourceKind,
  WikiAdminResourceResponse,
  WikiAdminResourceUpdateResponse,
  WikiAskRequest,
  WikiAskSessionDeleteResponse,
  WikiComponentDetail,
  WikiComponentGraph,
  WikiComponentSummary,
  WikiExploreRequest,
  WikiGenerateCancelResponse,
  WikiGenerateRequest,
  WikiGenerateStatusResponse,
  WikiListResponse,
  WikiMutationResponse,
  WikiPage,
  WikiSummary,
  WikiThemeArticleDetail,
  WikiThemeDetail,
  WikiThemeMeta,
} from '../contracts';
import type { CocRequestOptions, NormalizedCocClientOptions, RequestAdapter } from '../types';
import { buildApiUrl, encodePathSegment } from '../url';

export interface WikiStreamOptions {
  signal?: AbortSignal;
}

function normalizeWikiList(response: WikiListResponse): WikiSummary[] {
  return Array.isArray(response) ? response : response.wikis;
}

function adminPath(wikiId: string, suffix: string): string {
  return `/wikis/${encodePathSegment(wikiId)}/admin${suffix}`;
}

export class WikiClient {
  constructor(
    private readonly transport: RequestAdapter,
    private readonly options: NormalizedCocClientOptions,
  ) {}

  async list(): Promise<WikiSummary[]> {
    return normalizeWikiList(await this.transport.request<WikiListResponse>('/wikis'));
  }

  create(request: CreateWikiRequest): Promise<CreateWikiResponse> {
    return this.transport.request<CreateWikiResponse>('/wikis', { method: 'POST', body: { ...request } });
  }

  get(wikiId: string): Promise<WikiSummary> {
    return this.transport.request<WikiSummary>(`/wikis/${encodePathSegment(wikiId)}`);
  }

  update(wikiId: string, request: UpdateWikiRequest): Promise<WikiMutationResponse> {
    return this.transport.request<WikiMutationResponse>(`/wikis/${encodePathSegment(wikiId)}`, {
      method: 'PATCH',
      body: { ...request },
    });
  }

  delete(wikiId: string): Promise<WikiMutationResponse> {
    return this.transport.request<WikiMutationResponse>(`/wikis/${encodePathSegment(wikiId)}`, { method: 'DELETE' });
  }

  graph(wikiId: string): Promise<WikiComponentGraph> {
    return this.transport.request<WikiComponentGraph>(`/wikis/${encodePathSegment(wikiId)}/graph`);
  }

  components(wikiId: string): Promise<WikiComponentSummary[]> {
    return this.transport.request<WikiComponentSummary[]>(`/wikis/${encodePathSegment(wikiId)}/components`);
  }

  component(wikiId: string, componentId: string): Promise<WikiComponentDetail> {
    return this.transport.request<WikiComponentDetail>(`/wikis/${encodePathSegment(wikiId)}/components/${encodePathSegment(componentId)}`);
  }

  page(wikiId: string, key: string): Promise<WikiPage> {
    return this.transport.request<WikiPage>(`/wikis/${encodePathSegment(wikiId)}/pages/${encodePathSegment(key)}`);
  }

  themes(wikiId: string): Promise<WikiThemeMeta[]> {
    return this.transport.request<WikiThemeMeta[]>(`/wikis/${encodePathSegment(wikiId)}/themes`);
  }

  theme(wikiId: string, themeId: string): Promise<WikiThemeDetail> {
    return this.transport.request<WikiThemeDetail>(`/wikis/${encodePathSegment(wikiId)}/themes/${encodePathSegment(themeId)}`);
  }

  themeArticle(wikiId: string, themeId: string, slug: string): Promise<WikiThemeArticleDetail> {
    return this.transport.request<WikiThemeArticleDetail>(
      `/wikis/${encodePathSegment(wikiId)}/themes/${encodePathSegment(themeId)}/${encodePathSegment(slug)}`,
    );
  }

  askStream(wikiId: string, request: WikiAskRequest, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(`/wikis/${encodePathSegment(wikiId)}/ask`, request, options);
  }

  deleteAskSession(wikiId: string, sessionId: string): Promise<WikiAskSessionDeleteResponse> {
    return this.transport.request<WikiAskSessionDeleteResponse>(
      `/wikis/${encodePathSegment(wikiId)}/ask/session/${encodePathSegment(sessionId)}`,
      { method: 'DELETE' },
    );
  }

  exploreStream(wikiId: string, componentId: string, request: WikiExploreRequest = {}, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(`/wikis/${encodePathSegment(wikiId)}/explore/${encodePathSegment(componentId)}`, request, options);
  }

  getAdminResource(wikiId: string, kind: WikiAdminResourceKind): Promise<WikiAdminResourceResponse> {
    return this.transport.request<WikiAdminResourceResponse>(adminPath(wikiId, `/${kind}`));
  }

  updateAdminResource(wikiId: string, kind: WikiAdminResourceKind, content: string): Promise<WikiAdminResourceUpdateResponse> {
    return this.transport.request<WikiAdminResourceUpdateResponse>(adminPath(wikiId, `/${kind}`), {
      method: 'PUT',
      body: { content },
    });
  }

  generateSeedsStream(wikiId: string, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(adminPath(wikiId, '/seeds/generate'), {}, options);
  }

  generateStatus(wikiId: string): Promise<WikiGenerateStatusResponse> {
    return this.transport.request<WikiGenerateStatusResponse>(adminPath(wikiId, '/generate/status'));
  }

  startGenerateStream(wikiId: string, request: WikiGenerateRequest, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(adminPath(wikiId, '/generate'), request, options);
  }

  cancelGenerate(wikiId: string): Promise<WikiGenerateCancelResponse> {
    return this.transport.request<WikiGenerateCancelResponse>(adminPath(wikiId, '/generate/cancel'), { method: 'POST' });
  }

  regenerateComponentStream(wikiId: string, componentId: string, request: WikiGenerateRequest = {}, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(adminPath(wikiId, `/generate/component/${encodePathSegment(componentId)}`), request, options);
  }

  standaloneGraph(): Promise<WikiComponentGraph> {
    return this.transport.request<WikiComponentGraph>('/graph');
  }

  standaloneComponents(): Promise<WikiComponentSummary[]> {
    return this.transport.request<WikiComponentSummary[]>('/components');
  }

  standaloneComponent(componentId: string): Promise<WikiComponentDetail> {
    return this.transport.request<WikiComponentDetail>(`/components/${encodePathSegment(componentId)}`);
  }

  standalonePage(key: string): Promise<WikiPage> {
    return this.transport.request<WikiPage>(`/pages/${encodePathSegment(key)}`);
  }

  standaloneThemes(): Promise<WikiThemeMeta[]> {
    return this.transport.request<WikiThemeMeta[]>('/themes');
  }

  standaloneTheme(themeId: string): Promise<WikiThemeDetail> {
    return this.transport.request<WikiThemeDetail>(`/themes/${encodePathSegment(themeId)}`);
  }

  standaloneThemeArticle(themeId: string, slug: string): Promise<WikiThemeArticleDetail> {
    return this.transport.request<WikiThemeArticleDetail>(`/themes/${encodePathSegment(themeId)}/${encodePathSegment(slug)}`);
  }

  standaloneAskStream(request: WikiAskRequest, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson('/ask', request, options);
  }

  standaloneDeleteAskSession(sessionId: string): Promise<WikiAskSessionDeleteResponse> {
    return this.transport.request<WikiAskSessionDeleteResponse>(`/ask/session/${encodePathSegment(sessionId)}`, { method: 'DELETE' });
  }

  standaloneExploreStream(componentId: string, request: WikiExploreRequest = {}, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(`/explore/${encodePathSegment(componentId)}`, request, options);
  }

  getStandaloneAdminResource(kind: WikiAdminResourceKind): Promise<WikiAdminResourceResponse> {
    return this.transport.request<WikiAdminResourceResponse>(`/admin/${kind}`);
  }

  updateStandaloneAdminResource(kind: WikiAdminResourceKind, content: string): Promise<WikiAdminResourceUpdateResponse> {
    return this.transport.request<WikiAdminResourceUpdateResponse>(`/admin/${kind}`, {
      method: 'PUT',
      body: { content },
    });
  }

  generateStandaloneSeedsStream(options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson('/admin/seeds/generate', {}, options);
  }

  standaloneGenerateStatus(): Promise<WikiGenerateStatusResponse> {
    return this.transport.request<WikiGenerateStatusResponse>('/admin/generate/status');
  }

  startStandaloneGenerateStream(request: WikiGenerateRequest, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson('/admin/generate', request, options);
  }

  cancelStandaloneGenerate(): Promise<WikiGenerateCancelResponse> {
    return this.transport.request<WikiGenerateCancelResponse>('/admin/generate/cancel', { method: 'POST' });
  }

  regenerateStandaloneComponentStream(componentId: string, request: WikiGenerateRequest = {}, options?: WikiStreamOptions): Promise<Response> {
    return this.streamJson(`/admin/generate/component/${encodePathSegment(componentId)}`, request, options);
  }

  private async streamJson(path: string, body: unknown, options?: WikiStreamOptions): Promise<Response> {
    const headers = new Headers(this.options.defaultHeaders);
    headers.set('Content-Type', 'application/json');
    return this.options.fetch(buildApiUrl(this.options.baseUrl, this.options.apiBasePath, path), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  }
}
