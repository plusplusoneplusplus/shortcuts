/**
 * Vendored canvas library entry — React + ReactDOM as classic-script globals.
 *
 * Bundled by `scripts/build-client.mjs` into
 * `src/server/spa/client/dist/canvas-vendor/react.js` and loaded into the
 * extension iframe with a classic `<script src>` tag. The iframe is an opaque
 * origin (`sandbox="allow-scripts"`, no `allow-same-origin`), so it sends
 * `Origin: null` and CoC's CORS policy returns no `Access-Control-Allow-Origin`
 * — module scripts and `fetch` are blocked there, classic scripts are not.
 * Hence globals rather than ESM + an import map.
 *
 * `ReactDOM` carries the react-dom/client roots (`createRoot`/`hydrateRoot`)
 * merged in, so an extension only ever needs the two globals.
 */
import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot, hydrateRoot } from 'react-dom/client';

window.React = React;
window.ReactDOM = Object.assign({}, ReactDOM, { createRoot, hydrateRoot });
