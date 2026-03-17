/**
 * Normalize a git remote URL for grouping and comparison purposes.
 *
 * Pure string utility — no Node.js dependencies (safe for browser bundles).
 *
 * This is the single source of truth for remote URL normalisation used by:
 *   - api-handler (server-side grouping / re-registration guard)
 *   - repoGrouping (SPA client sidebar grouping)
 *
 * @param rawUrl Raw remote URL from `git remote get-url`.
 * @returns Normalized form: `host/user/repo` (no protocol, no .git suffix, no trailing slash).
 *
 * Examples:
 *   git@github.com:user/repo.git       → github.com/user/repo
 *   https://github.com/user/repo.git   → github.com/user/repo
 *   ssh://git@github.com/user/repo     → github.com/user/repo
 *   git://github.com/user/repo.git/    → github.com/user/repo
 *
 * Azure DevOps URLs are normalised to `dev.azure.com/{org}/{project}/{repo}`:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}
 *   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 */
export function normalizeRemoteUrl(rawUrl: string): string {
    let u = rawUrl.trim();

    // SSH shorthand: git@host:user/repo.git → host/user/repo
    const sshMatch = u.match(/^[\w.-]+@([\w.-]+):(.+)$/);
    if (sshMatch) {
        u = sshMatch[1] + '/' + sshMatch[2];
    } else {
        // Strip protocol (https://, ssh://, git://, http://)
        u = u.replace(/^(?:https?|ssh|git):\/\//, '');
        // Strip userinfo (user@, git@)
        u = u.replace(/^[^@]+@/, '');
    }

    // Strip trailing .git (with optional trailing slash)
    u = u.replace(/\.git\/?$/, '');
    // Strip trailing slash
    u = u.replace(/\/+$/, '');

    // Azure DevOps: ssh.dev.azure.com/v3/{org}/{project}/{repo} → dev.azure.com/{org}/{project}/{repo}
    u = u.replace(/^ssh\.dev\.azure\.com\/v3\//, 'dev.azure.com/');

    // Azure DevOps: {org}.visualstudio.com/[DefaultCollection/]{project}/… → dev.azure.com/{org}/…
    const vsMatch = u.match(/^([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?(.+)$/i);
    if (vsMatch) {
        u = 'dev.azure.com/' + vsMatch[1] + '/' + vsMatch[2];
    }

    // Azure DevOps: strip /_git/ path segment
    if (u.startsWith('dev.azure.com/')) {
        u = u.replace(/\/_git\//, '/');
    }

    return u;
}
