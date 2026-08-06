/**
 * Vendored canvas library entry — Recharts as a classic-script global.
 *
 * React / ReactDOM are NOT bundled in here: the `globalExternals` esbuild plugin
 * in `scripts/build-client.mjs` rewrites those imports to read `window.React` /
 * `window.ReactDOM`, so `react.js` must load first (the library registry in
 * `canvas-libraries.ts` declares that dependency and the bootstrap honours the
 * order).
 */
import * as Recharts from 'recharts';

window.Recharts = Recharts;
