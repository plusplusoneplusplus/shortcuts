export type TemplateKind = 'commit';

export interface TemplateChangedFile {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface TemplateCommitMetadata {
  shortHash: string;
  subject: string;
  authorName: string;
  date: string;
  relativeDate: string;
}

export interface Template {
  name: string;
  kind: TemplateKind;
  commitHash: string;
  description?: string;
  hints?: string[];
  createdAt?: string;
  updatedAt?: string;
  _fileName?: string;
}

export interface TemplateDetail extends Template {
  changedFiles?: TemplateChangedFile[];
  _commit?: TemplateCommitMetadata;
}

export interface ListTemplatesResponse {
  templates: Template[];
}

export interface CreateTemplateRequest {
  name: string;
  kind: TemplateKind;
  commitHash: string;
  description?: string;
  hints?: string[];
}

export interface CreateTemplateResponse {
  name: string;
  path: string;
}

export interface UpdateTemplateRequest {
  kind?: TemplateKind;
  commitHash?: string;
  description?: string;
  hints?: string[];
}

export interface UpdateTemplateResponse {
  name: string;
  path: string;
}

export interface DeleteTemplateResponse {
  deleted: string;
}

export interface ReplicateTemplateRequest {
  instruction: string;
  model?: string;
}

export interface ReplicateTemplateResponse {
  taskId?: string;
  [key: string]: unknown;
}
