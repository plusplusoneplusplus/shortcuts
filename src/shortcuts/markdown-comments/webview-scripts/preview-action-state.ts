/**
 * Preview Action State
 *
 * Tracks the target file path for AI actions triggered from the file-path-preview dialog.
 * When a user clicks an AI action button in the preview dialog, the previewed file path is
 * stored here so that dialog-based actions (Update Document, Refresh Plan, Follow Prompt)
 * can include it in the resulting messages as `targetDocumentPath`.
 *
 * The path is cleared when any action dialog is closed (submitted or cancelled).
 */

let previewFilePath: string | null = null;

/**
 * Set the target file path for the next AI action triggered from the preview dialog.
 */
export function setPreviewActionFilePath(path: string): void {
    previewFilePath = path;
}

/**
 * Clear the stored preview action file path.
 * Called when any action dialog closes (submitted or cancelled).
 */
export function clearPreviewActionFilePath(): void {
    previewFilePath = null;
}

/**
 * Get the stored preview action file path, or null if no preview action is pending.
 */
export function getPreviewActionFilePath(): string | null {
    return previewFilePath;
}
