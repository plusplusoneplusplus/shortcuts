/**
 * Returns true when a directory name is a valid task folder — i.e. it is
 * neither a hidden/system directory (starting with '.') nor a reserved name.
 *
 * Callers may additionally exclude 'archive' at their own discretion, but
 * this predicate deliberately does not hard-code that since 'archive' is a
 * legitimate user-facing concept handled separately in the auto-folder logic.
 */
export function isValidTaskFolder(name: string): boolean {
    return !name.startsWith('.');
}
