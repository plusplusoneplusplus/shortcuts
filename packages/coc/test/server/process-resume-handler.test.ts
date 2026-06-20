/**
 * Process Resume API Tests
 *
 * Tests POST /api/processes/:id/resume-cli route used by the
 * "Resume In CLI" button in process detail views.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createRequestHandler, generateDashboardHtml, registerApiRoutes } from '../../src/server/index';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { registerProcessResumeRoutes, registerFreshChatTerminalRoutes, launchResumeCommandInTerminal, launchFreshChatInTerminal } from '../../src/server/processes/process-resume-handler';
import { spawn } from 'child_process';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        resolveWorkspaceExecutionContext: vi.fn((cwd?: string) => cwd && (cwd.startsWith('/home/') || cwd.startsWith(String.raw`\\wsl$`))
            ? { kind: 'wsl', distro: 'Ubuntu', linuxWorkingDirectory: '/home/tester/repo', originalWorkingDirectory: cwd }
            : actual.resolveWorkspaceExecutionContext(cwd)),
        translatePathForHostFilesystem: vi.fn((targetPath: string) => {
            if (targetPath === '/home/tester/repo') {
                return String.raw`\\wsl$\Ubuntu\home\tester\repo`;
            }
            return actual.translatePathForHostFilesystem(targetPath);
        }),
    };
});

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
            provider: 'copilot',
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
            provider: 'copilot',
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

    describe('provider-aware command (AC-01)', () => {
        async function makeServer(opts?: { getDefaultProvider?: () => any }) {
            const routes: Route[] = [];
            registerApiRoutes(routes, store, undefined);
            registerProcessResumeRoutes(routes, store, mockLauncher, opts);
            const srv = http.createServer(createRequestHandler({
                routes,
                spaHtml: generateDashboardHtml(),
                store,
            }));
            await new Promise<void>((resolve, reject) => {
                srv.on('error', reject);
                srv.listen(0, 'localhost', () => resolve());
            });
            const address = srv.address() as { port: number };
            return { srv, url: `http://localhost:${address.port}` };
        }

        it('uses the process metadata.provider (codex) for launch', async () => {
            await store.addProcess({
                id: 'proc-codex',
                type: 'clarification',
                promptPreview: 'p',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-codex',
                workingDirectory: dataDir,
                metadata: { provider: 'codex' },
            } as AIProcess);

            mockLauncher.mockResolvedValue({ launched: true, command: 'cmd', terminal: 'Terminal' });

            const res = await request(`${baseUrl}/api/processes/proc-codex/resume-cli`, { method: 'POST' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.provider).toBe('codex');
            expect(mockLauncher).toHaveBeenCalledWith({
                sessionId: 'sess-codex',
                workingDirectory: dataDir,
                provider: 'codex',
            });
        });

        it('falls back to the configured default provider when metadata.provider is missing', async () => {
            await store.addProcess({
                id: 'proc-default',
                type: 'clarification',
                promptPreview: 'p',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-default',
                workingDirectory: dataDir,
            } as AIProcess);

            mockLauncher.mockResolvedValue({ launched: true, command: 'cmd', terminal: 'Terminal' });
            const getDefaultProvider = vi.fn(async () => 'claude' as const);
            const { srv, url } = await makeServer({ getDefaultProvider });
            try {
                const res = await request(`${url}/api/processes/proc-default/resume-cli`, { method: 'POST' });
                expect(res.status).toBe(200);
                expect(JSON.parse(res.body).provider).toBe('claude');
                expect(getDefaultProvider).toHaveBeenCalledTimes(1);
                expect(mockLauncher).toHaveBeenCalledWith({
                    sessionId: 'sess-default',
                    workingDirectory: dataDir,
                    provider: 'claude',
                });
            } finally {
                await new Promise<void>((resolve) => srv.close(() => resolve()));
            }
        });

        it('falls back to the default provider when metadata.provider is invalid', async () => {
            await store.addProcess({
                id: 'proc-invalid',
                type: 'clarification',
                promptPreview: 'p',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-invalid',
                workingDirectory: dataDir,
                metadata: { provider: 'not-a-real-provider' },
            } as AIProcess);

            mockLauncher.mockResolvedValue({ launched: true, command: 'cmd', terminal: 'Terminal' });
            const { srv, url } = await makeServer({ getDefaultProvider: async () => 'codex' as const });
            try {
                const res = await request(`${url}/api/processes/proc-invalid/resume-cli`, { method: 'POST' });
                expect(JSON.parse(res.body).provider).toBe('codex');
            } finally {
                await new Promise<void>((resolve) => srv.close(() => resolve()));
            }
        });

        it('launch:false returns the bare claude command and does not spawn', async () => {
            await store.addProcess({
                id: 'proc-bare-claude',
                type: 'clarification',
                promptPreview: 'p',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-bare-claude',
                workingDirectory: dataDir,
                metadata: { provider: 'claude' },
            } as AIProcess);

            const res = await request(`${baseUrl}/api/processes/proc-bare-claude/resume-cli`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ launch: false }),
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.launched).toBe(false);
            expect(body.provider).toBe('claude');
            // Bare invocation — no `cd` prefix; quoting is platform-specific.
            expect(body.command).toMatch(/claude --dangerously-skip-permissions --resume /);
            expect(body.command).toContain('sess-bare-claude');
            expect(body.command).not.toContain('cd ');
            expect(body.command).not.toContain('&&');
            expect(mockLauncher).not.toHaveBeenCalled();
        });

        it('launch:false returns the bare codex command (subcommand form)', async () => {
            await store.addProcess({
                id: 'proc-bare-codex',
                type: 'clarification',
                promptPreview: 'p',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-bare-codex',
                workingDirectory: dataDir,
                metadata: { provider: 'codex' },
            } as AIProcess);

            const res = await request(`${baseUrl}/api/processes/proc-bare-codex/resume-cli`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ launch: false }),
            });

            const body = JSON.parse(res.body);
            expect(body.launched).toBe(false);
            expect(body.provider).toBe('codex');
            expect(body.command).toContain('codex resume ');
            expect(body.command).toContain('--dangerously-bypass-approvals-and-sandbox');
            expect(body.command).toContain('sess-bare-codex');
            expect(body.command).not.toContain('cd ');
            expect(mockLauncher).not.toHaveBeenCalled();
        });
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
            expect(lines.some(l => l.includes('[Process] resume-cli id=proc-log-1 sessionId=sess-log-1 provider=copilot launched=true'))).toBe(true);
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

    it('translates Linux-style WSL working directories before spawning PowerShell', async () => {
        await launchResumeCommandInTerminal({
            sessionId: 'sess-wsl-1',
            workingDirectory: '/home/tester/repo',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('/D "\\\\wsl$\\Ubuntu\\home\\tester\\repo"');
        expect(startLine).toContain('--resume "sess-wsl-1"');
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

    it('launches Codex resume (subcommand form) when provider is codex', async () => {
        const result = await launchResumeCommandInTerminal({
            sessionId: 'sess-win-codex',
            workingDirectory: 'C:\\Users\\test\\project',
            provider: 'codex',
        });

        expect(result.launched).toBe(true);
        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('powershell.exe -NoExit -Command codex resume "sess-win-codex" --dangerously-bypass-approvals-and-sandbox');
        expect(startLine).not.toContain('copilot --yolo');
    });

    it('launches Claude resume when provider is claude', async () => {
        const result = await launchResumeCommandInTerminal({
            sessionId: 'sess-win-claude',
            workingDirectory: 'C:\\Users\\test\\project',
            provider: 'claude',
        });

        expect(result.launched).toBe(true);
        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('powershell.exe -NoExit -Command claude --dangerously-skip-permissions --resume "sess-win-claude"');
        expect(startLine).not.toContain('copilot --yolo');
        expect(startLine).not.toContain('codex');
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
        expect(body.provider).toBe('copilot');
        expect(body.terminal).toBe('Terminal');
        expect(mockFreshLauncher).toHaveBeenCalledWith({ workingDirectory: '/some/path', provider: 'copilot' });
    });

    it('passes the active codex provider to the fresh chat launcher', async () => {
        const routes: Route[] = [];
        registerFreshChatTerminalRoutes(routes, mockFreshLauncher, { getProvider: () => 'codex' });

        const codexServer = http.createServer(createRequestHandler({
            routes,
            spaHtml: generateDashboardHtml(),
            store: undefined as any,
        }));
        await new Promise<void>((resolve, reject) => {
            codexServer.on('error', reject);
            codexServer.listen(0, 'localhost', () => resolve());
        });

        try {
            const address = codexServer.address() as { port: number };
            mockFreshLauncher.mockResolvedValue({
                launched: true,
                command: "cd '/some/path' && codex --dangerously-bypass-approvals-and-sandbox",
                terminal: 'Terminal',
            });

            const res = await request(`http://localhost:${address.port}/api/chat/launch-terminal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workingDirectory: '/some/path' }),
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.provider).toBe('codex');
            expect(mockFreshLauncher).toHaveBeenCalledWith({ workingDirectory: '/some/path', provider: 'codex' });
        } finally {
            await new Promise<void>((resolve) => codexServer.close(() => resolve()));
        }
    });

    it('awaits async provider resolution before launching fresh chat', async () => {
        const routes: Route[] = [];
        const getProvider = vi.fn(async () => 'claude' as const);
        registerFreshChatTerminalRoutes(routes, mockFreshLauncher, { getProvider });

        const claudeServer = http.createServer(createRequestHandler({
            routes,
            spaHtml: generateDashboardHtml(),
            store: undefined as any,
        }));
        await new Promise<void>((resolve, reject) => {
            claudeServer.on('error', reject);
            claudeServer.listen(0, 'localhost', () => resolve());
        });

        try {
            const address = claudeServer.address() as { port: number };
            mockFreshLauncher.mockResolvedValue({
                launched: true,
                command: "cd '/some/path' && claude --dangerously-skip-permissions",
                terminal: 'Terminal',
            });

            const res = await request(`http://localhost:${address.port}/api/chat/launch-terminal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workingDirectory: '/some/path' }),
            });

            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.provider).toBe('claude');
            expect(getProvider).toHaveBeenCalledTimes(1);
            expect(mockFreshLauncher).toHaveBeenCalledWith({ workingDirectory: '/some/path', provider: 'claude' });
        } finally {
            await new Promise<void>((resolve) => claudeServer.close(() => resolve()));
        }
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
        expect(mockFreshLauncher).toHaveBeenCalledWith({ workingDirectory: process.cwd(), provider: 'copilot' });
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

    it('translates Linux-style WSL working directories before launching fresh chat', async () => {
        await launchFreshChatInTerminal({
            workingDirectory: '/home/tester/repo',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('/D "\\\\wsl$\\Ubuntu\\home\\tester\\repo"');
        expect(startLine).toContain('powershell.exe -NoExit -Command copilot --yolo');
    });

    it('does not include --resume in the spawn arguments', async () => {
        await launchFreshChatInTerminal({
            workingDirectory: 'C:\\test',
        });

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).not.toContain('--resume');
    });

    it('launches Codex CLI when provider is codex', async () => {
        const result = await launchFreshChatInTerminal({
            workingDirectory: 'C:\\Users\\test\\project',
            provider: 'codex',
        });

        expect(result.launched).toBe(true);
        expect(result.command).toContain('codex --dangerously-bypass-approvals-and-sandbox');

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('powershell.exe -NoExit -Command codex --dangerously-bypass-approvals-and-sandbox');
        expect(startLine).not.toContain('copilot --yolo');
    });

    it('launches Claude CLI when provider is claude', async () => {
        const result = await launchFreshChatInTerminal({
            workingDirectory: 'C:\\Users\\test\\project',
            provider: 'claude',
        });

        expect(result.launched).toBe(true);
        expect(result.command).toContain('claude --dangerously-skip-permissions');

        const startLine = (spawnMock.mock.calls[0][1] as string[])[0];
        expect(startLine).toContain('powershell.exe -NoExit -Command claude --dangerously-skip-permissions');
        expect(startLine).not.toContain('copilot --yolo');
        expect(startLine).not.toContain('codex');
    });
});
