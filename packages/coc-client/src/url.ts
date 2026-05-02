import type { QueryPrimitive } from './types';

export function normalizeBaseUrl(baseUrl = ''): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '');
}

export function normalizeApiBasePath(apiBasePath = '/api'): string {
  if (apiBasePath === '') return '';
  const withLeading = apiBasePath.startsWith('/') ? apiBasePath : `/${apiBasePath}`;
  const trimmed = withLeading.replace(/\/+$/, '');
  return trimmed || '/api';
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function buildQueryString(query?: Record<string, QueryPrimitive | QueryPrimitive[]>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) params.append(key, String(item));
      }
    } else {
      params.append(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function buildApiUrl(
  baseUrl: string,
  apiBasePath: string,
  path: string,
  query?: Record<string, QueryPrimitive | QueryPrimitive[]>,
): string {
  const queryString = buildQueryString(query);
  if (/^https?:\/\//i.test(path)) {
    return `${path}${path.includes('?') ? '&' + queryString.slice(1) : queryString}`;
  }

  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedApi = normalizeApiBasePath(apiBasePath);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiPath = normalizedPath === normalizedApi || normalizedPath.startsWith(`${normalizedApi}/`)
    ? normalizedPath
    : `${normalizedApi}${normalizedPath}`;

  return `${normalizedBase}${apiPath}${queryString}`;
}

export function buildWebSocketUrl(
  baseUrl: string,
  wsPath = '/ws',
  query?: Record<string, QueryPrimitive | QueryPrimitive[]>,
): string {
  const path = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
  const queryString = buildQueryString(query);
  if (!baseUrl) {
    const locationLike = (globalThis as { location?: Location }).location;
    if (!locationLike) return `${path}${queryString}`;
    const protocol = locationLike.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${locationLike.host}${path}${queryString}`;
  }
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  url.search = queryString;
  return url.toString();
}
