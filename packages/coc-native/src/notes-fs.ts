/**
 * The Notes filesystem capability: tree scan, content read/autosave, entry
 * create/rename/delete, `.order.json` persistence, and the path-containment
 * check every Notes route makes before touching a file.
 *
 * The loader resolves the binary; this module narrows the loaded module to the
 * Notes filesystem exports and treats every unavailable state as fatal. There
 * is no JavaScript fallback — the TypeScript implementations were deleted, not
 * flagged.
 *
 * These shapes alias `native-bindings.ts`, generated from the `#[napi]` items
 * in `rust/napi/src/notes_fs.rs`.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/** Which regime a tree scan runs under. */
export type NativeNotesTreeOptions = Bindings.NotesTreeOptions;

/** Which regime a content read or write runs under. */
export type NativeNotesContentOptions = Bindings.NotesContentOptions;

/** Which regime a create, rename, delete or order write runs under. */
export type NativeNotesEntryOptions = Bindings.NotesEntryOptions;

/** The second argument of the safe-path resolver. */
export type NativeNotesSafePathOptions = Bindings.NotesSafePathOptions;

/**
 * One entry in the Notes tree, in raw readdir order.
 *
 * Deliberately unsorted. Sibling order is `localeCompare` plus `applyOrder`,
 * and both stay in Node: ICU collation is what the SPA has always shown, and a
 * Rust reimplementation of it would drift.
 */
export type NativeNotesTreeEntry = Bindings.NotesTreeEntry;

/** The scan of one Notes root. */
export type NativeNotesTreeResult = Bindings.NotesTreeResult;

/** A note's text and the mtime the client sends back as its optimistic lock. */
export type NativeNotesFileContent = Bindings.NotesFileContent;

/** The two ways an autosave can end, discriminated by `status`. */
export type NativeNotesWriteResult = Bindings.NotesWriteResult;

/** The path a create actually used — for a page, with `.md` appended. */
export type NativeNotesCreatedEntry = Bindings.NotesCreatedEntry;

/** Everything the rename route needs for the chat-binding cascade. */
export type NativeNotesRenameResult = Bindings.NotesRenameResult;

/** Everything the delete route needs for the chat-binding cascade. */
export type NativeNotesDeleteResult = Bindings.NotesDeleteResult;

/**
 * Success fields or `{ error, statusCode }`.
 *
 * The resolver resolves this union rather than rejecting, because its callers
 * branch on the result — that is the shape the TypeScript helper had, and
 * rewriting eight call sites to `try`/`catch` would have been a second change
 * riding along with the port.
 */
export type NativeNotesSafePathResult = Bindings.NotesSafePathResult;

/** The exact addon slice required by the Notes routes. */
export interface NativeNotesFsAddon {
    notesTree: typeof Bindings.notesTree;
    readNote: typeof Bindings.readNote;
    writeNote: typeof Bindings.writeNote;
    createNotesEntry: typeof Bindings.createNotesEntry;
    renameNotesEntry: typeof Bindings.renameNotesEntry;
    deleteNotesEntry: typeof Bindings.deleteNotesEntry;
    writeNotesOrder: typeof Bindings.writeNotesOrder;
    resolveSafeNotesPath: typeof Bindings.resolveSafeNotesPath;
}

/**
 * Every export the capability needs, checked one by one.
 *
 * A binary from before a later slice must fail at load with the rebuild
 * instruction, not at the first call with `undefined is not a function`. Add
 * each new `#[napi]` function in `notes_fs.rs` to this list.
 */
const REQUIRED_EXPORTS = [
    'notesTree',
    'readNote',
    'writeNote',
    'createNotesEntry',
    'renameNotesEntry',
    'deleteNotesEntry',
    'writeNotesOrder',
    'resolveSafeNotesPath',
] as const satisfies readonly (keyof NativeNotesFsAddon)[];

/** Whether the loaded module actually exposes the Notes filesystem core. */
function isNotesFsAddon(addon: unknown): addon is NativeNotesFsAddon {
    const candidate = addon as Record<string, unknown> | null;
    if (!candidate) return false;
    return REQUIRED_EXPORTS.every((name) => typeof candidate[name] === 'function');
}

/**
 * Load the required Notes filesystem capability.
 *
 * Throws {@link NativeAddonLoadError} for a missing, unloadable, or
 * capability-stale binary.
 */
export function loadNativeNotesFs(): NativeNotesFsAddon {
    const addon = loadNativeAddon();
    if (isNotesFsAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export the Notes filesystem core.\n` +
            'The binary predates the Notes filesystem capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Whether the Notes filesystem core is usable, and why not when it is not.
 *
 * Never throws so startup diagnostics and health reporting can describe every
 * unusable state, including a capability-stale binary.
 */
export function nativeNotesFsStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    if (isNotesFsAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export the Notes filesystem core`,
    };
}

/**
 * A Notes filesystem failure carrying the HTTP status the route must answer
 * with.
 *
 * The messages are the ones the TypeScript handlers already sent, and the SPA
 * matches on some of them, so they cross the N-API boundary verbatim behind a
 * `[notes-fs:<code>] ` prefix that {@link toNotesFsError} strips back off.
 */
export class NotesFsError extends Error {
    constructor(
        message: string,
        readonly statusCode: number,
    ) {
        super(message);
        this.name = 'NotesFsError';
    }
}

const STATUS_PREFIX = /^\[notes-fs:(\d{3})\]\s?/;

/**
 * Decode a rejection from any `notes_fs` export.
 *
 * An error without the prefix is not from the core — a marshalling failure, a
 * panic, a bad argument — so it decodes as a 500 with its own message rather
 * than being swallowed or reshaped.
 */
export function toNotesFsError(error: unknown): NotesFsError {
    if (error instanceof NotesFsError) return error;
    const message = error instanceof Error ? error.message : String(error);
    const match = STATUS_PREFIX.exec(message);
    if (!match) return new NotesFsError(message, 500);
    return new NotesFsError(message.slice(match[0].length), Number(match[1]));
}

/** Whether a safe-path result is the refusal arm of the union. */
export function isNativeNotesPathError(
    result: NativeNotesSafePathResult,
): result is NativeNotesSafePathResult & { error: string; statusCode: number } {
    return typeof result.error === 'string';
}
