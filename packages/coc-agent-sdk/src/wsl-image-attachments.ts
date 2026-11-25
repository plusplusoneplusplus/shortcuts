import * as fs from 'node:fs';
import type { SendMessageOptions } from './types';
import { isSupportedCodexImagePath, MAX_CLAUDE_IMAGE_BYTES } from './image-converter';
import {
    resolveWorkspaceExecutionContextAsync,
    translatePathForExecution,
    translatePathForHostFilesystem,
} from './platform/workspace-execution';

/** All three image-capable SDKs run on the host, including for WSL repos. */
export async function prepareWslImageOptions(options: SendMessageOptions): Promise<SendMessageOptions> {
    if (!options.attachments?.some(a => a.type === 'file' && isSupportedCodexImagePath(a.path))) return options;
    const context = await resolveWorkspaceExecutionContextAsync(options.workingDirectory);
    if (context.kind !== 'wsl') return options;
    if (options.signal?.aborted) throw new Error('Request aborted');
    if (!context.distro) throw new Error('Cannot deliver WSL images without a resolved workspace distribution');

    const attachments = options.attachments.map(attachment => {
        if (attachment.type !== 'file' || !isSupportedCodexImagePath(attachment.path)) return attachment;
        let fd: number | undefined;
        try {
            // Validate distro ownership even when the original path is already UNC.
            translatePathForExecution(attachment.path, context);
            const hostPath = translatePathForHostFilesystem(attachment.path, context);
            // Keep admitted per-turn files in place. No workspace copies, shared
            // staging directory, or extra temporary lifetime to coordinate.
            const entry = fs.lstatSync(hostPath);
            if (entry.isSymbolicLink() || !entry.isFile()) throw new Error();
            fd = fs.openSync(hostPath, 'r');
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size === 0 || stat.size > MAX_CLAUDE_IMAGE_BYTES) throw new Error();
            return { ...attachment, path: hostPath };
        } catch {
            throw new Error('Cannot read WSL image attachment: resend a regular image file from the same workspace (maximum 10 MB)');
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
    });
    if (options.signal?.aborted) throw new Error('Request aborted');
    return {
        ...options,
        workingDirectory: translatePathForHostFilesystem(options.workingDirectory!, context),
        attachments,
    };
}
