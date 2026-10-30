import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../config';
import { isRepoGroupWorkspaceId, resolveRepoGroupMembers } from '../workspaces/repo-group-workspace';

export interface DiscoveredCanvasExtension {
    extensionKey: string;
    name: string;
    /** Registered member workspace ID, or "global" for the user scope. */
    ownerWorkspaceId: string;
    extensionPath: string;
    /** Owning repository root, or the extension folder for user extensions. */
    cwd: string;
    description?: string;
    /** SHA-256 of the entry point and optional package metadata. */
    contentHash: string;
}

export interface CanvasExtensionDiscoveryOptions {
    config: Pick<CLIConfig, 'canvasExtensions'>;
    store: ProcessStore;
    dataDir: string;
    workspaceId: string;
}

/** Read discovery metadata only; importing an extension belongs to the runtime host. */
export async function discoverCanvasExtensions(
    options: CanvasExtensionDiscoveryOptions,
): Promise<DiscoveredCanvasExtension[]> {
    if (!options.config.canvasExtensions?.enabled) return [];

    const { store, dataDir, workspaceId } = options;
    const roots: { ownerWorkspaceId: string; rootPath: string }[] = [];
    if (isRepoGroupWorkspaceId(workspaceId)) {
        for (const member of await resolveRepoGroupMembers(dataDir, store, workspaceId)) {
            if (!member.stale && member.rootPath) {
                roots.push({ ownerWorkspaceId: member.workspaceId, rootPath: member.rootPath });
            }
        }
    } else {
        const workspace = (await store.getWorkspaces()).find(w => w.id === workspaceId);
        if (workspace && !workspace.virtual) {
            roots.push({ ownerWorkspaceId: workspace.id, rootPath: workspace.rootPath });
        }
    }

    const extensions: DiscoveredCanvasExtension[] = [];
    for (const root of roots) {
        extensions.push(...await discoverDirectory(
            path.join(root.rootPath, '.github', 'extensions'), root.ownerWorkspaceId, root.rootPath,
        ));
    }
    // COPILOT_HOME is runtime storage isolation, never the user discovery root.
    extensions.push(...await discoverDirectory(path.join(os.homedir(), '.copilot', 'extensions'), 'global'));
    return extensions;
}

async function discoverDirectory(
    directory: string,
    ownerWorkspaceId: string,
    repoRoot?: string,
): Promise<DiscoveredCanvasExtension[]> {
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (isMissing(error)) return [];
        throw error;
    }

    const extensions: DiscoveredCanvasExtension[] = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const extensionFolder = path.join(directory, entry.name);
        const extensionPath = path.join(extensionFolder, 'extension.mjs');
        let source: Buffer;
        try {
            if (!(await fs.stat(extensionPath)).isFile()) continue;
            source = await fs.readFile(extensionPath);
        } catch (error) {
            if (isMissing(error)) continue;
            throw error;
        }

        let metadata: Buffer | undefined;
        try {
            metadata = await fs.readFile(path.join(extensionFolder, 'package.json'));
        } catch (error) {
            if (!isMissing(error)) throw error;
        }
        let description: string | undefined;
        if (metadata) {
            try {
                const parsed: unknown = JSON.parse(metadata.toString('utf8'));
                if (parsed && typeof parsed === 'object' && 'description' in parsed
                    && typeof parsed.description === 'string' && parsed.description.trim()) {
                    description = parsed.description.trim();
                }
            } catch {
                // Optional invalid metadata does not hide an otherwise runnable extension.
            }
        }
        const contentHash = createHash('sha256')
            .update(String(source.length)).update(':').update(source)
            .update(metadata ? 'package:' : 'no-package:').update(metadata ?? '').digest('hex');
        extensions.push({
            extensionKey: `${ownerWorkspaceId}:${entry.name}`,
            name: entry.name,
            ownerWorkspaceId,
            extensionPath,
            cwd: repoRoot ?? extensionFolder,
            ...(description ? { description } : {}),
            contentHash,
        });
    }
    return extensions;
}

function isMissing(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
