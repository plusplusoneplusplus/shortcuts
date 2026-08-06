/**
 * JSX → JS transform for extension canvases.
 *
 * A *transform*, not a bundle: esbuild rewrites JSX syntax to
 * `React.createElement` calls and nothing else — no module resolution, no
 * filesystem access, no `node_modules` walk, single-digit milliseconds. The
 * libraries an artifact uses arrive as classic-script globals loaded by the
 * iframe bootstrap (see `canvas-libraries.ts`), which is why the compiled code
 * can reference `React` / `Recharts` without importing anything.
 *
 * A syntax error comes back as a structured failure so the tool layer can hand
 * the AI a real error with a line number. Nothing is stored on failure — a
 * saved canvas that renders blank is the outcome this exists to prevent.
 *
 * Node-only (imports esbuild). Never import this from browser/SPA code.
 */

import * as esbuild from 'esbuild';

export type CanvasJsxTransformResult =
    | { ok: true; code: string }
    | { ok: false; error: string };

/** Format one esbuild message as `line 12:4: Unexpected "}"`, with the source line when available. */
function formatMessage(message: esbuild.Message): string {
    const location = message.location;
    if (!location) return message.text;
    const where = `line ${location.line}:${location.column}`;
    const lineText = location.lineText?.trim();
    return lineText ? `${where}: ${message.text}\n    ${lineText}` : `${where}: ${message.text}`;
}

function formatFailure(err: unknown): string {
    const errors = (err as { errors?: esbuild.Message[] } | null)?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
        return errors.map(formatMessage).join('\n');
    }
    return err instanceof Error ? err.message : String(err);
}

/**
 * Transform an extension canvas's JSX source into plain JS.
 *
 * Uses the CLASSIC runtime (`React.createElement` / `React.Fragment`) rather
 * than the automatic one: automatic emits an `import` of `react/jsx-runtime`,
 * and the iframe cannot resolve modules — `React` is a global there.
 */
export async function transformCanvasJsx(source: string): Promise<CanvasJsxTransformResult> {
    try {
        const result = await esbuild.transform(source, {
            loader: 'jsx',
            jsxFactory: 'React.createElement',
            jsxFragment: 'React.Fragment',
            // Matches the vendored bundles' target, and the browsers that can
            // render the dashboard at all.
            target: 'es2020',
            // Named so an artifact's runtime stack traces point somewhere useful.
            sourcefile: 'ui.jsx',
        });
        return { ok: true, code: result.code };
    } catch (err) {
        return { ok: false, error: formatFailure(err) };
    }
}
