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
import { registerProcessResumeRoutes, registerFreshChatTerminalRoutes, launchResumeCommandInTerminal, launchFreshChatInTerminal } from '../../src/server/process-resume-handler';
import { spawn } from 'child_process';

vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('child_process')>();
    return { ...actual, spawn: vi.fn(actual.spawn) };
});

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

describe('launchResumeCommandInTerminal – Windows spawn arguments', () => {
    let originalPlatform: PropertyDescriptor | undefined;
    const spawnMock = vi.mocked(spawn);

    beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        spawnMock.mockImplementation((() => {
            const ee = new (require('events').EventEmitter)();
            ee.unref = vi.fn();
            process.nextTick(() => ee.emit('spawn'));
            return ee;
        }) as any);
    });

    afterEach(() => {
        spawnMock.mockRestore();
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
    });

    it('uses start /D with windowsVerbatimArguments instead of && chaining', async () => {
        const result = await launchResumeCommandInTerminal({
            sessionId: 'sess-win-1',
            workingDirectory: 'C:\\Users\\test\\project',
        });

        expect(result.launched).toBe(true);
        expect(result.terminal).toBe('powershell');

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [cmd, args, opts] = spawnMock.mock.calls[0];
        expect(cmd).toBe('cmd.exe');

        // Single argument string containing the full start /D command
        expect(args).toHaveLength(1);
        const startLine = (args as string[])[0];
        expect(startLine).toContain('/c start ""');
        expect(startLine).toContain('/D "C:\\Users\\test\\project"');
        expect(startLine).toContain('powershell.exe -NoExit -Command copilot --yolo --resume "sess-win-1"');

        // windowsVerbatimArguments must be true to prevent Node.js quote escaping
        expect((opts as any).windowsVerbatimArguments).toBe(true);
        expect((opts as any).detached).toBe(true);
    });

    it('quotes session IDs and paths containing spaces', async () => {
        await launchResumeCommandInTerminal({
            sessionId: 'sess with spaces',
            workingDirectory: 'C:\\Program Files\\My App',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('/D "C:\\Program Files\\My App"');
        expect(startLine).toContain('--resume "sess with spaces"');
    });

    it('escapes double quotes in session IDs using "" convention', async () => {
        await launchResumeCommandInTerminal({
            sessionId: 'sess"quoted',
            workingDirectory: 'C:\\test',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('--resume "sess""quoted"');
    });

    it('does not include && in the spawn arguments', async () => {
        await launchResumeCommandInTerminal({
            sessionId: 'sess-no-ampersand',
            workingDirectory: 'C:\\test',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).not.toContain('&&');
    });
});

describe('POST /api/chat/launch-terminal', () => {
    let server: http.Server | undefined;
    let dataDir: string;
    let baseUrl: string;

    const mockFreshLauncher = vi.fn();

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-chat-test-'));
        mockFreshLauncher.mockReset();

        const routes: Route[] = [];
        registerFreshChatTerminalRoutes(routes, mockFreshLauncher);

        const handler = createRequestHandler({
            routes,
            spaHtml: generateDashboardHtml(),
            store: undefined as any,
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

    it('launches fresh chat in terminal with provided workingDirectory', async () => {
        mockFreshLauncher.mockResolvedValue({
            launched: true,
            command: "cd '/some/path' && copilot --yolo",
            terminal: 'Terminal',
        });

        const res = await request(`${baseUrl}/api/chat/launch-terminal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workingDirectory: '/some/path' }),
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.launched).toBe(true);
        expect(body.workingDirectory).toBe('/some/path');
        expect(body.terminal).toBe('Terminal');
        expect(mockFreshLauncher).toHaveBeenCalledWith({ workingDirectory: '/some/path' });
    });

    it('falls back to process.cwd() when workingDirectory is missing', async () => {
        mockFreshLauncher.mockResolvedValue({
            launched: true,
            command: 'copilot --yolo',
            terminal: 'Terminal',
        });

        const res = await request(`${baseUrl}/api/chat/launch-terminal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.launched).toBe(true);
        expect(mockFreshLauncher).toHaveBeenCalledWith({ workingDirectory: process.cwd() });
    });

    it('returns launched:false when launcher reports failure', async () => {
        mockFreshLauncher.mockResolvedValue({
            launched: false,
            command: 'copilot --yolo',
            reason: 'No GUI display detected for terminal auto-launch.',
        });

        const res = await request(`${baseUrl}/api/chat/launch-terminal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workingDirectory: '/tmp' }),
        });

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.launched).toBe(false);
        expect(body.reason).toBe('No GUI display detected for terminal auto-launch.');
    });

    it('returns 500 when launcher throws', async () => {
        mockFreshLauncher.mockRejectedValue(new Error('spawn failed'));

        const res = await request(`${baseUrl}/api/chat/launch-terminal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workingDirectory: '/tmp' }),
        });

        expect(res.status).toBe(500);
        expect(JSON.parse(res.body).error).toContain('spawn failed');
    });
});

describe('launchFreshChatInTerminal – Windows spawn arguments', () => {
    let originalPlatform: PropertyDescriptor | undefined;
    const spawnMock = vi.mocked(spawn);

    beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

        spawnMock.mockImplementation((() => {
            const ee = new (require('events').EventEmitter)();
            ee.unref = vi.fn();
            process.nextTick(() => ee.emit('spawn'));
            return ee;
        }) as any);
    });

    afterEach(() => {
        spawnMock.mockRestore();
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
    });

    it('uses start /D without --resume for fresh chat', async () => {
        const result = await launchFreshChatInTerminal({
            workingDirectory: 'C:\\Users\\test\\project',
        });

        expect(result.launched).toBe(true);
        expect(result.terminal).toBe('powershell');

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const [cmd, args, opts] = spawnMock.mock.calls[0];
        expect(cmd).toBe('cmd.exe');

        expect(args).toHaveLength(1);
        const startLine = (args as string[])[0];
        expect(startLine).toContain('/c start ""');
        expect(startLine).toContain('/D "C:\\Users\\test\\project"');
        expect(startLine).toContain('powershell.exe -NoExit -Command copilot --yolo');
        expect(startLine).not.toContain('--resume');

        expect((opts as any).windowsVerbatimArguments).toBe(true);
        expect((opts as any).detached).toBe(true);
    });

    it('does not include --resume in the spawn arguments', async () => {
        await launchFreshChatInTerminal({
            workingDirectory: 'C:\\test',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).not.toContain('--resume');
    });
});

