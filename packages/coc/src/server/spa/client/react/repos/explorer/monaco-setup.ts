/**
 * Monaco Editor environment setup.
 *
 * Configures the bundled Monaco instance and worker URLs.
 * Must be imported before any Monaco editor components mount.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

// Use the locally bundled Monaco instead of CDN
loader.config({ monaco });

// Point web workers to /static/ served files
window.MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, label: string) {
        if (label === 'json') return '/static/json.worker.js';
        if (label === 'css' || label === 'scss' || label === 'less') return '/static/css.worker.js';
        if (label === 'html' || label === 'handlebars' || label === 'razor') return '/static/html.worker.js';
        if (label === 'typescript' || label === 'javascript') return '/static/ts.worker.js';
        return '/static/editor.worker.js';
    },
};
