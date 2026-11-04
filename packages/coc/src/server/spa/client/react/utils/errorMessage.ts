/** Display a thrown value without hiding empty messages or non-Error failures. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
