import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  DeleteTemplateResponse,
  ListTemplatesResponse,
  ReplicateTemplateRequest,
  ReplicateTemplateResponse,
  Template,
  TemplateDetail,
  UpdateTemplateRequest,
  UpdateTemplateResponse,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function templatesPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/templates${suffix}`;
}

function templatePath(workspaceId: string, templateName: string, suffix = ''): string {
  return templatesPath(workspaceId, `/${encodePathSegment(templateName)}${suffix}`);
}

export class TemplatesClient {
  constructor(private readonly transport: RequestAdapter) {}

  async list(workspaceId: string): Promise<Template[]> {
    const response = await this.transport.request<ListTemplatesResponse>(templatesPath(workspaceId));
    return response.templates ?? [];
  }

  detail(workspaceId: string, templateName: string): Promise<TemplateDetail> {
    return this.transport.request<TemplateDetail>(templatePath(workspaceId, templateName));
  }

  create(workspaceId: string, request: CreateTemplateRequest): Promise<CreateTemplateResponse> {
    return this.transport.request<CreateTemplateResponse>(templatesPath(workspaceId), {
      method: 'POST',
      body: { ...request },
    });
  }

  update(workspaceId: string, templateName: string, request: UpdateTemplateRequest): Promise<UpdateTemplateResponse> {
    return this.transport.request<UpdateTemplateResponse>(templatePath(workspaceId, templateName), {
      method: 'PATCH',
      body: { ...request },
    });
  }

  delete(workspaceId: string, templateName: string): Promise<DeleteTemplateResponse> {
    return this.transport.request<DeleteTemplateResponse>(templatePath(workspaceId, templateName), {
      method: 'DELETE',
    });
  }

  replicate(workspaceId: string, templateName: string, request: ReplicateTemplateRequest): Promise<ReplicateTemplateResponse> {
    return this.transport.request<ReplicateTemplateResponse>(templatePath(workspaceId, templateName, '/replicate'), {
      method: 'POST',
      body: { ...request },
    });
  }
}
