/**
 * System folders are protected from rename and delete via the REST API.
 * New system folders can be added here; consumers read this list at runtime.
 */

export const SYSTEM_FOLDER_NAMES: string[] = ['Plans'];

/**
 * Per-directory custom sibling order file.
 *
 * The file is read and written by the native `notes_fs` core; the name lives
 * here because Node still needs it to address the file in tests and tooling.
 */
export const ORDER_FILE_NAME = '.order.json';
