/**
 * Hostname display utilities.
 *
 * Shortens raw OS hostnames for use in the dashboard title bar.
 * The full hostname is still used for icon color derivation (gradient hash)
 * so that colors remain stable across the rename.
 */

/**
 * Common hostname suffixes added by the OS that add no value in a UI title.
 * Ordered longest-first so the first match wins.
 */
const STRIP_SUFFIXES = [
    '.localdomain',
    '.local',
    '.lan',
    '.home',
    '.internal',
];

/**
 * Shorten a raw OS hostname for display purposes.
 *
 * - Strips well-known LAN suffixes (`.local`, `.localdomain`, `.lan`, `.home`, `.internal`)
 * - Returns the original string unchanged when no suffix matches
 *
 * @example
 * shortenHostname('MyMacBook-Pro.local')      // 'MyMacBook-Pro'
 * shortenHostname('server01.localdomain')      // 'server01'
 * shortenHostname('ci-runner')                 // 'ci-runner'
 */
export function shortenHostname(hostname: string): string {
    const lower = hostname.toLowerCase();
    for (const suffix of STRIP_SUFFIXES) {
        if (lower.endsWith(suffix)) {
            return hostname.slice(0, -suffix.length);
        }
    }
    return hostname;
}
