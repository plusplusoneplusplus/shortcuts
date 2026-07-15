/**
 * Shared filesystem helpers for storage snapshot domains.
 *
 * Low-level directory scanning, JSON/YAML read-write, and error formatting used
 * by more than one domain. Domain policy (what to collect, merge, or delete)
 * stays in the domain modules; only mechanics live here.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getErrorMessage } from '../../shared/fs-utils';

export { getErrorMessage };

/** A per-repo data directory under `<dataDir>/repos/<repoId>`. */
export interface RepoDir {
    repoId: string;
    dir: string;
}

/** Result of a guarded JSON read: either the parsed value or the thrown error. */
export type JsonReadResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** True when `dir` exists and is a directory. Never throws. */
export function isDirectory(dir: string): boolean {
    try {
        return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
        return false;
    }
}

/** True when `value` is a non-array object. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse a JSON file, capturing parse/read errors instead of throwing. */
export function readJsonFile<T>(filePath: string): JsonReadResult<T> {
    try {
        return { ok: true, value: JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T };
    } catch (error) {
        return { ok: false, error };
    }
}

/** List every repo data directory under `<dataDir>/repos`, sorted by repo id. */
export function listRepoDirs(dataDir: string): RepoDir[] {
    const reposDir = path.join(dataDir, 'repos');
    if (!isDirectory(reposDir)) { return []; }

    return fs.readdirSync(reposDir)
        .sort()
        .map(name => ({ repoId: name, dir: path.join(reposDir, name) }))
        .filter(repo => isDirectory(repo.dir));
}

/** Existing `<repoDir>/<filename>` paths across every repo directory. */
export function listRepoFiles(dataDir: string, filename: string): string[] {
    return listRepoDirs(dataDir)
        .map(repo => path.join(repo.dir, filename))
        .filter(filePath => fs.existsSync(filePath));
}

/** Sorted `*.images.json` blob file paths under `<dataDir>/blobs`. */
export function listBlobFiles(dataDir: string): string[] {
    const blobsDir = path.join(dataDir, 'blobs');
    if (!isDirectory(blobsDir)) { return []; }
    return fs.readdirSync(blobsDir)
        .filter(f => f.endsWith('.images.json'))
        .sort()
        .map(f => path.join(blobsDir, f));
}

/** Read a repo's root path from its `queues.json`, or '' when unavailable. */
export function readRepoRootPathFromQueueFile(repoDir: string): string {
    const queueFile = path.join(repoDir, 'queues.json');
    try {
        if (!fs.existsSync(queueFile)) { return ''; }
        const q = JSON.parse(fs.readFileSync(queueFile, 'utf-8')) as { repoRootPath?: unknown };
        return typeof q.repoRootPath === 'string' ? q.repoRootPath : '';
    } catch {
        return '';
    }
}

/** Atomically write YAML (temp file + rename), creating parent dirs as needed. */
export function writeYamlFileAtomic(filePath: string, data: unknown): void {
    const tmpPath = `${filePath}.tmp`;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
        fs.writeFileSync(tmpPath, yaml.dump(data, { lineWidth: -1 }), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
        throw err;
    }
}

/** A uniform "skipped corrupt file" warning string. */
export function skippedWarning(label: string, filePath: string, err: unknown): string {
    return `Skipped ${label} ${filePath}: ${getErrorMessage(err)}`;
}
