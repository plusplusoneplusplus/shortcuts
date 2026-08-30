/**
 * Repo-Group virtual workspace store.
 *
 * A repo group is a named virtual workspace (own root under
 * `~/.coc/repos/<groupId>/`, no git) that references a set of
 * already-registered repo workspaces. Membership is persisted as
 * `group.json` in the group root, holding member workspace IDs only —
 * member names and local paths are always resolved from the workspace
 * registry at read time, never denormalized into the file.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';

/** Prefix identifying repo-group workspace IDs without a registry lookup. */
export const REPO_GROUP_ID_PREFIX = 'group-';

/** Membership file name inside the group workspace root. */
export const REPO_GROUP_FILE_NAME = 'group.json';

/** Longest per-member description accepted on write. */
export const REPO_GROUP_DESCRIPTION_MAX_LENGTH = 280;

/** Shape of the persisted `group.json` membership file. */
export interface RepoGroupFile {
    /** Human-readable group name (also the workspace name). */
    name: string;
    /** Member workspace IDs — resolved against the registry at read time. */
    members: string[];
    /**
     * Optional free-form note per member, keyed by member workspace ID.
     *
     * A side map rather than richer `members` entries so files written before
     * this existed keep loading unchanged, and so a group with no descriptions
     * still serializes byte-identically to what earlier versions wrote — the
     * key is omitted entirely when empty. Descriptions are scoped to the
     * membership, so the same repo can read differently in two groups.
     */
    descriptions?: Record<string, string>;
}

/** A group member resolved against the live workspace registry. */
export interface RepoGroupMember {
    workspaceId: string;
    /** True when the member cannot currently be used for context injection. */
    stale: boolean;
    /** Why the member is stale; absent for live members. */
    staleReason?: 'workspace-removed' | 'path-missing';
    /** Registry workspace name; absent when the workspace was removed. */
    name?: string;
    /** Registry absolute root path; absent when the workspace was removed. */
    rootPath?: string;
    /** This group's note about the member; absent when unset. */
    description?: string;
}

/** Raised when create/update input fails shape or registry validation. */
export class RepoGroupValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RepoGroupValidationError';
    }
}

/** Well-formed repo-group workspace ID: prefix + slug charset only. */
const REPO_GROUP_ID_PATTERN = /^group-[a-z0-9][a-z0-9-]*$/;

export function isRepoGroupWorkspaceId(id: string): boolean {
    return REPO_GROUP_ID_PATTERN.test(id);
}

function groupRootPath(dataDir: string, groupId: string): string {
    return path.join(dataDir, 'repos', groupId);
}

function groupFilePath(dataDir: string, groupId: string): string {
    return path.join(groupRootPath(dataDir, groupId), REPO_GROUP_FILE_NAME);
}

function slugify(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
    return slug || 'repo-group';
}

/**
 * Validate and normalize a member list against the workspace registry.
 * Members must reference already-registered, non-virtual repo workspaces —
 * arbitrary paths and other virtual workspaces (including groups) are
 * rejected. Duplicates are collapsed, preserving first occurrence order.
 */
async function normalizeMembers(store: ProcessStore, members: string[]): Promise<string[]> {
    const registered = new Map((await store.getWorkspaces()).map(w => [w.id, w]));
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const id of members) {
        if (seen.has(id)) continue;
        seen.add(id);
        const ws = registered.get(id);
        if (!ws) {
            throw new RepoGroupValidationError(`Repo group member "${id}" is not a registered workspace`);
        }
        if (ws.virtual) {
            throw new RepoGroupValidationError(`Repo group member "${id}" is not a repo workspace`);
        }
        normalized.push(id);
    }
    return normalized;
}

/**
 * Validate a caller-supplied description map and drop anything that would be
 * dead weight in the file: empty values, and entries for workspace IDs that are
 * not members. Unknown keys are a caller mistake, so they are rejected rather
 * than silently ignored; entries that merely went stale (a member removed by
 * this same write) are pruned by {@link pruneDescriptions} instead.
 */
function normalizeDescriptions(
    descriptions: Record<string, string>,
    members: readonly string[],
): Record<string, string> {
    const memberSet = new Set(members);
    const normalized: Record<string, string> = {};
    for (const [workspaceId, value] of Object.entries(descriptions)) {
        if (typeof value !== 'string') {
            throw new RepoGroupValidationError(`Description for "${workspaceId}" must be a string`);
        }
        if (value.length > REPO_GROUP_DESCRIPTION_MAX_LENGTH) {
            throw new RepoGroupValidationError(
                `Description for "${workspaceId}" exceeds ${REPO_GROUP_DESCRIPTION_MAX_LENGTH} characters`,
            );
        }
        if (!memberSet.has(workspaceId)) {
            throw new RepoGroupValidationError(`Description key "${workspaceId}" is not a member of this repo group`);
        }
        const trimmed = value.trim();
        if (trimmed) normalized[workspaceId] = trimmed;
    }
    return normalized;
}

/** Keep only the descriptions whose member is still in the group. */
function pruneDescriptions(
    descriptions: Record<string, string> | undefined,
    members: readonly string[],
): Record<string, string> {
    const kept: Record<string, string> = {};
    for (const workspaceId of members) {
        const value = descriptions?.[workspaceId];
        if (value) kept[workspaceId] = value;
    }
    return kept;
}

function normalizeName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
        throw new RepoGroupValidationError('Repo group name must not be empty');
    }
    return trimmed;
}

function writeGroupFile(dataDir: string, groupId: string, file: RepoGroupFile): void {
    const root = groupRootPath(dataDir, groupId);
    fs.mkdirSync(root, { recursive: true });
    const descriptions = pruneDescriptions(file.descriptions, file.members);
    // Omitted when empty so a group without descriptions writes exactly the
    // bytes earlier versions wrote.
    const payload: RepoGroupFile = Object.keys(descriptions).length > 0
        ? { name: file.name, members: file.members, descriptions }
        : { name: file.name, members: file.members };
    fs.writeFileSync(groupFilePath(dataDir, groupId), JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

/** Read-side tolerance: anything that is not a plain map of strings is empty. */
function parseDescriptions(value: unknown): Record<string, string> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const parsed: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === 'string' && entry) parsed[key] = entry;
    }
    return Object.keys(parsed).length > 0 ? parsed : undefined;
}

/**
 * Read the membership file for a group. Returns `undefined` when the ID is
 * not a well-formed group ID or the file does not exist / cannot be parsed.
 */
export function readRepoGroup(dataDir: string, groupId: string): RepoGroupFile | undefined {
    if (!isRepoGroupWorkspaceId(groupId)) return undefined;
    const filePath = groupFilePath(dataDir, groupId);
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
    try {
        const parsed = JSON.parse(raw) as Partial<RepoGroupFile>;
        if (typeof parsed?.name !== 'string' || !Array.isArray(parsed.members)) return undefined;
        const members = parsed.members.filter((m): m is string => typeof m === 'string');
        const descriptions = parseDescriptions((parsed as { descriptions?: unknown }).descriptions);
        return descriptions ? { name: parsed.name, members, descriptions } : { name: parsed.name, members };
    } catch {
        return undefined;
    }
}

/**
 * Mint a unique workspace ID for a new group: `group-<slug>` with a numeric
 * suffix when the slug collides with an existing workspace or directory.
 */
async function mintGroupId(dataDir: string, store: ProcessStore, name: string): Promise<string> {
    const taken = new Set((await store.getWorkspaces()).map(w => w.id));
    const base = `${REPO_GROUP_ID_PREFIX}${slugify(name)}`;
    let candidate = base;
    for (let n = 2; taken.has(candidate) || fs.existsSync(groupRootPath(dataDir, candidate)); n++) {
        candidate = `${base}-${n}`;
    }
    return candidate;
}

/**
 * Create a repo group: validates members against the registry, persists
 * `group.json` under a fresh root at `<dataDir>/repos/<groupId>/`, and
 * registers the group as a virtual workspace.
 */
export async function createRepoGroup(
    dataDir: string,
    store: ProcessStore,
    input: { name: string; members: string[]; descriptions?: Record<string, string> },
): Promise<WorkspaceInfo> {
    const name = normalizeName(input.name);
    const members = await normalizeMembers(store, input.members);
    const descriptions = input.descriptions ? normalizeDescriptions(input.descriptions, members) : undefined;
    const groupId = await mintGroupId(dataDir, store, name);
    writeGroupFile(dataDir, groupId, { name, members, descriptions });
    const ws: WorkspaceInfo = {
        id: groupId,
        name,
        rootPath: groupRootPath(dataDir, groupId),
        virtual: true,
    };
    await store.registerWorkspace(ws);
    return ws;
}

/**
 * Update a group's name and/or membership. Member changes are validated
 * against the registry exactly like creation. A rename also updates the
 * registered workspace name so the picker stays in sync.
 * Returns the updated file, or `undefined` when the group does not exist.
 */
export async function updateRepoGroup(
    dataDir: string,
    store: ProcessStore,
    groupId: string,
    updates: { name?: string; members?: string[]; descriptions?: Record<string, string> },
): Promise<RepoGroupFile | undefined> {
    const current = readRepoGroup(dataDir, groupId);
    if (!current) return undefined;
    const members = updates.members !== undefined ? await normalizeMembers(store, updates.members) : current.members;
    // A supplied map is a partial patch: it replaces only the keys it names,
    // and an empty string clears that member's description.
    let descriptions = pruneDescriptions(current.descriptions, members);
    if (updates.descriptions !== undefined) {
        const patch = normalizeDescriptions(updates.descriptions, members);
        for (const key of Object.keys(updates.descriptions)) delete descriptions[key];
        descriptions = { ...descriptions, ...patch };
    }
    const next: RepoGroupFile = {
        name: updates.name !== undefined ? normalizeName(updates.name) : current.name,
        members,
        descriptions: Object.keys(descriptions).length > 0 ? descriptions : undefined,
    };
    writeGroupFile(dataDir, groupId, next);
    if (next.name !== current.name) {
        await store.updateWorkspace(groupId, { name: next.name });
    }
    return next;
}

/**
 * Resolve a group's members against the live workspace registry. Members
 * whose workspace was removed, or whose root path no longer exists on disk,
 * are returned marked stale so callers can skip them for context injection
 * and surface them in the edit dialog.
 */
export async function resolveRepoGroupMembers(
    dataDir: string,
    store: ProcessStore,
    groupId: string,
): Promise<RepoGroupMember[]> {
    const file = readRepoGroup(dataDir, groupId);
    if (!file) return [];
    const registered = new Map((await store.getWorkspaces()).map(w => [w.id, w]));
    return file.members.map((workspaceId): RepoGroupMember => {
        const description = file.descriptions?.[workspaceId];
        const withDescription = description ? { description } : {};
        const ws = registered.get(workspaceId);
        if (!ws) {
            return { workspaceId, stale: true, staleReason: 'workspace-removed', ...withDescription };
        }
        if (!fs.existsSync(ws.rootPath)) {
            return { workspaceId, stale: true, staleReason: 'path-missing', name: ws.name, rootPath: ws.rootPath, ...withDescription };
        }
        return { workspaceId, stale: false, name: ws.name, rootPath: ws.rootPath, ...withDescription };
    });
}

/**
 * Delete a group: deregisters the workspace so it disappears from the
 * picker, but leaves `<dataDir>/repos/<groupId>/` (notes, membership file,
 * process history) on disk. Returns true when the workspace was registered.
 */
export async function deleteRepoGroup(store: ProcessStore, groupId: string): Promise<boolean> {
    if (!isRepoGroupWorkspaceId(groupId)) return false;
    return store.removeWorkspace(groupId);
}
