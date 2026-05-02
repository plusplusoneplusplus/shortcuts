import type * as http from 'http';
import type { RecordedRequest } from './http-router';

export interface SseMessage {
  event?: string;
  data?: unknown;
  id?: string;
  retry?: number;
  comment?: string;
}

export type SseHandler = (stream: SseStream, request: RecordedRequest) => void | Promise<void>;

export class SseStream {
  constructor(private readonly response: http.ServerResponse) {}

  async send(message: SseMessage): Promise<void> {
    const lines: string[] = [];
    if (message.comment !== undefined) lines.push(`: ${message.comment}`);
    if (message.id !== undefined) lines.push(`id: ${message.id}`);
    if (message.event !== undefined) lines.push(`event: ${message.event}`);
    if (message.retry !== undefined) lines.push(`retry: ${message.retry}`);
    if (message.data !== undefined) {
      const data = typeof message.data === 'string' ? message.data : JSON.stringify(message.data);
      for (const line of data.split(/\r?\n/)) lines.push(`data: ${line}`);
    }
    lines.push('');
    await this.write(`${lines.join('\n')}\n`);
  }

  async flush(): Promise<void> {
    await this.write('');
  }

  end(): void {
    if (!this.response.destroyed) this.response.end();
  }

  private async write(chunk: string): Promise<void> {
    if (this.response.destroyed) return;
    if (chunk === '') {
      this.response.flushHeaders();
      return;
    }
    if (this.response.write(chunk)) return;
    await new Promise<void>(resolve => this.response.once('drain', resolve));
  }
}

export async function writeSseResponse(
  response: http.ServerResponse,
  request: RecordedRequest,
  handler: SseHandler,
): Promise<void> {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const stream = new SseStream(response);
  await handler(stream, request);
}
