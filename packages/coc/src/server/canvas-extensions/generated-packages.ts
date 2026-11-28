import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { isWithinDirectory, type ProcessStore } from '@plusplusoneplusplus/forge';
import { writeFileAtomic } from '../canvas/canvas-atomic-write';
import { isSafeCanvasFilePath } from '../canvas/canvas-file-sandbox';
import { resolveRepoGroupReadRoots, TRUSTED_READ_ONLY_DIRS } from '../tasks/tasks-handler-utils';
import { sessionWorkspacePath, type SessionOwner } from './session-workspace';
import { discoverCanvasExtensions, type DiscoveredCanvasExtension } from './discovery';
import type { CLIConfig } from '../../config';

export const GENERATED_SOURCE_BYTES = 512 * 1024;
export const GENERATED_ASSET_BYTES = 8 * 1024 * 1024;
export const GENERATED_PACKAGE_BYTES = 32 * 1024 * 1024;
export const GENERATED_ASSET_COUNT = 20;
export const GENERATED_STARTUP_MS = 60_000;

export interface GeneratedAsset { path: string; sourcePath: string }
export interface GeneratedPublication {
    id: string;
    revision: string;
    contentHash: string;
    cwd: string;
    assets: string[];
    /** A crash during replacement requires explicit reload, never action replay. */
    status: 'committed' | 'failed' | 'deleting';
}
export interface GeneratedPackage extends GeneratedPublication {
    extension: DiscoveredCanvasExtension;
    sourcePath: string;
    assetPaths: { path: string; sourcePath: string }[];
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function generatedOwnerRoot(dataDir: string, owner: SessionOwner): string {
    const state = sessionWorkspacePath(dataDir, owner);
    return path.join(path.dirname(path.dirname(state)), 'generated', path.basename(state));
}
export function generatedPackageRoot(dataDir: string, owner: SessionOwner, id: string): string {
    if (!ID.test(id)) { throw new Error('Invalid generated package ID'); }
    return path.join(generatedOwnerRoot(dataDir, owner), id);
}
export function generatedExtensionKey(owner: SessionOwner, id: string): string {
    if (!ID.test(id)) { throw new Error('Invalid generated package ID'); }
    return `generated/${owner.workspaceId}/${Buffer.from(owner.processId).toString('hex')}/${id}`;
}

/** Validate every existing ancestor: managed paths must never traverse application-created symlinks. */
export function assertManagedPath(dataDir: string, target: string): void {
    const root = path.resolve(dataDir);
    const absolute = path.resolve(target);
    if (!isWithinDirectory(absolute, root) || absolute === root) { throw new Error('Managed path escapes data directory'); }
    let cursor = root;
    for (const segment of path.relative(root, absolute).split(path.sep)) {
        cursor = path.join(cursor, segment);
        try {
            if (fs.lstatSync(cursor).isSymbolicLink()) { throw new Error('Managed path contains a symlink'); }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {break; }
            throw error;
        }
    }
}
export function removeManagedPath(dataDir: string, target: string): void {
    assertManagedPath(dataDir, target);
    fs.rmSync(target, { recursive: true, force: true });
}
function names(directory: string): string[] {
    try { return fs.readdirSync(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return []; } throw error; }
}

export function readGeneratedPackage(dataDir: string, owner: SessionOwner, id: string): GeneratedPackage | undefined {
    const root = generatedPackageRoot(dataDir, owner, id);
    assertManagedPath(dataDir, root);
    let publication: GeneratedPublication;
    assertManagedPath(dataDir, path.join(root, 'publication.json'));
    try { publication = JSON.parse(fs.readFileSync(path.join(root, 'publication.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') {return undefined; } throw error; }
    if (publication.id !== id || !ID.test(publication.revision) || typeof publication.cwd !== 'string'
        || !path.isAbsolute(publication.cwd) || !Array.isArray(publication.assets)
        || publication.assets.some(asset => !isSafeCanvasFilePath(asset))
        || !['committed', 'failed', 'deleting'].includes(publication.status)) { throw new Error('Invalid generated publication'); }
    const revisionRoot = path.join(root, 'revisions', publication.revision);
    const sourcePath = path.join(revisionRoot, 'extension.mjs');
    assertManagedPath(dataDir, sourcePath);
    if (publication.status !== 'deleting' && !fs.statSync(sourcePath).isFile()) { throw new Error('Generated source is missing'); }
    const assetPaths = publication.assets.map(asset => {
        const sourcePath = path.join(revisionRoot, 'assets', asset);
        assertManagedPath(dataDir, sourcePath);
        return { path: asset, sourcePath };
    });
    return { ...publication, sourcePath, assetPaths,
        extension: { generatedId: id, extensionKey: generatedExtensionKey(owner, id), name: id, ownerWorkspaceId: owner.workspaceId,
            extensionPath: sourcePath, cwd: publication.cwd, contentHash: publication.contentHash },
    };
}
export function listGeneratedPackages(dataDir: string, owner: SessionOwner): GeneratedPackage[] {
    const root = generatedOwnerRoot(dataDir, owner);
    assertManagedPath(dataDir, root);
    return names(root).filter(id => ID.test(id)).flatMap(id => {
        const item = readGeneratedPackage(dataDir, owner, id);
        return item ? [item] : [];
    });
}
export function writeGeneratedPublication(dataDir: string, owner: SessionOwner, publication: GeneratedPublication): void {
    const root = generatedPackageRoot(dataDir, owner, publication.id);
    assertManagedPath(dataDir, root);
    fs.mkdirSync(root, { recursive: true });
    const { id, revision, contentHash, cwd, assets, status } = publication;
    writeFileAtomic(path.join(root, 'publication.json'), JSON.stringify({ id, revision, contentHash, cwd, assets, status }));
}

/** Installed catalog remains workspace-wide; generated resolution always requires an exact owner. */
export async function resolveOwnerCanvasExtensions(options: {
    dataDir: string; workspaceId: string; processId: string; store: ProcessStore;
    config: Pick<CLIConfig, 'canvasExtensions'>;
}): Promise<DiscoveredCanvasExtension[]> {
    if (!options.config.canvasExtensions?.enabled) {return []; }
    const owner = await options.store.getProcess(options.processId, options.workspaceId);
    if (!owner || owner.archived || owner.metadata?.workspaceId !== options.workspaceId) { throw new Error('Canvas owner unavailable'); }
    return [...await discoverCanvasExtensions(options), ...listGeneratedPackages(options.dataDir, options).filter(item => item.status !== 'deleting').map(item => item.extension)];
}

/** Source access follows workspace/member and trusted staging roots, with realpath containment. */
export async function generatedSourceContext(dataDir: string, owner: SessionOwner, store: ProcessStore) {
    const process = await store.getProcess(owner.processId, owner.workspaceId);
    if (!process || process.archived || process.metadata?.workspaceId !== owner.workspaceId) { throw new Error('Canvas owner unavailable'); }
    if (!['autopilot', 'ralph', 'sentinel'].includes(String(process.metadata?.mode))) { throw new Error('Generated publication requires a write-capable turn'); }
    if (process.type !== 'chat') { throw new Error('Generated source requires a conversation owner'); }
    const members = await resolveRepoGroupReadRoots(dataDir, store, owner.workspaceId);
    const workspace = (await store.getWorkspaces()).find(item => item.id === owner.workspaceId);
    if (!workspace) throw new Error('Canvas workspace owner is unavailable');
    const roots = members.length ? members.map(item => item.rootPath) : workspace ? [workspace.rootPath] : [];
    const realRoots = roots.map(root => fs.realpathSync(root));
    const cwd = process.workingDirectory ? fs.realpathSync(process.workingDirectory) : undefined;
    if (!cwd || !realRoots.some(root => isWithinDirectory(cwd, root))) { throw new Error('Conversation working directory is unavailable'); }
    return { cwd, roots: [...roots.map(root => path.resolve(root)), ...TRUSTED_READ_ONLY_DIRS.filter(root => fs.existsSync(root))] };
}
function readSource(source: string, roots: string[], limit: number): Buffer {
    if (typeof source !== 'string' || !path.isAbsolute(source)) { throw new Error('sourcePath must be absolute'); }
    const real = fs.realpathSync(source);
    // Lexical and resolved ownership must agree; a symlink cannot grant a new read root.
    if (!roots.some(root => isWithinDirectory(source, root) && isWithinDirectory(real, fs.realpathSync(root)))) { throw new Error('Source is outside authorized read roots'); }
    const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > limit) { throw new Error(`Source exceeds ${limit} bytes or is not a file`); }
        const buffer = Buffer.alloc(limit + 1);
        let size = 0;
        while (size < buffer.length) {
            const read = fs.readSync(fd, buffer, size, buffer.length - size, size);
            if (read === 0) {break; }
            size += read;
        }
        if (size > limit) { throw new Error(`Source exceeds ${limit} bytes`); }
        return buffer.subarray(0, size);
    } finally { fs.closeSync(fd); }
}
export function stageGeneratedPackage(dataDir: string, owner: SessionOwner, context: { cwd: string; roots: string[] },
    args: { sourcePath: string; assets?: GeneratedAsset[] }, id: string = randomUUID()): GeneratedPackage {
    const assets = args.assets ?? [];
    if (!Array.isArray(assets) || assets.length > GENERATED_ASSET_COUNT) { throw new Error('At most 20 assets are allowed'); }
    const seen = new Set<string>();
    const files: { name: string; bytes: Buffer }[] = [{ name: 'extension.mjs', bytes: readSource(args.sourcePath, context.roots, GENERATED_SOURCE_BYTES) }];
    let total = files[0].bytes.length;
    for (const asset of assets) {
        if (!asset || Object.keys(asset).some(key => key !== 'path' && key !== 'sourcePath') || typeof asset.path !== 'string' || !isSafeCanvasFilePath(asset.path)
            || asset.path.includes('\\') || asset.path.split('/').some(segment => /^(?:extension\.mjs|publication\.json|package\.json|node_modules|revisions|\.tmp.*)$/i.test(segment))
            || asset.path.split('/').some(segment => /[<>:"|?*]|[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))
            || seen.has(asset.path.toLowerCase())) { throw new Error('Invalid, reserved or duplicate asset destination'); }
        seen.add(asset.path.toLowerCase());
        const bytes = readSource(asset.sourcePath, context.roots, GENERATED_ASSET_BYTES);
        total += bytes.length;
        if (total > GENERATED_PACKAGE_BYTES) { throw new Error('Generated package exceeds 32 MiB'); }
        files.push({ name: `assets/${asset.path}`, bytes });
    }
    const revision = randomUUID();
    const root = path.join(generatedPackageRoot(dataDir, owner, id), 'revisions', revision);
    assertManagedPath(dataDir, root);
    const hash = createHash('sha256');
    try {
        for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
            hash.update(JSON.stringify([file.name, file.bytes.length])).update(file.bytes);
            const destination = path.join(root, file.name);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, file.bytes, { flag: 'wx' });
        }
    } catch (error) { removeManagedPath(dataDir, root); throw error; }
    const publication: GeneratedPublication = { id, revision, contentHash: hash.digest('hex'), cwd: context.cwd,
        assets: assets.map(asset => asset.path), status: 'committed' };
    return { ...publication, sourcePath: path.join(root, 'extension.mjs'),
        assetPaths: assets.map(asset => ({ path: asset.path, sourcePath: path.join(root, 'assets', asset.path) })),
        extension: { generatedId: id, extensionKey: generatedExtensionKey(owner, id), name: id, ownerWorkspaceId: owner.workspaceId,
            extensionPath: path.join(root, 'extension.mjs'), cwd: context.cwd, contentHash: publication.contentHash } };
}

/** Node's check mode parses ESM without importing or executing it. */
export function checkGeneratedSyntax(sourcePath: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--check', sourcePath], {
            stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, signal, timeout: GENERATED_STARTUP_MS,
        });
        child.once('error', reject);
        child.once('exit', (code, killed) => code === 0 ? resolve() : reject(new Error(`Invalid extension syntax (${code ?? killed})`)));
    });
}
