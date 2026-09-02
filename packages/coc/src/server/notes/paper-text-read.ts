/**
 * Whole-paper grounding text reader (Goal 3, AC-04 server half).
 *
 * Given a cached paper embed path (`.papers/<id>.pdf`, produced by the arXiv
 * ingest handler) this resolves the sibling extracted-text sidecar
 * (`.papers/<id>.txt`) inside the note's notes root and returns its content,
 * budget-capped, for whole-paper grounding.
 *
 * The read is **best-effort**: any failure (feature off, no sidecar, path
 * outside the papers cache, unreadable file) returns `null` so the caller can
 * fall back to the cheap selection-only grounding path.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences-handler';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import { resolveSafeNotesPath, isNotesPathSafetyError } from './notes-path-safety';
import { PAPERS_DIR } from './paper-ingest-handler';

/** Default budget of paper-text characters forwarded to the model for grounding. */
export const DEFAULT_PAPER_TEXT_BUDGET = 120_000;

/**
 * Derive the `.txt` sidecar path for a cached paper embed path.
 *
 * Accepts only a `<PAPERS_DIR>/<base>.pdf` (or `.txt`) reference with a plain
 * basename — no nested directories, no traversal — so a hostile `paperPath` can
 * never point the read outside the papers cache. Returns the sidecar relpath
 * (always `.txt`) or `null` when the input is not a valid cache reference.
 */
export function paperTextSidecarRelPath(paperPath: unknown): string | null {
    if (typeof paperPath !== 'string') return null;
    const norm = paperPath.replace(/\\/g, '/').trim();
    const prefix = `${PAPERS_DIR}/`;
    if (!norm.startsWith(prefix)) return null;
    const base = norm.slice(prefix.length);
    if (!base || base.includes('/') || base.includes('..')) return null;
    const m = /^(.+)\.(pdf|txt)$/i.exec(base);
    if (!m) return null;
    return `${PAPERS_DIR}/${m[1]}.txt`;
}

export interface ReadPaperTextArgs {
    dataDir: string;
    store: ProcessStore;
    workspaceId: string;
    /** Notes root the embed lives under (defaults to the managed root). */
    root?: string;
    /** The cached embed path, e.g. `.papers/1802.05799.pdf`. */
    paperPath: string;
    /** Character budget (defaults to {@link DEFAULT_PAPER_TEXT_BUDGET}). */
    maxChars?: number;
}

/**
 * Best-effort read of a cached paper's extracted-text sidecar for grounding.
 * Returns the (trimmed, budget-capped) text, or `null` on any failure.
 */
export async function readPaperText(args: ReadPaperTextArgs): Promise<string | null> {
    const rel = paperTextSidecarRelPath(args.paperPath);
    if (!rel) return null;
    try {
        const workspaces = await args.store.getWorkspaces();
        const ws = workspaces.find(w => w.id === args.workspaceId);
        if (!ws) return null;

        const prefs = readRepoPreferences(args.dataDir, ws.id);
        const resolved = resolveNotesRoot(
            args.dataDir,
            ws.id,
            ws.rootPath,
            args.root,
            prefs.additionalNotesRoots,
        );
        if (isRootResolveError(resolved)) return null;

        let absPath: string;
        if (resolved.isDefault) {
            absPath = path.join(resolved.absolutePath, ...rel.split('/'));
        } else {
            const safe = await resolveSafeNotesPath(resolved.absolutePath, rel);
            if (isNotesPathSafetyError(safe)) return null;
            absPath = safe.absolutePath;
        }

        const text = await fs.promises.readFile(absPath, 'utf-8');
        const trimmed = text.trim();
        if (!trimmed) return null;
        const budget = args.maxChars ?? DEFAULT_PAPER_TEXT_BUDGET;
        return trimmed.length > budget ? trimmed.slice(0, budget) : trimmed;
    } catch {
        return null;
    }
}
