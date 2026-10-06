import * as fs from 'node:fs';
import * as path from 'node:path';
import { downloadInboundImage } from '@plusplusoneplusplus/coc-connector';
import { MAX_IMAGE_BYTES, parseDataUrl } from '../core/image-utils';
import { getRepoDataPath } from '../paths';
import type { Attachment, ModelInfo } from '@plusplusoneplusplus/forge';
import { isWithinDirectory, resolveWorkspaceExecutionContext, translatePathForExecution } from '@plusplusoneplusplus/forge';
import type { ChatProvider } from '../tasks/task-types';

/** Fixed messages safe to send through either messaging answer relay. */
export const CHAT_IMAGE_FAILURE_TEXT = {
    storage: 'The saved images are missing or invalid. Send the images again with your instructions.',
    provider: 'This provider cannot receive image attachments. Select Copilot, Codex, or Claude and send the images again.',
    wsl: 'This workspace cannot receive these image attachments in WSL. Select a native workspace and send the images again.',
    model: 'This model cannot receive image attachments. Select a model with vision support and send the images again.',
    unknownModel: 'Image support could not be confirmed for this model. Select an explicit Copilot model with vision support and send the images again.',
} as const;

export function getChatImageAttachments(attachments: readonly Attachment[] | undefined): Attachment[] {
    return attachments?.filter(attachment => attachment.type === 'file'
        && /\.(?:png|jpe?g|gif|webp)$/i.test(attachment.path)) ?? [];
}

/** Copilot's catalog advertises vision; provider-default identity is unknown. */
export function assertCopilotImageModel(modelId: string | undefined, model: ModelInfo | undefined): void {
    if (!modelId || model?.id !== modelId || typeof model.capabilities?.supports?.vision !== 'boolean') {
        throw new Error(CHAT_IMAGE_FAILURE_TEXT.unknownModel);
    }
    if (!model.capabilities.supports.vision) throw new Error(CHAT_IMAGE_FAILURE_TEXT.model);
}

/** Check adapter transport support before calling the SDK, including resumed turns. */
export function assertChatImageTransport(
    provider: ChatProvider,
    attachments: readonly Attachment[] | undefined,
    workingDirectory?: string,
): void {
    const images = getChatImageAttachments(attachments);
    if (!images.length) return;

    // OpenCode currently builds text parts only; file references are not images.
    if (provider === 'opencode') throw new Error(CHAT_IMAGE_FAILURE_TEXT.provider);
    if (provider !== 'copilot') return;

    const context = resolveWorkspaceExecutionContext(workingDirectory);
    if (context.kind !== 'wsl') return;
    // Mirror RequestRunner's restriction, projecting a safe, actionable error
    // rather than its exception containing host paths and distro details.
    try {
        for (const image of images) {
            const translated = translatePathForExecution(image.path, context);
            if (!isWithinDirectory(translated, context.linuxWorkingDirectory)) {
                throw new Error('outside workspace');
            }
        }
    } catch {
        throw new Error(CHAT_IMAGE_FAILURE_TEXT.wsl);
    }
}

/** Revalidate admitted connector files after queue persistence or restart. */
export async function assertIncomingImageFiles(
    attachments: unknown,
    images: unknown,
    tempDir: string | undefined,
    dataDir: string,
    workspaceId: string | undefined,
    signal?: AbortSignal,
): Promise<void> {
    // Connector preparation owns incoming-* directories. Other attachment flows
    // retain their existing document/image policy and limits.
    if (!tempDir || !path.basename(tempDir).startsWith('incoming-')) return;
    try {
        if (!workspaceId || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(workspaceId)
            || !Array.isArray(images) || !images.length || images.length > 5
            || !Array.isArray(attachments) || attachments.length !== images.length) throw new Error();
        const root = getRepoDataPath(path.resolve(dataDir), workspaceId, 'attachments');
        if (path.dirname(path.resolve(tempDir)) !== root
            || fs.realpathSync(tempDir) !== path.resolve(tempDir)) throw new Error();
        let remainingBytes = MAX_IMAGE_BYTES;
        const deadline = Date.now() + 30_000;
        for (let index = 0; index < images.length; index++) {
            const image = images[index];
            // Bound base64 before decoding; the history and SDK file must agree.
            if (typeof image !== 'string' || image.length > Math.ceil(remainingBytes / 3) * 4 + 64) throw new Error();
            const parsed = parseDataUrl(image);
            const attachment = attachments[index];
            if (!parsed || !parsed.buffer.length || parsed.buffer.length > remainingBytes
                || !attachment || attachment.type !== 'file' || typeof attachment.path !== 'string'
                || path.dirname(path.resolve(attachment.path)) !== path.resolve(tempDir)
                || fs.realpathSync(attachment.path) !== path.resolve(attachment.path)) throw new Error();
            const expectedExtension = path.extname(attachment.path).toLowerCase();
            if (expectedExtension !== `.${parsed.extension}`
                && !(parsed.extension === 'jpg' && expectedExtension === '.jpeg')) throw new Error();
            const bytes = await downloadInboundImage(parsed.mimeType,
                async () => fs.createReadStream(attachment.path),
                { maxBytes: remainingBytes, timeoutMs: deadline - Date.now(), signal });
            if (!bytes.equals(parsed.buffer)) throw new Error();
            remainingBytes -= bytes.length;
        }
    } catch {
        throw new Error(CHAT_IMAGE_FAILURE_TEXT.storage);
    }
}
