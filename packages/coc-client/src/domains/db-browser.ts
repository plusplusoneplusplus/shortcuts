import type {
  DbBrowserBulkDeleteRequest,
  DbBrowserBulkDeleteResponse,
  DbBrowserRowDeleteRequest,
  DbBrowserRowDeleteResponse,
  DbBrowserRowUpdateRequest,
  DbBrowserRowUpdateResponse,
  DbBrowserSourceId,
  DbBrowserSourceParams,
  DbBrowserSourcesResponse,
  DbBrowserTableDataQuery,
  DbBrowserTableDataResponse,
  DbBrowserTablesResponse,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function sourcePath(source: DbBrowserSourceId, suffix = ''): string {
  return `/db-browser/${encodePathSegment(source)}${suffix}`;
}

function sourceQuery(params?: DbBrowserSourceParams): CocRequestOptions['query'] {
  return params?.repoId ? { repoId: params.repoId } : undefined;
}

function tableQuery(query?: DbBrowserTableDataQuery): CocRequestOptions['query'] {
  return {
    repoId: query?.repoId,
    page: query?.page,
    pageSize: query?.pageSize,
    sort: query?.sort,
    order: query?.order,
  };
}

export class DbBrowserClient {
  constructor(private readonly transport: RequestAdapter) {}

  listSources(): Promise<DbBrowserSourcesResponse> {
    return this.transport.request<DbBrowserSourcesResponse>('/db-browser/sources');
  }

  listTables(source: DbBrowserSourceId, params?: DbBrowserSourceParams): Promise<DbBrowserTablesResponse> {
    return this.transport.request<DbBrowserTablesResponse>(sourcePath(source, '/tables'), {
      query: sourceQuery(params),
    });
  }

  getTable(source: DbBrowserSourceId, tableName: string, query?: DbBrowserTableDataQuery): Promise<DbBrowserTableDataResponse> {
    return this.transport.request<DbBrowserTableDataResponse>(
      sourcePath(source, `/tables/${encodePathSegment(tableName)}`),
      { query: tableQuery(query) },
    );
  }

  updateRow(
    source: DbBrowserSourceId,
    tableName: string,
    request: DbBrowserRowUpdateRequest,
    params?: DbBrowserSourceParams,
  ): Promise<DbBrowserRowUpdateResponse> {
    return this.transport.request<DbBrowserRowUpdateResponse>(sourcePath(source, `/tables/${encodePathSegment(tableName)}/rows`), {
      method: 'PUT',
      query: sourceQuery(params),
      body: { ...request },
    });
  }

  deleteRow(
    source: DbBrowserSourceId,
    tableName: string,
    request: DbBrowserRowDeleteRequest,
    params?: DbBrowserSourceParams,
  ): Promise<DbBrowserRowDeleteResponse> {
    return this.transport.request<DbBrowserRowDeleteResponse>(sourcePath(source, `/tables/${encodePathSegment(tableName)}/rows`), {
      method: 'DELETE',
      query: sourceQuery(params),
      body: { ...request },
    });
  }

  deleteBulk(
    source: DbBrowserSourceId,
    tableName: string,
    request: DbBrowserBulkDeleteRequest,
    params?: DbBrowserSourceParams,
  ): Promise<DbBrowserBulkDeleteResponse> {
    return this.transport.request<DbBrowserBulkDeleteResponse>(sourcePath(source, `/tables/${encodePathSegment(tableName)}/rows/delete-bulk`), {
      method: 'POST',
      query: sourceQuery(params),
      body: { ...request },
    });
  }
}
