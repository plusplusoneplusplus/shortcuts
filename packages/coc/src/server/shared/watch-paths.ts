/** A changed directory can contain the consumer's subtree as well as lie in it. */
export function affectsWatchedDirectory(file: string, directory: string): boolean {
    return file === directory || file.startsWith(`${directory}/`) || directory.startsWith(`${file}/`);
}
