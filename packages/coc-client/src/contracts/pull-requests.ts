export interface GitHubProviderConfigRequest {
  token: string;
}

export interface AdoProviderConfigRequest {
  orgUrl: string;
  token?: string;
}

export interface TavilyProviderConfigRequest {
  apiKey: string;
}

export interface ProviderConfigRequest {
  github?: GitHubProviderConfigRequest;
  ado?: AdoProviderConfigRequest;
  tavily?: TavilyProviderConfigRequest;
}

export interface SanitizedProviderConfigResponse {
  providers: {
    github?: { hasToken: boolean };
    ado?: { orgUrl: string };
    tavily?: { hasApiKey: boolean };
  };
}
