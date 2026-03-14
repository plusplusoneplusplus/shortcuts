/**
 * Shared GitHub API response parsing utilities for the skills module.
 */

/**
 * Parse a JSON response from the GitHub API (via gh CLI stdout or raw HTTP body).
 * Returns `null` if the input is not valid JSON.
 */
export function parseGitHubApiResponse(stdout: string): any {
    try {
        return JSON.parse(stdout);
    } catch {
        return null;
    }
}
