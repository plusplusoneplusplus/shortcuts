/**
 * Extension document persistence
 *
 * An extension canvas stores a manifest, a capabilities script, and one of two
 * UI documents: legacy `ui.html`, or the compiled `ui.js` (plus the `ui.jsx`
 * source it came from). `ui.js` takes precedence over `ui.html`, so rebuilding
 * a JSX canvas as an HTML one MUST remove the stale `ui.js` or the old UI keeps
 * rendering.
 *
 * Writing those files one at a time meant a reader could catch a new manifest
 * against an old UI — and this is code the canvas host executes. Every save is
 * therefore staged in full and published as a single rename phase, so the
 * document set a reader sees is either entirely the old one or entirely the
 * new one.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    CanvasLayout,
    EXTENSION_MANIFEST_FILE,
    EXTENSION_UI_FILE,
    EXTENSION_UI_JS_FILE,
    EXTENSION_UI_JSX_FILE,
    EXTENSION_CAPABILITIES_FILE,
} from './canvas-layout';
import { StagedCommit } from './canvas-atomic-write';
import { reportCanvasCorruption } from './canvas-diagnostics';
import { isValidCanvasId, type CanvasExtension, type CanvasExtensionManifest } from './canvas-types';

export class CanvasExtensionRepository {
    constructor(private readonly layout: CanvasLayout) {}

    /**
     * Read the extension documents, or null when the canvas has none.
     *
     * `manifest.json` and `capabilities.js` are required — an extension without
     * them is unusable. The UI documents are OPTIONAL reads because of the two
     * authoring paths: an HTML extension has `ui.html` and no `ui.js`, a JSX
     * extension has `ui.js` (+ its `ui.jsx` source) and no `ui.html`. One of the
     * two must exist; a directory with neither is as broken as a missing
     * manifest and returns null.
     */
    read(workspaceId: string, canvasId: string): CanvasExtension | null {
        if (!isValidCanvasId(canvasId)) return null;
        const dir = this.layout.extensionDir(workspaceId, canvasId);
        const readOptional = (file: string): string | undefined => {
            try {
                return fs.readFileSync(path.join(dir, file), 'utf-8');
            } catch (error) {
                reportCanvasCorruption({ workspaceId, canvasId, role: 'extension-ui', file, error });
                return undefined;
            }
        };

        let manifest: CanvasExtensionManifest;
        try {
            manifest = JSON.parse(fs.readFileSync(path.join(dir, EXTENSION_MANIFEST_FILE), 'utf-8')) as CanvasExtensionManifest;
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'extension-manifest', file: EXTENSION_MANIFEST_FILE, error });
            return null;
        }

        let capabilitiesJs: string;
        try {
            capabilitiesJs = fs.readFileSync(path.join(dir, EXTENSION_CAPABILITIES_FILE), 'utf-8');
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'extension-capabilities', file: EXTENSION_CAPABILITIES_FILE, error });
            return null;
        }

        const uiHtml = readOptional(EXTENSION_UI_FILE);
        const uiJs = readOptional(EXTENSION_UI_JS_FILE);
        const uiJsx = readOptional(EXTENSION_UI_JSX_FILE);
        if (uiHtml === undefined && uiJs === undefined) return null;
        return {
            manifest,
            uiHtml: uiHtml ?? '',
            capabilitiesJs,
            ...(uiJs !== undefined ? { uiJs } : {}),
            ...(uiJsx !== undefined ? { uiJsx } : {}),
        };
    }

    /**
     * Prepare the whole document set. The caller commits it together with the
     * revision bump; nothing is visible until then.
     */
    stage(workspaceId: string, canvasId: string, extension: CanvasExtension): StagedCommit {
        const dir = this.layout.extensionDir(workspaceId, canvasId);
        const staged = new StagedCommit();
        staged.stage(path.join(dir, EXTENSION_MANIFEST_FILE), JSON.stringify(extension.manifest, null, 2));
        staged.stage(path.join(dir, EXTENSION_CAPABILITIES_FILE), extension.capabilitiesJs);

        const uiDocuments: [string, string | undefined][] = [
            // A JSX extension carries uiHtml: '' — treat empty as absent so it
            // does not shadow ui.js with a blank document.
            [EXTENSION_UI_FILE, extension.uiHtml || undefined],
            [EXTENSION_UI_JS_FILE, extension.uiJs],
            [EXTENSION_UI_JSX_FILE, extension.uiJsx],
        ];
        for (const [file, contents] of uiDocuments) {
            const filePath = path.join(dir, file);
            if (contents !== undefined) {
                staged.stage(filePath, contents);
            } else {
                staged.stageRemoval(filePath);
            }
        }
        return staged;
    }
}
