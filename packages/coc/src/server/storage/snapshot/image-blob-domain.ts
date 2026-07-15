/**
 * Image blob snapshot domain.
 *
 * Owns export/import/wipe for externalized per-task image blobs stored as
 * `<dataDir>/blobs/<taskId>.images.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ImageBlobEntry } from '../export-import-types';
import { atomicWriteJson } from '../../shared/fs-utils';
import type { StorageSnapshotDomain } from './types';
import {
    getErrorMessage,
    isDirectory,
    listBlobFiles,
    readJsonFile,
    skippedWarning,
} from './snapshot-fs';

export function createImageBlobDomain(): StorageSnapshotDomain<{ blobFiles: string[] }> {
    return {
        id: 'image-blobs',
        collect(ctx) {
            const blobsDir = path.join(ctx.dataDir, 'blobs');
            const entries: ImageBlobEntry[] = [];
            const warnings: string[] = [];

            if (!isDirectory(blobsDir)) {
                return { data: { imageBlobs: entries }, metadata: { blobFileCount: 0 }, warnings };
            }

            const files = fs.readdirSync(blobsDir)
                .filter(f => f.endsWith('.images.json'))
                .sort();

            for (const file of files) {
                const filePath = path.join(blobsDir, file);
                const parsed = readJsonFile<unknown>(filePath);
                if (!parsed.ok) {
                    warnings.push(skippedWarning('image blob file', filePath, parsed.error));
                    continue;
                }

                entries.push({
                    taskId: file.replace(/\.images\.json$/, ''),
                    images: Array.isArray(parsed.value) ? parsed.value : [],
                });
            }

            return {
                data: { imageBlobs: entries },
                metadata: { blobFileCount: entries.length },
                warnings,
            };
        },
        restoreReplace(payload, ctx, result) {
            result.importedBlobFiles = writeBlobFiles(ctx.dataDir, payload.imageBlobs ?? [], result.errors);
        },
        restoreMerge(payload, ctx, result) {
            result.importedBlobFiles = mergeBlobFiles(ctx.dataDir, payload.imageBlobs ?? [], result.errors);
        },
        planWipe(ctx) {
            return {
                plan: { blobFiles: listBlobFiles(ctx.dataDir) },
                counts: {},
                errors: [],
            };
        },
        executeWipe(_ctx, plan, result) {
            for (const filePath of plan?.blobFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete blob file ${filePath}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}

function writeBlobFiles(dataDir: string, blobs: ImageBlobEntry[], errors: string[]): number {
    let written = 0;
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        try {
            atomicWriteJson(path.join(dataDir, 'blobs', `${entry.taskId}.images.json`), entry.images);
            written++;
        } catch (err) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}

function mergeBlobFiles(dataDir: string, blobs: ImageBlobEntry[], errors: string[]): number {
    let written = 0;
    for (const entry of blobs) {
        if (!entry.taskId) { continue; }
        const filePath = path.join(dataDir, 'blobs', `${entry.taskId}.images.json`);
        if (fs.existsSync(filePath)) { continue; }
        try {
            atomicWriteJson(filePath, entry.images);
            written++;
        } catch (err) {
            errors.push(`Failed to write blob file for task ${entry.taskId}: ${getErrorMessage(err)}`);
        }
    }
    return written;
}
