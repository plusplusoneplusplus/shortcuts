/**
 * URL the pdf.js worker is served from, passed as `workerSrc` to the embeds
 * package's PdfJsRenderer. The client build (`scripts/build-client.mjs`) emits
 * `pdf.worker.js` into the client `dist/`, and the dashboard router serves that
 * directory at the site root — so the file resolves at `/pdf.worker.js`. A
 * request for `/static/pdf.worker.js` falls through to the SPA HTML fallback,
 * breaking both the real Worker and pdf.js's fake-worker import. Keep this path
 * root-relative so it matches the router's static resolver (`staticDir` +
 * pathname; see `src/server/router.ts`).
 */
export const PDF_WORKER_URL = '/pdf.worker.js';
