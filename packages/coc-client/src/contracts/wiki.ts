export type WikiStatus = 'loaded' | 'generating' | 'error' | 'pending';

export interface WikiSummary {
  id: string;
  name?: string;
  title?: string;
  wikiDir?: string;
  repoPath?: string;
  aiEnabled?: boolean;
  color?: string;
  loaded?: boolean;
  componentCount?: number;
  status?: WikiStatus;
  error?: string;
  errorMessage?: string;
  generatedAt?: string;
}

export type WikiListResponse = WikiSummary[] | { wikis: WikiSummary[] };

export interface CreateWikiRequest {
  id: string;
  wikiDir?: string;
  repoPath?: string;
  name?: string;
  color?: string;
  generateWithAI?: boolean;
  aiEnabled?: boolean;
  title?: string;
}

export interface CreateWikiResponse {
  success: boolean;
  id: string;
  wikiDir: string;
  repoPath?: string;
  hasExistingData: boolean;
  generateWithAI: boolean;
  name?: string;
  color?: string;
}

export interface UpdateWikiRequest {
  name?: string;
  title?: string;
  color?: string;
  aiEnabled?: boolean;
}

export interface WikiMutationResponse {
  success: boolean;
  id: string;
}

export interface WikiProjectInfo {
  name: string;
  description: string;
  language?: string;
  mainLanguage?: string;
  buildSystem?: string;
  entryPoints?: string[];
}

export interface WikiComponentInfo {
  id: string;
  name: string;
  path: string;
  purpose: string;
  keyFiles?: string[];
  dependencies?: string[];
  dependents?: string[];
  complexity?: 'low' | 'medium' | 'high' | string;
  category: string;
  domain?: string;
  lineRanges?: Array<[number, number]>;
  mergedFrom?: string[];
}

export interface WikiCategoryInfo {
  id?: string;
  name: string;
  description?: string;
}

export interface WikiDomainInfo {
  id: string;
  name: string;
  path: string;
  description: string;
  components: string[];
}

export interface WikiThemeMeta {
  id: string;
  title: string;
  description: string;
  layout: 'single' | 'area' | string;
  articles: Array<{ slug: string; title: string; path?: string }>;
  involvedComponentIds?: string[];
  directoryPath?: string;
  generatedAt?: number;
  gitHash?: string;
}

export interface WikiComponentGraph {
  project: WikiProjectInfo;
  components: WikiComponentInfo[];
  categories: WikiCategoryInfo[];
  architectureNotes?: string;
  domains?: WikiDomainInfo[];
  themes?: WikiThemeMeta[];
}

export interface WikiComponentSummary {
  id: string;
  name: string;
  category: string;
  complexity?: string;
  path: string;
  purpose: string;
}

export interface WikiComponentDetail {
  component: WikiComponentInfo;
  markdown: string;
  analysis?: unknown;
}

export interface WikiPage {
  key: string;
  title: string;
  markdown: string;
}

export interface WikiThemeArticleContent {
  slug: string;
  title: string;
  content: string;
}

export interface WikiThemeDetail extends WikiThemeMeta {
  articles: WikiThemeArticleContent[];
}

export interface WikiThemeArticleDetail {
  themeId?: string;
  slug?: string;
  content: string;
  meta: WikiThemeMeta;
}

export interface WikiAskMessage {
  role: string;
  content: string;
}

export interface WikiAskRequest {
  question: string;
  sessionId?: string;
  conversationHistory?: WikiAskMessage[];
  componentId?: string;
}

export interface WikiAskSessionDeleteResponse {
  destroyed: boolean;
  sessionId: string;
}

export interface WikiExploreRequest {
  question?: string;
  prompt?: string;
  depth?: string;
  [key: string]: unknown;
}

export type WikiAdminResourceKind = 'seeds' | 'config';

export interface WikiAdminResourceResponse {
  exists?: boolean;
  content?: unknown;
  raw?: string;
  path?: string;
  error?: string;
}

export interface WikiAdminResourceUpdateResponse {
  success?: boolean;
  path?: string;
  error?: string;
}

export interface WikiGenerateRequest {
  startPhase?: number;
  endPhase?: number;
  force?: boolean;
  [key: string]: unknown;
}

export interface WikiGeneratePhaseStatus {
  cached: boolean;
  [key: string]: unknown;
}

export interface WikiGenerateStatusResponse {
  phases?: Record<string, WikiGeneratePhaseStatus>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WikiGenerateCancelResponse {
  success?: boolean;
  cancelled?: boolean;
  [key: string]: unknown;
}
