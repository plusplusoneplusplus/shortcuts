/**
 * Process Resume API Tests
 *
 * Tests POST /api/processes/:id/resume-cli route used by the
 * "Resume CLI" button in process detail views.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { createRequestHandler, generateDashboardHtml, registerApiRoutes } from '../../src/server/index';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { registerProcessResumeRoutes } from '../../src/server/process-resume-handler';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('POST /api/processes/:id/resume-cli', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let store: FileProcessStore;
    let baseUrl: string;

    const mockLauncher = vi.fn();

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-resume-test-'));
        store = new FileProcessStore({ dataDir });
        mockLauncher.mockReset();

        const routes: Route[] = [];
        registerApiRoutes(routes, store, undefined);
        registerProcessResumeRoutes(routes, store, mockLauncher);

        const handler = createRequestHandler({
            routes,
            spaHtml: generateDashboardHtml(),
            store,
        });
        server = http.createServer(handler);

        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, 'localhost', () => resolve());
        });

        const address = server.address() as { port: number };
        baseUrl = `http://localhost:${address.port}`;
    });

    afterEach(async () => {
        if (server) {
            await new Promise<void>((resolve) => server!.close(() => resolve()));
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('launches resume command with sdkSessionId and working directory', async () => {
        const processRecord: AIProcess = {
            id: 'proc-resume-1',
            type: 'clarification',
            promptPreview: 'Prompt',
            fullPrompt: 'Prompt full',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date(),
            sdkSessionId: 'sess-resume-1',
            workingDirectory: dataDir,
        };
        await store.addProcess(processRecord);

        mockLauncher.mockResolvedValue({
            launched: true,
            command: "cd '/tmp' && copilot --yolo --resume 'sess-resume-1'",
            terminal: 'Terminal',
        });

        const res = await request(`${baseUrl}/api/processes/proc-resume-1/resume-cli`, {
            method: 'POST',
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.processId).toBe('proc-resume-1');
        expect(body.sessionId).toBe('sess-resume-1');
        expect(body.launched).toBe(true);
        expect(mockLauncher).toHaveBeenCalledTimes(1);
        expect(mockLauncher).toHaveBeenCalledWith({
            sessionId: 'sess-resume-1',
            workingDirectory: dataDir,
        });
    });

    it('falls back to sessionId in result payload when sdkSessionId is missing', async () => {
        const processRecord: AIProcess = {
            id: 'proc-resume-2',
            type: 'clarification',
            promptPreview: 'Prompt',
            fullPrompt: 'Prompt full',
            status: 'completed',
            startTime: new Date(),
            result: JSON.stringify({ sessionId: 'sess-from-result' }),
        };
        await store.addProcess(processRecord);

        await store.registerWorkspace({
            id: 'ws-resume-1',
            name: 'workspace',
            rootPath: dataDir,
        });
        await store.updateProcess('proc-resume-2', {
            metadata: { workspaceId: 'ws-resume-1' },
        });

        mockLauncher.mockResolvedValue({
            launched: false,
            command: "cd '/tmp' && copilot --yolo --resume 'sess-from-result'",
            reason: 'Not supported',
        });

        const res = await request(`${baseUrl}/api/processes/proc-resume-2/resume-cli`, {
            method: 'POST',
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.sessionId).toBe('sess-from-result');
        expect(body.launched).toBe(false);
        expect(body.reason).toBe('Not supported');
        expect(mockLauncher).toHaveBeenCalledWith({
            sessionId: 'sess-from-result',
            workingDirectory: dataDir,
        });
    });

    it('returns 409 when process has no resumable session', async () => {
        const processRecord: AIProcess = {
            id: 'proc-resume-3',
            type: 'clarification',
            promptPreview: 'Prompt',
            fullPrompt: 'Prompt full',
            status: 'completed',
            startTime: new Date(),
        };
        await store.addProcess(processRecord);

        const res = await request(`${baseUrl}/api/processes/proc-resume-3/resume-cli`, {
            method: 'POST',
        });

        expect(res.status).toBe(409);
        expect(JSON.parse(res.body).error).toContain('no resumable session ID');
        expect(mockLauncher).not.toHaveBeenCalled();
    });

    it('returns 404 for unknown process', async () => {
        const res = await request(`${baseUrl}/api/processes/does-not-exist/resume-cli`, {
            method: 'POST',
        });

        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toContain('Process not found');
        expect(mockLauncher).not.toHaveBeenCalled();
    });

    describe('Request logs', () => {
        let stderrSpy: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        it('should log [Process] resume-cli on success', async () => {
            const processRecord: AIProcess = {
                id: 'proc-log-1',
                type: 'clarification',
                promptPreview: 'Prompt',
                fullPrompt: 'Prompt full',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                sdkSessionId: 'sess-log-1',
                workingDirectory: dataDir,
            };
            await store.addProcess(processRecord);

            mockLauncher.mockResolvedValue({
                launched: true,
                command: "cd '/tmp' && copilot --yolo --resume 'sess-log-1'",
                terminal: 'Terminal',
            });

            await request(`${baseUrl}/api/processes/proc-log-1/resume-cli`, { method: 'POST' });

            const lines = stderrSpy.mock.calls
                .map(([msg]) => (typeof msg === 'string' ? msg : ''))
                .filter(Boolean);
            expect(lines.some(l => l.includes('[Process] resume-cli id=proc-log-1 sessionId=sess-log-1 launched=true'))).toBe(true);
        });
    });
});

