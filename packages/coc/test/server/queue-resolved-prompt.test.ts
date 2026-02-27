/**
 * Queue Resolved Prompt Tests
 *
 * Tests for:
 * - GET /api/queue/:id/resolved-prompt endpoint
 * - Enhanced SPA rendering for follow-prompt, ai-clarification, and task-generation tasks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

function httpRequest(
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

function postJSON(url: string, data: unknown) {
    return httpRequest(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Resolved Prompt Endpoint', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let tmpDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-resolved-test-'));
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-resolved-files-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function enqueueTask(srv: ExecutionServer, task: Record<string, any>): Promise<any> {
        const res = await postJSON(`${srv.url}/api/queue`, task);
        expect(res.status).toBe(201);
        return JSON.parse(res.body).task;
    }

    // ========================================================================
    // GET /api/queue/:id/resolved-prompt
    // ========================================================================

    it('should return 404 for non-existent task', async () => {
        const srv = await startServer();
        const res = await httpRequest(`${srv.url}/api/queue/nonexistent/resolved-prompt`);
        expect(res.status).toBe(404);
    });

    it('should return resolved prompt for follow-prompt task with plan file', async () => {
        const srv = await startServer();

        // Create a plan file
        const planFile = path.join(tmpDir, 'test-plan.md');
        fs.writeFileSync(planFile, '# Test Plan\n\nThis is a test plan.');

        const task = await enqueueTask(srv, {
            type: 'follow-prompt',
            payload: {
                promptContent: 'Use the impl skill.',
                planFilePath: planFile,
                skillName: 'impl',
                workingDirectory: tmpDir,
            },
        });

        const res = await httpRequest(`${srv.url}/api/queue/${task.id}/resolved-prompt`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBe(task.id);
        expect(body.type).toBe('follow-prompt');
        expect(body.planFilePath).toBe(planFile);
        expect(body.planFileContent).toBe('# Test Plan\n\nThis is a test plan.');
        expect(body.resolvedPrompt).toContain('Plan File');
        expect(body.resolvedPrompt).toContain('Use the impl skill.');
    });

    it('should return resolved prompt for follow-prompt task with prompt file', async () => {
        const srv = await startServer();

        const promptFile = path.join(tmpDir, 'prompt.md');
        fs.writeFileSync(promptFile, '# Prompt Instructions\n\nDo the thing.');

        const task = await enqueueTask(srv, {
            type: 'follow-prompt',
            payload: {
                promptFilePath: promptFile,
                promptContent: 'Follow instructions.',
                workingDirectory: tmpDir,
            },
        });

        const res = await httpRequest(`${srv.url}/api/queue/${task.id}/resolved-prompt`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.promptFilePath).toBe(promptFile);
        expect(body.promptFileContent).toBe('# Prompt Instructions\n\nDo the thing.');
        expect(body.resolvedPrompt).toContain('Follow instructions.');
    });

    it('should handle missing plan file gracefully', async () => {
        const srv = await startServer();

        const task = await enqueueTask(srv, {
            type: 'follow-prompt',
            payload: {
                promptContent: 'Some prompt.',
                planFilePath: path.join(tmpDir, 'nonexistent.md'),
                workingDirectory: tmpDir,
            },
        });

        const res = await httpRequest(`${srv.url}/api/queue/${task.id}/resolved-prompt`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.planFilePath).toBe(path.join(tmpDir, 'nonexistent.md'));
        expect(body.planFileContent).toBeUndefined();
        expect(body.resolvedPrompt).toContain('Some prompt.');
    });

    it('should include additional context in resolved prompt', async () => {
        const srv = await startServer();

        const task = await enqueueTask(srv, {
            type: 'follow-prompt',
            payload: {
                promptContent: 'Do something.',
                additionalContext: 'Extra context here.',
                workingDirectory: tmpDir,
            },
        });

        const res = await httpRequest(`${srv.url}/api/queue/${task.id}/resolved-prompt`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.resolvedPrompt).toContain('Additional Context');
        expect(body.resolvedPrompt).toContain('Extra context here.');
    });

    it('should return resolved prompt for ai-clarification task', async () => {
        const srv = await startServer();

        const task = await enqueueTask(srv, {
            type: 'ai-clarification',
            payload: {
                prompt: 'Explain this code.',
                filePath: '/some/file.ts',
                workingDirectory: tmpDir,
            },
        });

        const res = await httpRequest(`${srv.url}/api/queue/${task.id}/resolved-prompt`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.resolvedPrompt).toContain('Explain this code.');
    });

    it('should return task info for custom task without files', async () => {
        const srv = await startServer();

        const task = await enqueueTask(srv, {
            type: 'custom',
            payload: { data: { prompt: 'Custom task prompt' } },
        });

        const res = await httpRequest(`${srv.url}/api/queue/${task.id}/resolved-prompt`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBe(task.id);
        expect(body.type).toBe('custom');
        // No file paths, so no resolved content
        expect(body.planFileContent).toBeUndefined();
        expect(body.promptFileContent).toBeUndefined();
    });
});

// ============================================================================
// SPA Bundle Tests — Enhanced Detail Rendering
// ============================================================================

describe('SPA Enhanced Detail Rendering', () => {
    function getClientBundle(): string {
        const bundlePath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.js');
        return fs.readFileSync(bundlePath, 'utf8');
    }

    it('includes skill name field in follow-prompt rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Skill Name');
        expect(bundle).toContain('skillName');
    });

    it('includes plan file path field in follow-prompt rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Plan File');
        expect(bundle).toContain('planFilePath');
    });

    it('includes additional context collapsible in follow-prompt rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Additional Context');
        expect(bundle).toContain('additionalContext');
    });

    it('includes instruction type field in ai-clarification rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Instruction Type');
        expect(bundle).toContain('instructionType');
    });

    it('includes custom instruction collapsible in ai-clarification rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Custom Instruction');
        expect(bundle).toContain('customInstruction');
    });

    it('includes nearest heading field in ai-clarification rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Nearest Heading');
        expect(bundle).toContain('nearestHeading');
    });

    it('includes task-generation dedicated rendering', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Task Generation Details');
        expect(bundle).toContain('task-generation');
    });

    it('includes task generation metadata fields', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Task Name');
        expect(bundle).toContain('Target Folder');
        expect(bundle).toContain('targetFolder');
        expect(bundle).toContain('Depth');
    });

    it('includes resolved prompt section', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Full Prompt (Resolved)');
        expect(bundle).toContain('resolved-prompt');
    });

    it('includes plan file content section in resolved prompt', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Plan File Content');
        expect(bundle).toContain('planFileContent');
    });

    it('includes prompt file content section in resolved prompt', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Prompt File Content');
        expect(bundle).toContain('promptFileContent');
    });
});
