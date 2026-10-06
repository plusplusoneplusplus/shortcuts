import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment } from '@plusplusoneplusplus/forge';
import { resolveWorkspaceExecutionContext, translatePathForExecution } from '@plusplusoneplusplus/forge';
import { assertChatImageTransport, CHAT_IMAGE_FAILURE_TEXT } from '../../../src/server/executors/chat-image-policy';

vi.mock('@plusplusoneplusplus/forge', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        resolveWorkspaceExecutionContext: vi.fn(),
        translatePathForExecution: vi.fn(),
    };
});

const image: Attachment = { type: 'file', path: '/attachments/incoming/image.png', displayName: 'image.png' };

describe('chat image transport policy', () => {
    beforeEach(() => {
        vi.mocked(resolveWorkspaceExecutionContext).mockReset().mockReturnValue({ kind: 'windows' });
        vi.mocked(translatePathForExecution).mockReset();
    });

    it.each(['copilot', 'codex', 'claude'] as const)('preserves native %s image delivery', provider => {
        expect(() => assertChatImageTransport(provider, [image], '/workspace')).not.toThrow();
    });

    it('rejects OpenCode even when its model advertises vision', () => {
        expect(() => assertChatImageTransport('opencode', [image])).toThrow(CHAT_IMAGE_FAILURE_TEXT.provider);
    });

    it('preserves text, document and directory turns', () => {
        assertChatImageTransport('opencode', undefined);
        assertChatImageTransport('opencode', []);
        assertChatImageTransport('opencode', [{ ...image, path: '/file.txt' }, { ...image, type: 'directory' }]);
        expect(resolveWorkspaceExecutionContext).not.toHaveBeenCalled();
    });

    it('recognizes every supported raster extension, including uppercase', () => {
        for (const extension of ['PNG', 'jpg', 'jpeg', 'gif', 'webp']) {
            expect(() => assertChatImageTransport('opencode', [{ ...image, path: `/image.${extension}` }]))
                .toThrow(CHAT_IMAGE_FAILURE_TEXT.provider);
        }
    });

    function wsl() {
        vi.mocked(resolveWorkspaceExecutionContext).mockReturnValue({
            kind: 'wsl', linuxWorkingDirectory: '/workspace', originalWorkingDirectory: '\\\\wsl$\\Ubuntu\\workspace', distro: 'Ubuntu',
        });
    }

    it('permits Copilot attachments translated inside the WSL workspace', () => {
        wsl();
        vi.mocked(translatePathForExecution).mockReturnValue('/workspace/images/image.png');
        expect(() => assertChatImageTransport('copilot', [image], '/workspace')).not.toThrow();
    });

    it('rejects an entire batch if one image is outside the WSL workspace', () => {
        wsl();
        vi.mocked(translatePathForExecution).mockReturnValueOnce('/workspace/image.png').mockReturnValueOnce('/workspace-other/image.png');
        expect(() => assertChatImageTransport('copilot', [image, image], '/workspace')).toThrow(CHAT_IMAGE_FAILURE_TEXT.wsl);
    });

    it('hides path and distro details when WSL translation fails', () => {
        wsl();
        vi.mocked(translatePathForExecution).mockImplementation(() => { throw new Error('private host path and distro'); });
        expect(() => assertChatImageTransport('copilot', [image], '/workspace')).toThrow(CHAT_IMAGE_FAILURE_TEXT.wsl);
    });

    it.each(['codex', 'claude'] as const)('does not apply Copilot WSL restrictions to %s', provider => {
        wsl();
        assertChatImageTransport(provider, [image], '/workspace');
        expect(translatePathForExecution).not.toHaveBeenCalled();
    });
});
