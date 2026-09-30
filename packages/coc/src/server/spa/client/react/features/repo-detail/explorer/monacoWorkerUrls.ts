/**
 * URL of the Monaco web worker for a language label.
 *
 * `scripts/build-client.mjs` writes the workers into `client/dist/`, which the
 * server serves at the site root. A URL the server cannot resolve falls back to
 * the SPA page, so a wrong path fails silently: the worker parses HTML and dies,
 * and the diff editor never receives line changes.
 */
export function monacoWorkerUrl(label: string): string {
    if (label === 'json') return '/json.worker.js';
    if (label === 'css' || label === 'scss' || label === 'less') return '/css.worker.js';
    if (label === 'html' || label === 'handlebars' || label === 'razor') return '/html.worker.js';
    if (label === 'typescript' || label === 'javascript') return '/ts.worker.js';
    return '/editor.worker.js';
}
