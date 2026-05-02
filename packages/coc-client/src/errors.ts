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

  toString(): string {
    const metadata = [
      this.code ? `code=${this.code}` : undefined,
      `status=${this.status}`,
    ].filter(Boolean).join(', ');
    return `${this.name}: ${this.message} (${metadata})`;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      statusText: this.statusText,
      url: this.url,
      code: this.code,
      details: this.details,
      body: this.body,
    };
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

export class CocSseError extends Error {
  readonly url: string;
  readonly lastEventId: string;
  readonly code = 'SSE_ERROR';
  readonly cause?: unknown;

  constructor(message: string, options: { url: string; lastEventId?: string; cause?: unknown }) {
    super(message);
    this.name = 'CocSseError';
    this.url = options.url;
    this.lastEventId = options.lastEventId ?? '';
    this.cause = options.cause;
  }
}

export async function createApiError(response: Response, url: string): Promise<CocApiError> {
  const statusText = response.statusText || '';
  const contentType = response.headers?.get?.('content-type') ?? '';
  const text = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
  const jsonBody = !text && typeof response.json === 'function'
    ? await response.json().catch(() => undefined)
    : undefined;
  const preview = text.slice(0, 500);
  if (contentType.includes('application/json') || jsonBody !== undefined) {
    const body = jsonBody ?? parseJson(text);
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const errorRecord = isRecord(record.error) ? record.error : undefined;
      const message = firstString(errorRecord?.message, record.message, record.error)
        || statusText
        || defaultApiErrorMessage(response.status, statusText);
      return new CocApiError({
        status: response.status,
        statusText,
        url,
        message,
        code: firstString(errorRecord?.code, record.code),
        details: errorRecord && 'details' in errorRecord ? errorRecord.details : record.details,
        body,
      });
    }
    if (preview) {
      return new CocApiError({
        status: response.status,
        statusText,
        url,
        message: preview,
        body: preview,
      });
    }
  }

  return new CocApiError({
    status: response.status,
    statusText,
    url,
    message: preview || defaultApiErrorMessage(response.status, statusText),
    body: preview,
  });
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function defaultApiErrorMessage(status: number, statusText: string): string {
  return `CoC API request failed: ${status} ${statusText}`.trim();
}
