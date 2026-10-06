import type { Attachment } from '@plusplusoneplusplus/forge';
import { isWithinDirectory, resolveWorkspaceExecutionContext, translatePathForExecution } from '@plusplusoneplusplus/forge';
import type { ChatProvider } from '../tasks/task-types';

/** Fixed messages safe to send through either messaging answer relay. */
export const CHAT_IMAGE_FAILURE_TEXT = {
    provider: 'This provider cannot receive image attachments. Select Copilot, Codex, or Claude and send the images again.',
    wsl: 'This workspace cannot receive these image attachments in WSL. Select a native workspace and send the images again.',
} as const;

/** Check adapter transport support before calling the SDK, including resumed turns. */
export function assertChatImageTransport(
    provider: ChatProvider,
    attachments: readonly Attachment[] | undefined,
    workingDirectory?: string,
): void {
    const images = attachments?.filter(attachment => attachment.type === 'file'
        && /\.(?:png|jpe?g|gif|webp)$/i.test(attachment.path));
    if (!images?.length) return;

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
