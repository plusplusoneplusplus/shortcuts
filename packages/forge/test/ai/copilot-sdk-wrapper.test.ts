/**
 * Copilot SDK Wrapper Module Tests
 *
 * Verifies that the copilot-sdk-wrapper barrel exports are complete
 * and that all types/functions are accessible from the wrapper module.
 * Also verifies backward compatibility through the ai/ re-exports.
 */

import { describe, it, expect } from 'vitest';

// Import from the wrapper module barrel
import {
    // Types
    approveAllPermissions,
    denyAllPermissions,
    // Attachment type
    Attachment,
    // Model Registry
    AIModel,
    VALID_MODELS,
    DEFAULT_MODEL_ID,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier,
    // SDK Service
    CopilotSDKService,
    getCopilotSDKService,
    resetCopilotSDKService,
    // MCP Config Loader
    getHomeDirectory,
    getMcpConfigPath,
    loadDefaultMcpConfig,
    mergeMcpConfigs,
    clearMcpConfigCache,
    mcpConfigExists,
    getCachedMcpConfig,
    setHomeDirectoryOverride,
    // Trusted Folder
    ensureFolderTrusted,
    isFolderTrusted,
    getCopilotConfigPath,
    setTrustedFolderHomeOverride,
    // Tool Event types
    ToolEvent,
    // Delivery mode type
    DeliveryMode,
} from '../../src/copilot-sdk-wrapper';

// Import from the ai/ barrel (backward compatibility)
import {
    // These should all be re-exported from copilot-sdk-wrapper
    MCPServerConfig as AiMCPServerConfig,
    SendMessageOptions as AiSendMessageOptions,
    Attachment as AiAttachment,
    TokenUsage as AiTokenUsage,
    SDKInvocationResult as AiSDKInvocationResult,
    PermissionHandler as AiPermissionHandler,
    approveAllPermissions as aiApproveAll,
    denyAllPermissions as aiDenyAll,
    CopilotSDKService as AiCopilotSDKService,
    getCopilotSDKService as aiGetService,
    resetCopilotSDKService as aiResetService,
    AIModel as AiAIModel,
    VALID_MODELS as AiVALID_MODELS,
    DEFAULT_MODEL_ID as AiDEFAULT_MODEL_ID,
    MODEL_REGISTRY as AiMODEL_REGISTRY,
    // AI-only types (not from wrapper)
    AIBackendType,
    AIInvocationResult,
    DEFAULT_PROMPTS,
} from '../../src/ai';

describe('Copilot SDK Wrapper Module', () => {
    describe('barrel exports', () => {
        it('should export model registry functions', () => {
            expect(typeof getModelLabel).toBe('function');
            expect(typeof getModelDescription).toBe('function');
            expect(typeof getModelDefinition).toBe('function');
            expect(typeof getAllModels).toBe('function');
            expect(typeof getActiveModels).toBe('function');
            expect(typeof isValidModelId).toBe('function');
            expect(typeof getModelCount).toBe('function');
            expect(typeof getModelsByTier).toBe('function');
        });

        it('should export model constants', () => {
            expect(VALID_MODELS).toBeDefined();
            expect(VALID_MODELS.length).toBeGreaterThan(0);
            expect(DEFAULT_MODEL_ID).toBeDefined();
            expect(MODEL_REGISTRY).toBeDefined();
            expect(MODEL_REGISTRY.size).toBeGreaterThan(0);
        });

        it('should export SDK service', () => {
            expect(CopilotSDKService).toBeDefined();
            expect(typeof getCopilotSDKService).toBe('function');
            expect(typeof resetCopilotSDKService).toBe('function');
        });

        it('should export MCP config loader functions', () => {
            expect(typeof getHomeDirectory).toBe('function');
            expect(typeof getMcpConfigPath).toBe('function');
            expect(typeof loadDefaultMcpConfig).toBe('function');
            expect(typeof mergeMcpConfigs).toBe('function');
            expect(typeof clearMcpConfigCache).toBe('function');
            expect(typeof mcpConfigExists).toBe('function');
            expect(typeof getCachedMcpConfig).toBe('function');
            expect(typeof setHomeDirectoryOverride).toBe('function');
        });

        it('should export trusted folder functions', () => {
            expect(typeof ensureFolderTrusted).toBe('function');
            expect(typeof isFolderTrusted).toBe('function');
            expect(typeof getCopilotConfigPath).toBe('function');
            expect(typeof setTrustedFolderHomeOverride).toBe('function');
        });

        it('should export permission helpers', () => {
            expect(typeof approveAllPermissions).toBe('function');
            expect(typeof denyAllPermissions).toBe('function');
        });

        it('should export ToolEvent type (compile-time check)', () => {
            // ToolEvent is a type — verify it can be used to type a variable
            const event: ToolEvent = {
                type: 'tool-start',
                toolCallId: 'test-id',
                toolName: 'view',
                parameters: { path: '/test' },
            };
            expect(event.type).toBe('tool-start');
            expect(event.toolCallId).toBe('test-id');
            expect(event.toolName).toBe('view');
        });
    });

    describe('permission helpers', () => {
        it('approveAllPermissions should return approved', () => {
            const result = approveAllPermissions(
                { kind: 'shell' },
                { sessionId: 'test' }
            );
            expect(result).toEqual({ kind: 'approved' });
        });

        it('denyAllPermissions should return denied-by-rules', () => {
            const result = denyAllPermissions(
                { kind: 'write' },
                { sessionId: 'test' }
            );
            expect(result).toEqual({ kind: 'denied-by-rules' });
        });
    });

    describe('ToolEvent type', () => {
        it('should support tool-start event', () => {
            const event: ToolEvent = {
                type: 'tool-start',
                toolCallId: 'tc-123',
                toolName: 'bash',
                parameters: { command: 'ls -la' },
            };
            expect(event.type).toBe('tool-start');
            expect(event.toolCallId).toBe('tc-123');
            expect(event.toolName).toBe('bash');
            expect(event.parameters).toEqual({ command: 'ls -la' });
        });

        it('should support tool-complete event', () => {
            const event: ToolEvent = {
                type: 'tool-complete',
                toolCallId: 'tc-123',
                toolName: 'view',
                result: 'file contents here',
            };
            expect(event.type).toBe('tool-complete');
            expect(event.result).toBe('file contents here');
        });

        it('should support tool-failed event', () => {
            const event: ToolEvent = {
                type: 'tool-failed',
                toolCallId: 'tc-456',
                toolName: 'edit',
                error: 'Permission denied',
            };
            expect(event.type).toBe('tool-failed');
            expect(event.error).toBe('Permission denied');
        });

        it('should allow optional fields', () => {
            const event: ToolEvent = {
                type: 'tool-start',
                toolCallId: 'tc-789',
            };
            expect(event.toolName).toBeUndefined();
            expect(event.parameters).toBeUndefined();
            expect(event.result).toBeUndefined();
            expect(event.error).toBeUndefined();
        });
    });

    describe('Attachment type', () => {
        it('should support file attachment', () => {
            const attachment: Attachment = {
                type: 'file',
                path: '/tmp/screenshot.png',
                displayName: 'screenshot.png',
            };
            expect(attachment.type).toBe('file');
            expect(attachment.path).toBe('/tmp/screenshot.png');
            expect(attachment.displayName).toBe('screenshot.png');
        });

        it('should support directory attachment', () => {
            const attachment: Attachment = {
                type: 'directory',
                path: '/home/user/project',
            };
            expect(attachment.type).toBe('directory');
            expect(attachment.path).toBe('/home/user/project');
            expect(attachment.displayName).toBeUndefined();
        });

        it('should work in SendMessageOptions.attachments', () => {
            const opts: AiSendMessageOptions = {
                prompt: 'Describe this image',
                attachments: [
                    { type: 'file', path: '/tmp/img.png', displayName: 'image' },
                    { type: 'directory', path: '/src' },
                ],
            };
            expect(opts.attachments).toHaveLength(2);
            expect(opts.attachments![0].type).toBe('file');
            expect(opts.attachments![1].type).toBe('directory');
        });

        it('should be optional in SendMessageOptions', () => {
            const opts: AiSendMessageOptions = {
                prompt: 'Hello',
            };
            expect(opts.attachments).toBeUndefined();
        });

        it('should be re-exported through ai/ barrel', () => {
            // AiAttachment imported from ai/ barrel should be the same type
            const attachment: AiAttachment = {
                type: 'file',
                path: '/tmp/test.txt',
            };
            expect(attachment.type).toBe('file');
        });
    });

    describe('DeliveryMode type', () => {
        it('should accept immediate and enqueue values', () => {
            const immediate: DeliveryMode = 'immediate';
            const enqueue: DeliveryMode = 'enqueue';
            expect(immediate).toBe('immediate');
            expect(enqueue).toBe('enqueue');
        });

        it('should be optional on SendMessageOptions', () => {
            const opts: AiSendMessageOptions = {
                prompt: 'Hello',
            };
            expect(opts.deliveryMode).toBeUndefined();
        });

        it('should be accepted on SendMessageOptions', () => {
            const opts: AiSendMessageOptions = {
                prompt: 'Hello',
                deliveryMode: 'enqueue',
            };
            expect(opts.deliveryMode).toBe('enqueue');
        });

        it('should coexist with mode (AgentMode) without conflict', () => {
            const opts: AiSendMessageOptions = {
                prompt: 'Hello',
                mode: 'autopilot',
                deliveryMode: 'enqueue',
            };
            expect(opts.mode).toBe('autopilot');
            expect(opts.deliveryMode).toBe('enqueue');
        });
    });

    describe('backward compatibility via ai/ barrel', () => {
        it('should re-export the same CopilotSDKService class', () => {
            expect(AiCopilotSDKService).toBe(CopilotSDKService);
        });

        it('should re-export the same permission helpers', () => {
            expect(aiApproveAll).toBe(approveAllPermissions);
            expect(aiDenyAll).toBe(denyAllPermissions);
        });

        it('should re-export the same convenience functions', () => {
            expect(aiGetService).toBe(getCopilotSDKService);
            expect(aiResetService).toBe(resetCopilotSDKService);
        });

        it('should re-export model constants', () => {
            expect(AiVALID_MODELS).toBe(VALID_MODELS);
            expect(AiDEFAULT_MODEL_ID).toBe(DEFAULT_MODEL_ID);
            expect(AiMODEL_REGISTRY).toBe(MODEL_REGISTRY);
        });

        it('should still export AI-specific types from ai/', () => {
            // These are not part of the wrapper — they stay in ai/
            expect(DEFAULT_PROMPTS).toBeDefined();
            expect(DEFAULT_PROMPTS.clarify).toBeDefined();
            expect(DEFAULT_PROMPTS.goDeeper).toBeDefined();
        });
    });
});
