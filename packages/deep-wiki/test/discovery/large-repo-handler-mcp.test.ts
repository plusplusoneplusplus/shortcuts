/**
 * Large Repo Handler — MCP Config Tests
 *
 * Tests that all sendMessage calls in large-repo-handler pass
 * loadDefaultMcpConfig: false to avoid user MCP config issues.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', () => ({
    getCopilotSDKService: () => ({
        sendMessage: mockSendMessage,
        isAvailable: mockIsAvailable,
    }),
}));

vi.mock('../../src/logger', () => ({
    printInfo: vi.fn(),
    printWarning: vi.fn(),
    gray: (s: string) => s,
    cyan: (s: string) => s,
}));

vi.mock('../../src/discovery/prompts', () => ({
    buildStructuralScanPrompt: vi.fn().mockReturnValue('mock structural scan prompt'),
    buildFocusedDiscoveryPrompt: vi.fn().mockReturnValue('mock focused prompt'),
    buildDiscoveryPrompt: vi.fn().mockReturnValue('mock discovery prompt'),
}));

const mockParseStructuralScan = vi.fn();
const mockParseComponentGraph = vi.fn();
vi.mock('../../src/discovery/response-parser', () => ({
    parseStructuralScanResponse: (...args: any[]) => mockParseStructuralScan(...args),
    parseComponentGraphResponse: (...args: any[]) => mockParseComponentGraph(...args),
}));

vi.mock('../../src/schemas', () => ({
    normalizeComponentId: (id: string) => id.toLowerCase().replace(/[/\\]/g, '-').replace(/-$/, ''),
}));

vi.mock('../../src/cache', () => ({
    getCachedStructuralScan: vi.fn().mockReturnValue(null),
    getCachedStructuralScanAny: vi.fn().mockReturnValue(null),
    saveStructuralScan: vi.fn(),
    getCachedDomainSubGraph: vi.fn().mockReturnValue(null),
    saveDomainSubGraph: vi.fn(),
}));

import { estimateFileCount, discoverLargeRepo } from '../../src/discovery/large-repo-handler';

describe('Large Repo Handler — MCP Config', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsAvailable.mockResolvedValue(true);
        mockParseStructuralScan.mockReturnValue({
            fileCount: 5000,
            domains: [{ name: 'core', path: 'core/', description: 'Core domain' }],
            projectInfo: { name: 'test-project' },
        });
        mockParseComponentGraph.mockReturnValue({
            project: { name: 'test', description: '', language: 'TS', buildSystem: 'npm', entryPoints: [] },
            components: [{ id: 'comp', name: 'Comp', path: 'src/', purpose: '', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' }],
            categories: [{ name: 'core', description: 'Core' }],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('estimateFileCount', () => {
        it('passes loadDefaultMcpConfig: false to sendMessage', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '4200',
            });

            await estimateFileCount('/repo');

            expect(mockSendMessage).toHaveBeenCalledTimes(1);
            const sendOptions = mockSendMessage.mock.calls[0][0];
            expect(sendOptions.loadDefaultMcpConfig).toBe(false);
        });

        it('returns -1 on failure', async () => {
            mockSendMessage.mockResolvedValue({
                success: false,
                error: 'SDK error',
            });

            const count = await estimateFileCount('/repo');
            expect(count).toBe(-1);
        });
    });

    describe('discoverLargeRepo', () => {
        it('passes loadDefaultMcpConfig: false to structural scan and domain discovery', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'mock response',
            });

            await discoverLargeRepo({ repoPath: '/repo' });

            // Should have 2 calls: structural scan + 1 domain
            expect(mockSendMessage).toHaveBeenCalledTimes(2);

            for (let i = 0; i < mockSendMessage.mock.calls.length; i++) {
                const sendOptions = mockSendMessage.mock.calls[i][0];
                expect(sendOptions.loadDefaultMcpConfig).toBe(false);
            }
        });

        it('uses read-only tools for all SDK calls', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: 'mock response',
            });

            await discoverLargeRepo({ repoPath: '/repo' });

            for (let i = 0; i < mockSendMessage.mock.calls.length; i++) {
                const sendOptions = mockSendMessage.mock.calls[i][0];
                expect(sendOptions.availableTools).toEqual(['view', 'grep', 'glob']);
            }
        });
    });
});
