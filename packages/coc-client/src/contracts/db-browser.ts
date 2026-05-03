export type DbBrowserSourceId = 'process-db' | 'repo-raw-memory-db' | string;

export interface DbBrowserSourceCapabilities {
  readonly: boolean;
  updateRows: boolean;
  deleteRows: boolean;
  bulkDeleteRows: boolean;
}

export interface DbBrowserSource {
  id: DbBrowserSourceId;
  label: string;
  description: string;
  requiredParams: string[];
  capabilities: DbBrowserSourceCapabilities;
}

export interface DbBrowserSourcesResponse {
  sources: DbBrowserSource[];
}

export interface DbBrowserTable {
  name: string;
  rowCount: number;
}

export interface DbBrowserTablesResponse {
  source?: DbBrowserSource;
  tables: DbBrowserTable[];
}

export interface DbBrowserColumn {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
}

export interface DbBrowserTableDataQuery {
  repoId?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface DbBrowserSourceParams {
  repoId?: string;
}

export interface DbBrowserTableDataResponse {
  table: string;
  columns: DbBrowserColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DbBrowserRowUpdateRequest {
  pkColumns: Record<string, unknown>;
  updates: Record<string, unknown>;
}

export interface DbBrowserRowUpdateResponse {
  row: Record<string, unknown>;
  changes: number;
}

export interface DbBrowserRowDeleteRequest {
  pkColumns: Record<string, unknown>;
}

export interface DbBrowserRowDeleteResponse {
  deleted: number;
}

export interface DbBrowserBulkDeleteRequest {
  rows: Record<string, unknown>[];
}

export interface DbBrowserBulkDeleteResponse {
  deleted: number;
  requested: number;
}
