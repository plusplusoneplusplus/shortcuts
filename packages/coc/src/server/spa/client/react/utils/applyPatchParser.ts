export interface ApplyPatchFileChange {
    path: string;
    insertions: number;
    deletions: number;
    isCreate: boolean;
    isDelete: boolean;
    fromPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function getApplyPatchText(args: unknown): string {
    if (typeof args === 'string') {
        return args;
    }
    if (!isRecord(args)) {
        return '';
    }
    for (const key of ['diff', 'patch', 'input']) {
        const value = args[key];
        if (typeof value === 'string') {
            return value;
        }
    }
    return '';
}

/** Lines matching these patterns are git metadata inside a unified diff section. */
const GIT_METADATA_RE = /^(index |similarity index |rename from |rename to |old mode |new mode )/;

export function parseApplyPatchFileChanges(patchText: string): ApplyPatchFileChange[] {
    const fileMap = new Map<string, ApplyPatchFileChange>();
    let current: ApplyPatchFileChange | null = null;
    let inUnifiedSection = false;

    const commitCurrent = () => {
        if (!current || !current.path) {
            current = null;
            return;
        }
        const existing = fileMap.get(current.path);
        if (existing) {
            existing.insertions += current.insertions;
            existing.deletions += current.deletions;
            existing.isCreate = existing.isCreate && current.isCreate;
            existing.isDelete = existing.isDelete && current.isDelete;
            if (!existing.fromPath && current.fromPath) {
                existing.fromPath = current.fromPath;
            }
        } else {
            fileMap.set(current.path, { ...current });
        }
        current = null;
    };

    const startSection = (
        path: string,
        isCreate: boolean,
        isDelete: boolean,
        fromPath?: string,
        unified = false,
    ) => {
        commitCurrent();
        current = {
            path: path.trim(),
            insertions: 0,
            deletions: 0,
            isCreate,
            isDelete,
            fromPath,
        };
        inUnifiedSection = unified;
    };

    for (const line of patchText.split(/\r?\n/)) {
        // Unified diff section header: diff --git a/<old> b/<new>
        const gitDiff = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        if (gitDiff) {
            const oldPath = gitDiff[1];
            const newPath = gitDiff[2];
            startSection(newPath, false, false, oldPath !== newPath ? oldPath : undefined, true);
            continue;
        }

        // Legacy section headers
        const addFile = line.match(/^\*\*\* Add File: (.+)$/);
        if (addFile) {
            startSection(addFile[1], true, false);
            continue;
        }

        const updateFile = line.match(/^\*\*\* Update File: (.+)$/);
        if (updateFile) {
            startSection(updateFile[1], false, false);
            continue;
        }

        const deleteFile = line.match(/^\*\*\* Delete File: (.+)$/);
        if (deleteFile) {
            startSection(deleteFile[1], false, true);
            continue;
        }

        const moveTo = line.match(/^\*\*\* Move to: (.+)$/);
        if (moveTo && current) {
            current.fromPath = current.fromPath ?? current.path;
            current.path = moveTo[1].trim();
            current.isCreate = false;
            current.isDelete = false;
            continue;
        }

        if (line.startsWith('***')) {
            continue;
        }

        if (!current) continue;

        // Unified metadata lines refine isCreate/isDelete; skip them from body counting.
        if (inUnifiedSection) {
            if (line.match(/^new file mode /)) {
                current.isCreate = true;
                continue;
            }
            if (line.match(/^deleted file mode /)) {
                current.isDelete = true;
                continue;
            }
            if (GIT_METADATA_RE.test(line)) continue;
        }

        if (line.startsWith('@@')) continue;

        if (/^(\+\+\+|---)\s/.test(line)) {
            // Infer create/delete from /dev/null markers in unified diffs.
            if (inUnifiedSection) {
                if (line.startsWith('--- /dev/null')) current.isCreate = true;
                if (line.startsWith('+++ /dev/null')) current.isDelete = true;
            }
            continue;
        }

        if (current.isCreate) {
            if (line.startsWith('+')) {
                current.insertions++;
            }
        } else if (current.isDelete) {
            if (line.startsWith('-')) {
                current.deletions++;
            }
        } else if (line.startsWith('+')) {
            current.insertions++;
        } else if (line.startsWith('-')) {
            current.deletions++;
        }
    }

    commitCurrent();
    return [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));
}
