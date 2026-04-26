/**
 * Mock Tavily HTTP server.
 *
 * Listens on a (random or supplied) port and responds to `POST /search` with a
 * deterministic payload shaped like the real Tavily Search API. Lets tests
 * exercise `createTavilyWebSearchTool` against a real socket without hitting
 * the network, and lets a developer manually verify the caller side by running:
 *
 *   npx tsx packages/coc/test/server/llm-tools/tavily-mock-server.ts 5555
 *
 * Captured requests (method, url, headers, parsed JSON body) are exposed on the
 * returned handle for assertions.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedRequest {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
}

export interface MockTavilyResponseConfig {
    /** Override the success payload returned for `POST /search`. */
    payload?: unknown;
    /** Force a specific HTTP status. Defaults to 200. */
    status?: number;
    /** Latency to inject before responding (ms). */
    delayMs?: number;
}

export interface MockTavilyServer {
    /** The base URL (e.g. `http://127.0.0.1:54321`) — pass to `createTavilyWebSearchTool({ baseUrl })`. */
    baseUrl: string;
    /** Port the server is bound to. */
    port: number;
    /** All requests received, in order. */
    requests: CapturedRequest[];
    /** Replace the response config used for subsequent requests. */
    setResponse: (cfg: MockTavilyResponseConfig) => void;
    /** Stop the server. */
    close: () => Promise<void>;
}

const DEFAULT_PAYLOAD = {
    query: 'mock query',
    answer: 'Mock Tavily answer.',
    results: [
        {
            title: 'Mock Result 1',
            url: 'https://example.com/1',
            content: 'First mock snippet.',
            score: 0.95,
            published_date: '2026-04-20',
            raw_content: 'Full raw content for result 1.',
        },
        {
            title: 'Mock Result 2',
            url: 'https://example.com/2',
            content: 'Second mock snippet.',
            score: 0.78,
            raw_content: 'Full raw content for result 2.',
        },
    ],
};

async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

export async function startMockTavilyServer(
    initial: MockTavilyResponseConfig = {},
    port = 0,
): Promise<MockTavilyServer> {
    const requests: CapturedRequest[] = [];
    let response: MockTavilyResponseConfig = { ...initial };

    const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const raw = await readBody(req);
        let parsed: unknown;
        try {
            parsed = raw ? JSON.parse(raw) : undefined;
        } catch {
            parsed = raw;
        }
        requests.push({
            method: req.method ?? '',
            url: req.url ?? '',
            headers: req.headers,
            body: parsed,
        });

        if (req.method !== 'POST' || req.url !== '/search') {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }

        const apply = () => {
            const status = response.status ?? 200;
            const payload = response.payload ?? DEFAULT_PAYLOAD;
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        };

        if (response.delayMs && response.delayMs > 0) {
            setTimeout(apply, response.delayMs);
        } else {
            apply();
        }
    });

    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    const boundPort = addr.port;

    return {
        baseUrl: `http://127.0.0.1:${boundPort}`,
        port: boundPort,
        requests,
        setResponse: cfg => {
            response = { ...cfg };
        },
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close(err => (err ? reject(err) : resolve())),
            ),
    };
}

// ---------------------------------------------------------------------------
// Standalone runner: `tsx tavily-mock-server.ts [port]`
// ---------------------------------------------------------------------------

const isDirect = (() => {
    try {
        // process.argv[1] resolves to the entry script when run directly.
        return typeof process !== 'undefined'
            && Array.isArray(process.argv)
            && typeof process.argv[1] === 'string'
            && process.argv[1].endsWith('tavily-mock-server.ts');
    } catch {
        return false;
    }
})();

if (isDirect) {
    const portArg = Number(process.argv[2]);
    const port = Number.isFinite(portArg) && portArg > 0 ? portArg : 0;
    startMockTavilyServer({}, port).then(srv => {
        // eslint-disable-next-line no-console
        console.log(`[mock-tavily] listening on ${srv.baseUrl}`);
        const dump = (): void => {
            // eslint-disable-next-line no-console
            console.log(`[mock-tavily] received ${srv.requests.length} request(s)`);
            for (const r of srv.requests) {
                // eslint-disable-next-line no-console
                console.log(JSON.stringify({ method: r.method, url: r.url, body: r.body }));
            }
        };
        process.on('SIGINT', async () => {
            dump();
            await srv.close();
            process.exit(0);
        });
    });
}
