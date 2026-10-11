import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getRepoDataPath } from '../../../src/server/paths';
import { cleanupTempDir, MAX_IMAGE_BYTES, saveImagesToTempFiles } from '../../../src/server/core/image-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, ModelInfo } from '@plusplusoneplusplus/forge';
import { getLogger, resolveWorkspaceExecutionContext, translatePathForExecution } from '@plusplusoneplusplus/forge';
import { assertIncomingImageFiles, assertChatImageTransport, assertCopilotImageModel, cleanupChatAttachmentTempDir, CHAT_IMAGE_FAILURE_TEXT } from '../../../src/server/executors/chat-image-policy';

vi.mock('@plusplusoneplusplus/forge', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        resolveWorkspaceExecutionContext: vi.fn(),
        translatePathForExecution: vi.fn(),
    };
});

const image: Attachment = { type: 'file', path: '/attachments/incoming/image.png', displayName: 'image.png' };

describe('admitted chat attachment cleanup', () => {
    let tempDir: string;
    beforeEach(() => { tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-attach-')); });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('keeps only admitted image files, including mixed-case extensions and data-URL image types', () => {
        const names = ['image.PNG', 'image.jpeg', 'image.avif', 'context.txt', 'document.pdf', 'unadmitted.png'];
        for (const name of names) fs.writeFileSync(path.join(tempDir, name), name);
        const attachments: Attachment[] = names.slice(0, -1).map(name => ({ type: 'file', path: path.join(tempDir, name) }));
        cleanupChatAttachmentTempDir(tempDir, attachments, ['data:image/avif;base64,aW1hZ2U=']);
        expect(fs.readdirSync(tempDir).sort()).toEqual(['image.PNG', 'image.avif', 'image.jpeg']);
        for (const name of names.slice(0, 3)) expect(fs.readFileSync(path.join(tempDir, name), 'utf8')).toBe(name);
        cleanupChatAttachmentTempDir(tempDir, attachments, ['data:image/avif;base64,aW1hZ2U=']);
        expect(fs.readdirSync(tempDir)).toHaveLength(3);
    });

    it('ignores damaged non-string image history instead of throwing', () => {
        const imagePath = path.join(tempDir, 'image.png');
        const documentPath = path.join(tempDir, 'document.txt');
        fs.writeFileSync(imagePath, 'image');
        fs.writeFileSync(documentPath, 'document');
        expect(() => cleanupChatAttachmentTempDir(tempDir, [
            { type: 'file', path: imagePath }, { type: 'file', path: documentPath },
        ], [123, null])).not.toThrow();
        expect(fs.readdirSync(tempDir)).toEqual(['image.png']);
    });

    it('removes document-only directories and unrelated contents', () => {
        const documentPath = path.join(tempDir, 'document.txt');
        fs.writeFileSync(documentPath, 'document');
        cleanupChatAttachmentTempDir(tempDir, [{ type: 'file', path: documentPath }]);
        expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('preserves immediate cleanup for images rejected before admission', () => {
        fs.writeFileSync(path.join(tempDir, 'image.png'), 'image');
        cleanupTempDir(tempDir);
        expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('removes empty image directories when decoding admits no attachments', () => {
        const saved = saveImagesToTempFiles(['invalid']);
        cleanupChatAttachmentTempDir(saved.tempDir, saved.attachments);
        expect(fs.existsSync(saved.tempDir)).toBe(false);
    });

    it('logs directory-read failures without interrupting turn resource cleanup', () => {
        const warn = vi.spyOn(getLogger(), 'warn');
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.writeFileSync(tempDir, 'not a directory');
        expect(() => cleanupChatAttachmentTempDir(tempDir, [{ type: 'file', path: path.join(tempDir, 'image.png') }])).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('non-image cleanup'));
    });
});

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


describe('Copilot image model policy', () => {
    const model = (vision: boolean): ModelInfo => ({
        id: 'vision-model', name: 'Vision model',
        capabilities: { supports: { vision, reasoningEffort: false }, limits: { max_context_window_tokens: 0 } },
    });

    it('accepts only the exact model advertising vision', () => {
        expect(() => assertCopilotImageModel('vision-model', model(true))).not.toThrow();
        expect(() => assertCopilotImageModel('vision-model', model(false))).toThrow(CHAT_IMAGE_FAILURE_TEXT.model);
    });

    it.each([
        [undefined, model(true)],
        ['other-model', model(true)],
        ['vision-model', undefined],
        ['vision-model', { id: 'vision-model', name: 'No capabilities' }],
    ])('fails closed for unknown identity or capability', (id, metadata) => {
        expect(() => assertCopilotImageModel(id as string | undefined, metadata as ModelInfo | undefined))
            .toThrow(CHAT_IMAGE_FAILURE_TEXT.unknownModel);
    });
});

describe('admitted incoming image storage policy', () => {
    let dataDir: string;
    let tempDir: string;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    let attachments: Attachment[];
    let images: string[];

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-policy-'));
        const root = getRepoDataPath(dataDir, 'ws-a', 'attachments');
        fs.mkdirSync(root, { recursive: true });
        tempDir = fs.mkdtempSync(path.join(root, 'incoming-'));
        const file = path.join(tempDir, 'image.png');
        fs.writeFileSync(file, png);
        attachments = [{ type: 'file', path: file }];
        images = [`data:image/png;base64,${png.toString('base64')}`];
    });
    afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    const validate = (files: unknown, history: unknown, dir: string, root: string) =>
        assertIncomingImageFiles(files, history, dir, root, 'ws-a');

    it('preserves complete images and leaves other attachment flows alone', async () => {
        await validate(attachments, images, tempDir, dataDir);
        await validate([{ type: 'file', path: 'missing-document.pdf' }], undefined, 'uploads', dataDir);
    });

    it.each([[], [123], ['data:image/png;base64,invalid'], Array(6).fill('bad')])(
        'rejects invalid or incomplete persisted history (%j)', async history => {
            await expect(validate(attachments, history, tempDir, dataDir)).rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
        },
    );

    it('honors turn cancellation before reading any prepared files', async () => {
        await expect(assertIncomingImageFiles(attachments, images, tempDir, dataDir, 'ws-a', AbortSignal.abort()))
            .rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
    });

    it('rejects changed valid image bytes as well as signature corruption', async () => {
        fs.writeFileSync(attachments[0].path, Buffer.concat([png, Buffer.from('changed')]));
        await expect(validate(attachments, images, tempDir, dataDir)).rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
    });

    it('bounds actual file bytes even when persisted history claims a small image', async () => {
        fs.writeFileSync(attachments[0].path, Buffer.alloc(MAX_IMAGE_BYTES + 1));
        await expect(validate(attachments, images, tempDir, dataDir)).rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
    });

    it('rejects a whole batch whose combined bytes exceed the cap', async () => {
        const large = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES / 2)]);
        fs.writeFileSync(attachments[0].path, large);
        const history = `data:image/png;base64,${large.toString('base64')}`;
        await expect(validate([attachments[0], attachments[0]], [history, history], tempDir, dataDir))
            .rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
    });

    it('rejects a file extension that disagrees with the saved MIME', async () => {
        const wrong = path.join(tempDir, 'image.gif');
        fs.renameSync(attachments[0].path, wrong);
        attachments[0].path = wrong;
        await expect(validate(attachments, images, tempDir, dataDir)).rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
    });

    it.skipIf(process.platform === 'win32')('rejects symbolic links even within the admitted directory', async () => {
        const linked = path.join(tempDir, 'linked.png');
        fs.symlinkSync(attachments[0].path, linked);
        attachments[0].path = linked;
        await expect(validate(attachments, images, tempDir, dataDir)).rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
    });

    it.skipIf(process.platform === 'win32')('accepts a data directory reached through a symlinked ancestor', async () => {
        // macOS tmpdir (/var -> /private/var) and symlinked home directories take this path.
        const alias = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'image-policy-alias-')), 'data');
        fs.symlinkSync(dataDir, alias);
        try {
            const aliasTempDir = path.join(alias, path.relative(dataDir, tempDir));
            const aliasAttachments = [{ type: 'file' as const, path: path.join(aliasTempDir, 'image.png') }];
            await validate(aliasAttachments, images, aliasTempDir, alias);
        } finally {
            fs.rmSync(path.dirname(alias), { recursive: true, force: true });
        }
    });

    it.skipIf(process.platform === 'win32')('rejects a symlinked attachments directory below the data directory', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'image-policy-outside-'));
        const root = getRepoDataPath(dataDir, 'ws-a', 'attachments');
        fs.renameSync(tempDir, path.join(outside, path.basename(tempDir)));
        fs.rmSync(root, { recursive: true, force: true });
        fs.symlinkSync(outside, root);
        try {
            await expect(validate(attachments, images, tempDir, dataDir)).rejects.toThrow(CHAT_IMAGE_FAILURE_TEXT.storage);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
