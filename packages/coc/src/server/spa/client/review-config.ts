/**
 * Review Config — reads server-provided configuration
 * from the global `window.__REVIEW_CONFIG__` set by the HTML template.
 *
 * Present only when the user navigates to `/review/:path`.
 */

export interface ReviewConfig {
    apiBasePath: string;
    wsPath: string;
    filePath: string;
    projectDir: string;
}

export function getReviewConfig(): ReviewConfig | null {
    return (window as any).__REVIEW_CONFIG__ ?? null;
}

export function isReviewMode(): boolean {
    return getReviewConfig() !== null;
}
