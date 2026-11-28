/**
 * Vendored canvas library entry — Recharts as a classic-script global.
 *
 * React / ReactDOM are NOT bundled in here: the `globalExternals` esbuild plugin
 * in `scripts/build-client.mjs` rewrites those imports to read `window.React` /
 * `window.ReactDOM`, the Kusto loader supplies the SPA React instances before loading this bundle.
 */
import * as Recharts from 'recharts';

window.Recharts = Recharts;
