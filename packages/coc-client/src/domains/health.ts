import type { HealthResponse, OpenApiDocument } from '../contracts';
import type { RequestAdapter } from '../types';

export class HealthClient {
  constructor(private readonly transport: RequestAdapter) {}

  get(): Promise<HealthResponse> {
    return this.transport.request<HealthResponse>('/health');
  }

  openApi(): Promise<OpenApiDocument> {
    return this.transport.request<OpenApiDocument>('/openapi.json');
  }
}
