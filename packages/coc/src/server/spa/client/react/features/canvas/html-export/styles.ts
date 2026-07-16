/**
 * Static CSS embedded inline into every exported canvas document, plus the
 * broken-image placeholder. Kept as string constants (no external `<link>`,
 * no `.css` import) so the pure serializer stays Node-safe and the output
 * satisfies the portability contract: zero external references.
 *
 * The highlight.js theme is a self-contained github-light palette so exported
 * `code` canvases and highlighted code blocks render without shipping the
 * highlight.js runtime.
 */

/** Base document + typography styling for the exported page. */
export const BASE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 20px 64px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: #1f2328;
  background: #ffffff;
}
.canvas-export { max-width: 860px; margin: 0 auto; }
.canvas-export__title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
}
.canvas-export__body > *:first-child { margin-top: 0; }
.canvas-export__body h1,
.canvas-export__body h2,
.canvas-export__body h3,
.canvas-export__body h4 { line-height: 1.25; margin: 24px 0 12px; font-weight: 600; }
.canvas-export__body h1 { font-size: 22px; }
.canvas-export__body h2 { font-size: 19px; border-bottom: 1px solid #eceef1; padding-bottom: 6px; }
.canvas-export__body h3 { font-size: 16px; }
.canvas-export__body p { margin: 0 0 12px; }
.canvas-export__body a { color: #0969da; text-decoration: none; }
.canvas-export__body a:hover { text-decoration: underline; }
.canvas-export__body img { max-width: 100%; height: auto; border-radius: 4px; }
.canvas-export__body ul,
.canvas-export__body ol { margin: 0 0 12px; padding-left: 24px; }
.canvas-export__body li { margin: 4px 0; }
.canvas-export__body blockquote {
  margin: 0 0 12px;
  padding: 0 16px;
  color: #59636e;
  border-left: 3px solid #d0d7de;
}
.canvas-export__body table {
  border-collapse: collapse;
  margin: 0 0 16px;
  display: block;
  overflow-x: auto;
}
.canvas-export__body th,
.canvas-export__body td { border: 1px solid #d0d7de; padding: 6px 12px; text-align: left; }
.canvas-export__body th { background: #f6f8fa; font-weight: 600; }
.canvas-export__body code {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 85%;
  background: #eff1f3;
  padding: 0.2em 0.4em;
  border-radius: 4px;
}
.canvas-export__body pre {
  margin: 0 0 16px;
  padding: 14px 16px;
  overflow-x: auto;
  background: #f6f8fa;
  border-radius: 6px;
}
.canvas-export__body pre code { background: transparent; padding: 0; font-size: 90%; }
.canvas-export__body svg { max-width: 100%; height: auto; }
.canvas-export__excalidraw { text-align: center; }
.canvas-export__placeholder {
  display: inline-block;
  padding: 8px 12px;
  color: #59636e;
  background: #f6f8fa;
  border: 1px dashed #d0d7de;
  border-radius: 6px;
  font-size: 13px;
}
`.trim();

/**
 * highlight.js github-light theme, self-contained (no external stylesheet).
 * Covers the token classes emitted by `hljs.highlight`.
 */
export const HLJS_THEME_CSS = `
.hljs { color: #24292e; background: #f6f8fa; }
.hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-doctag, .hljs-formula { color: #d73a49; }
.hljs-string, .hljs-meta .hljs-string, .hljs-regexp { color: #032f62; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #005cc5; }
.hljs-title, .hljs-title.class_, .hljs-title.function_, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #6f42c1; }
.hljs-attr, .hljs-attribute, .hljs-built_in, .hljs-type, .hljs-symbol, .hljs-bullet, .hljs-link { color: #22863a; }
.hljs-meta, .hljs-comment.hljs-doctag { color: #6a737d; }
.hljs-deletion { color: #b31d28; background: #ffeef0; }
.hljs-addition { color: #22863a; background: #f0fff4; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: 600; }
`.trim();

/**
 * Deterministic, self-contained broken-image placeholder used when an image
 * reference cannot be resolved to a `data:` URI. URL-encoded SVG (no base64,
 * no Buffer/btoa) so it is byte-identical across Node and the browser.
 */
export const BROKEN_IMAGE_PLACEHOLDER: string = (() => {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" role="img" aria-label="missing image">' +
        '<rect width="120" height="90" fill="#f3f4f6" stroke="#d1d5db"/>' +
        '<path d="M20 66l24-28 18 20 12-12 26 20" fill="none" stroke="#9ca3af" stroke-width="3"/>' +
        '<circle cx="44" cy="30" r="7" fill="#9ca3af"/></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
})();
