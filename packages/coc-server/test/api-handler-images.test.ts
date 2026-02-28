/**
 * API Handler — Image Persistence Tests
 *
 * Verifies that POST /api/processes/:id/message persists validated
 * image data URLs on the user ConversationTurn.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { QueueExecutorBridge } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore, createCompletedProcessWithSession } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Test Constants
// ============================================================================

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP//AP/CABEIAAEAAQMBIgACEQEDEQH/xAAUAAEAAAAAAAAAAAAAAAAAAAAI/9oACAEBAAAAAEf/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/9oACAECEAAAAH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9QABAAf/9oACAEBAAE/AH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AH//2Q==';
const GIF_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/processes/:id/message — image persistence', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let bridge: QueueExecutorBridge;

    beforeAll(async () => {
        store = createMockProcessStore({
            initialProcesses: [
                createCompletedProcessWithSession('proc-img', 'session-1'),
            ],
        });

        bridge = {
            executeFollowUp: vi.fn(async () => {}),
            isSessionAlive: vi.fn(async () => true),
        };

        const routes: Route[] = [];
        registerApiRoutes(routes, store, bridge);

        const handler = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handler);
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('persists valid image data URLs on the user turn', async () => {
        const images = [PNG_DATA_URL, JPEG_DATA_URL];
        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'check these images', images }),
        });

        expect(resp.status).toBe(202);

        const proc = store.processes.get('proc-img')!;
        const lastUserTurn = proc.conversationTurns!.find(
            (t) => t.role === 'user' && t.turnIndex === resp.json().turnIndex,
        );
        expect(lastUserTurn).toBeDefined();
        expect(lastUserTurn!.images).toEqual(images);
    });

    it('sets images to undefined when body.images is absent', async () => {
        // Reset the process so it has an SDK session
        store.processes.set('proc-img', createCompletedProcessWithSession('proc-img', 'session-1'));

        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'no images' }),
        });

        expect(resp.status).toBe(202);

        const proc = store.processes.get('proc-img')!;
        const lastUserTurn = proc.conversationTurns!.find(
            (t) => t.role === 'user' && t.turnIndex === resp.json().turnIndex,
        );
        expect(lastUserTurn).toBeDefined();
        expect(lastUserTurn!.images).toBeUndefined();
    });

    it('sets images to undefined when body.images is an empty array', async () => {
        store.processes.set('proc-img', createCompletedProcessWithSession('proc-img', 'session-1'));

        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'empty images', images: [] }),
        });

        expect(resp.status).toBe(202);

        const proc = store.processes.get('proc-img')!;
        const lastUserTurn = proc.conversationTurns!.find(
            (t) => t.role === 'user' && t.turnIndex === resp.json().turnIndex,
        );
        expect(lastUserTurn).toBeDefined();
        expect(lastUserTurn!.images).toBeUndefined();
    });

    it('caps stored images at 5 even when more are provided', async () => {
        store.processes.set('proc-img', createCompletedProcessWithSession('proc-img', 'session-1'));

        const sevenImages = Array.from({ length: 7 }, (_, i) =>
            `data:image/png;base64,img${i}payload`,
        );
        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'too many images', images: sevenImages }),
        });

        expect(resp.status).toBe(202);

        const proc = store.processes.get('proc-img')!;
        const lastUserTurn = proc.conversationTurns!.find(
            (t) => t.role === 'user' && t.turnIndex === resp.json().turnIndex,
        );
        expect(lastUserTurn).toBeDefined();
        expect(lastUserTurn!.images).toHaveLength(5);
        expect(lastUserTurn!.images).toEqual(sevenImages.slice(0, 5));
    });

    it('filters out invalid (non-image) data URLs', async () => {
        store.processes.set('proc-img', createCompletedProcessWithSession('proc-img', 'session-1'));

        const images = [
            PNG_DATA_URL,                              // valid
            'data:text/plain;base64,SGVsbG8=',          // invalid: not image
            'https://example.com/image.png',            // invalid: not data URL
            '',                                          // invalid: empty
            GIF_DATA_URL,                               // valid
        ];
        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'mixed images', images }),
        });

        expect(resp.status).toBe(202);

        const proc = store.processes.get('proc-img')!;
        const lastUserTurn = proc.conversationTurns!.find(
            (t) => t.role === 'user' && t.turnIndex === resp.json().turnIndex,
        );
        expect(lastUserTurn).toBeDefined();
        expect(lastUserTurn!.images).toEqual([PNG_DATA_URL, GIF_DATA_URL]);
    });

    it('filters out non-string entries in images array', async () => {
        store.processes.set('proc-img', createCompletedProcessWithSession('proc-img', 'session-1'));

        const images = [
            PNG_DATA_URL,
            42,          // non-string
            null,        // non-string
            JPEG_DATA_URL,
        ];
        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'with non-strings', images }),
        });

        expect(resp.status).toBe(202);

        const proc = store.processes.get('proc-img')!;
        const lastUserTurn = proc.conversationTurns!.find(
            (t) => t.role === 'user' && t.turnIndex === resp.json().turnIndex,
        );
        expect(lastUserTurn).toBeDefined();
        expect(lastUserTurn!.images).toEqual([PNG_DATA_URL, JPEG_DATA_URL]);
    });

    it('still creates temp file attachments for SDK (existing behavior)', async () => {
        store.processes.set('proc-img', createCompletedProcessWithSession('proc-img', 'session-1'));

        const resp = await request(`${baseUrl}/api/processes/proc-img/message`, {
            method: 'POST',
            body: JSON.stringify({ content: 'with attachment', images: [PNG_DATA_URL] }),
        });

        expect(resp.status).toBe(202);
        // Bridge should have been called with attachments
        expect(bridge.executeFollowUp).toHaveBeenCalled();
    });
});
