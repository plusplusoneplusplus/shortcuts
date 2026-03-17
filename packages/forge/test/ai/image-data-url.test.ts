/**
 * Tests for tryConvertImageFileToDataUrl utility and the view-tool
 * image interception in CopilotSDKService streaming.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { tryConvertImageFileToDataUrl } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { CopilotSDKService, resetCopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';
import { setLogger, nullLogger } from '../../src/logger';
import { createStreamingMockSDKModule } from '../helpers/mock-sdk';

setLogger(nullLogger);

// ---------------------------------------------------------------------------
// tryConvertImageFileToDataUrl — unit tests
// ---------------------------------------------------------------------------

describe('tryConvertImageFileToDataUrl', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeTmpFile(name: string, content: Buffer | string): string {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, content);
        return p;
    }

    it('should return a data URL for a valid PNG file', () => {
        // Minimal 1x1 red PNG
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            'base64',
        );
        const filePath = writeTmpFile('test.png', png);
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).not.toBeNull();
        expect(result).toMatch(/^data:image\/png;base64,/);
        // Re-decode the base64 portion and verify round-trip
        const b64 = result!.replace('data:image/png;base64,', '');
        expect(Buffer.from(b64, 'base64').equals(png)).toBe(true);
    });

    it('should return a data URL for a JPEG file (.jpg)', () => {
        const filePath = writeTmpFile('photo.jpg', Buffer.from([0xff, 0xd8, 0xff]));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('should return a data URL for a JPEG file (.jpeg)', () => {
        const filePath = writeTmpFile('photo.jpeg', Buffer.from([0xff, 0xd8, 0xff]));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/jpeg;base64,/);
    });

    it('should return a data URL for a GIF file', () => {
        const filePath = writeTmpFile('anim.gif', Buffer.from('GIF89a'));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/gif;base64,/);
    });

    it('should return a data URL for a WebP file', () => {
        const filePath = writeTmpFile('image.webp', Buffer.from('RIFF'));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/webp;base64,/);
    });

    it('should return a data URL for an SVG file', () => {
        const filePath = writeTmpFile('icon.svg', '<svg></svg>');
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    it('should return null for a non-image file (.txt)', () => {
        const filePath = writeTmpFile('readme.txt', 'hello');
        expect(tryConvertImageFileToDataUrl(filePath)).toBeNull();
    });

    it('should return null for a non-image file (.ts)', () => {
        const filePath = writeTmpFile('code.ts', 'const x = 1;');
        expect(tryConvertImageFileToDataUrl(filePath)).toBeNull();
    });

    it('should return null for a non-existent file', () => {
        expect(tryConvertImageFileToDataUrl('/does/not/exist.png')).toBeNull();
    });

    it('should return null for a directory with an image extension', () => {
        const dirPath = path.join(tmpDir, 'fake.png');
        fs.mkdirSync(dirPath, { recursive: true });
        expect(tryConvertImageFileToDataUrl(dirPath)).toBeNull();
    });

    it('should be case-insensitive on the extension', () => {
        const filePath = writeTmpFile('PHOTO.PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const result = tryConvertImageFileToDataUrl(filePath);
        expect(result).toMatch(/^data:image\/png;base64,/);
    });
});

// ---------------------------------------------------------------------------
// Integration: view tool completion replaces result with data URL
// ---------------------------------------------------------------------------

vi.mock('../../src/copilot-sdk-wrapper/trusted-folder', async () => {
    const actual = await vi.importActual('../../src/copilot-sdk-wrapper/trusted-folder');
    return { ...actual, ensureFolderTrusted: vi.fn() };
});

vi.mock('../../src/copilot-sdk-wrapper/mcp-config-loader', () => ({
    loadDefaultMcpConfig: vi.fn().mockReturnValue({
        success: false, fileExists: false, mcpServers: {},
    }),
    mergeMcpConfigs: vi.fn().mockImplementation(
        (base: Record<string, any>, override?: Record<string, any>) => ({ ...base, ...override }),
    ),
}));

describe('CopilotSDKService - view tool image interception', () => {
    let service: CopilotSDKService;
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-img-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        resetCopilotSDKService();
        service = CopilotSDKService.getInstance();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        service.dispose();
        resetCopilotSDKService();
    });

    function setupStreamingCall() {
        const { MockCopilotClient, sessions } = createStreamingMockSDKModule();
        const serviceAny = service as any;
        serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
        serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

        const toolEvents: any[] = [];
        const resultPromise = service.sendMessage({
            prompt: 'Test prompt',
            workingDirectory: '/test',
            timeoutMs: 200000,
            loadDefaultMcpConfig: false,
            onToolEvent: (ev: any) => toolEvents.push(ev),
        });

        return { sessions, resultPromise, toolEvents };
    }

    it('should replace view tool result with data URL for image files', async () => {
        // Write a real PNG to disk
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            'base64',
        );
        const imgPath = path.join(tmpDir, 'screenshot.png');
        fs.writeFileSync(imgPath, png);

        const { sessions, resultPromise, toolEvents } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'Here is the image', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-img', toolName: 'view', arguments: { path: imgPath } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-img', success: true, result: { content: 'Viewed image file successfully.' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);

        // The captured tool call should have a data URL result
        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-img');
        expect(toolCall).toBeDefined();
        expect(toolCall!.result).toMatch(/^data:image\/png;base64,/);

        // The onToolEvent emission should also have the data URL
        const completeEvent = toolEvents.find(
            (e: any) => e.type === 'tool-complete' && e.toolCallId === 'tc-img',
        );
        expect(completeEvent).toBeDefined();
        expect(completeEvent.result).toMatch(/^data:image\/png;base64,/);
    });

    it('should NOT replace view tool result for non-image files', async () => {
        const txtPath = path.join(tmpDir, 'readme.txt');
        fs.writeFileSync(txtPath, 'Hello world');

        const { sessions, resultPromise, toolEvents } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'File contents', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-txt', toolName: 'view', arguments: { path: txtPath } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-txt', success: true, result: { content: '1. Hello world' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);

        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-txt');
        expect(toolCall).toBeDefined();
        expect(toolCall!.result).toBe('1. Hello world');

        const completeEvent = toolEvents.find(
            (e: any) => e.type === 'tool-complete' && e.toolCallId === 'tc-txt',
        );
        expect(completeEvent.result).toBe('1. Hello world');
    });

    it('should NOT replace result for non-view tools even with image path args', async () => {
        const imgPath = path.join(tmpDir, 'other.png');
        fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50]));

        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-grep', toolName: 'grep', arguments: { path: imgPath } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-grep', success: true, result: { content: 'grep result' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-grep');
        expect(toolCall!.result).toBe('grep result');
    });

    it('should gracefully fall back when image file does not exist', async () => {
        const { sessions, resultPromise } = setupStreamingCall();

        await vi.waitFor(() => {
            expect(sessions.length).toBe(1);
            expect(sessions[0].session.on).toHaveBeenCalled();
        }, { timeout: 1000 });

        const { dispatchEvent } = sessions[0];

        dispatchEvent({ type: 'assistant.message', data: { content: 'result', messageId: 'msg-1' } });
        dispatchEvent({
            type: 'tool.execution_start',
            data: { toolCallId: 'tc-missing', toolName: 'view', arguments: { path: '/nonexistent/photo.png' } },
        });
        dispatchEvent({
            type: 'tool.execution_complete',
            data: { toolCallId: 'tc-missing', success: true, result: { content: 'Viewed image file successfully.' } },
        });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        const toolCall = result.toolCalls?.find((tc: any) => tc.id === 'tc-missing');
        // Falls back to original result text
        expect(toolCall!.result).toBe('Viewed image file successfully.');
    });
});
