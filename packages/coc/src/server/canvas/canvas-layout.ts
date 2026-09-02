/**
 * The single place that knows where a canvas's files live. Every persistence
 * service takes a `CanvasLayout` instead of joining paths itself, so the
 * directory shape is stated once:
 *
 *   `<dataDir>/repos/<workspaceId>/canvases/`
 *     `.locks/<canvasId>.lock`   — per-canvas write lock (see canvas-write-queue)
 *     `<canvasId>/`
 *       `canvas.json`            — descriptor
 *       `artifact.md`            — content
 *       `versions/<rev>.json`    — per-revision snapshots
 *       `comments.json`          — anchored comments
 *       `extension/`             — extension documents
 *       `files/`                 — read-only data an extension canvas may read
 *
 * The lock directory sits beside the canvases rather than inside one, and its
 * name starts with a dot, so `isValidCanvasId` filters it out of every listing.
 */

import * as path from 'path';
import { getRepoDataPath } from '../paths';

export const CANVASES_DIR_NAME = 'canvases';
export const DESCRIPTOR_FILE = 'canvas.json';
export const ARTIFACT_FILE = 'artifact.md';
export const VERSIONS_DIR = 'versions';
export const COMMENTS_FILE = 'comments.json';
export const EXTENSION_DIR = 'extension';
export const EXTENSION_MANIFEST_FILE = 'manifest.json';
export const EXTENSION_UI_FILE = 'ui.html';
export const EXTENSION_UI_JS_FILE = 'ui.js';
export const EXTENSION_UI_JSX_FILE = 'ui.jsx';
export const EXTENSION_CAPABILITIES_FILE = 'capabilities.js';
/** Subdirectory of a canvas's own directory holding the files it may read. */
export const FILES_DIR = 'files';
export const LOCKS_DIR_NAME = '.locks';

export class CanvasLayout {
    constructor(readonly dataDir: string) {}

    workspaceRoot(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, CANVASES_DIR_NAME);
    }

    locksDir(workspaceId: string): string {
        return path.join(this.workspaceRoot(workspaceId), LOCKS_DIR_NAME);
    }

    canvasDir(workspaceId: string, canvasId: string): string {
        return path.join(this.workspaceRoot(workspaceId), canvasId);
    }

    descriptorPath(workspaceId: string, canvasId: string): string {
        return path.join(this.canvasDir(workspaceId, canvasId), DESCRIPTOR_FILE);
    }

    artifactPath(workspaceId: string, canvasId: string): string {
        return path.join(this.canvasDir(workspaceId, canvasId), ARTIFACT_FILE);
    }

    versionsDir(workspaceId: string, canvasId: string): string {
        return path.join(this.canvasDir(workspaceId, canvasId), VERSIONS_DIR);
    }

    versionPath(workspaceId: string, canvasId: string, revision: number): string {
        return path.join(this.versionsDir(workspaceId, canvasId), `${revision}.json`);
    }

    commentsPath(workspaceId: string, canvasId: string): string {
        return path.join(this.canvasDir(workspaceId, canvasId), COMMENTS_FILE);
    }

    extensionDir(workspaceId: string, canvasId: string): string {
        return path.join(this.canvasDir(workspaceId, canvasId), EXTENSION_DIR);
    }

    filesRoot(workspaceId: string, canvasId: string): string {
        return path.join(this.canvasDir(workspaceId, canvasId), FILES_DIR);
    }
}
