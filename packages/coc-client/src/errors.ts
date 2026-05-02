export interface CocApiErrorOptions {
  status: number;
  statusText: string;
  url: string;
  message: string;
  code?: string;
  details?: unknown;
  body?: unknown;
}

export class CocApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly code?: string;
  readonly details?: unknown;
  readonly body?: unknown;

  constructor(options: CocApiErrorOptions) {
    super(options.message);
    this.name = 'CocApiError';
    this.status = options.status;
    this.statusText = options.statusText;
    this.url = options.url;
    this.code = options.code;
    this.details = options.details;
    this.body = options.body;
  }
}

export class CocNetworkError extends Error {
  readonly url: string;
  readonly code: 'NETWORK_ERROR' | 'TIMEOUT' | 'ABORTED';
  readonly cause?: unknown;

  constructor(message: string, options: { url: string; code?: CocNetworkError['code']; cause?: unknown }) {
    super(message);
    this.name = 'CocNetworkError';
    this.url = options.url;
    this.code = options.code ?? 'NETWORK_ERROR';
    this.cause = options.cause;
  }
}

export async function createApiError(response: Response, url: string): Promise<CocApiError> {
  const statusText = response.statusText || '';
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => undefined);
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const message = typeof record.message === 'string'
        ? record.message
        : typeof record.error === 'string'
          ? record.error
          : `CoC API request failed: ${response.status} ${statusText}`.trim();
      return new CocApiError({
        status: response.status,
        statusText,
        url,
        message,
        code: typeof record.code === 'string' ? record.code : undefined,
        details: record.details,
        body,
      });
    }
  }

  const text = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
  const preview = text.slice(0, 500);
  const suffix = preview ? `: ${preview}` : '';
  return new CocApiError({
    status: response.status,
    statusText,
    url,
    message: `CoC API request failed: ${response.status} ${statusText}${suffix}`.trim(),
    body: preview,
  });
}
