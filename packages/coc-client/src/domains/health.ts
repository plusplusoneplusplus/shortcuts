import type { HealthResponse, OpenApiDocument } from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';

export class HealthClient {
  constructor(private readonly transport: RequestAdapter) {}

  get(options?: Pick<CocRequestOptions, 'signal'>): Promise<HealthResponse> {
    return this.transport.request<HealthResponse>('/health', options);
  }

  openApi(): Promise<OpenApiDocument> {
    return this.transport.request<OpenApiDocument>('/openapi.json');
  }
}
