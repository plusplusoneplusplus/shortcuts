/**
 * Monaco Editor environment setup.
 *
 * Configures the bundled Monaco instance and worker URLs.
 * Must be imported before any Monaco editor components mount.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import { conf as tsConf, language as tsLanguage } from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js';
import { conf as jsConf, language as jsLanguage } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';
import { registerShadowLanguages, type ShadowMonaco } from '../../language-servers/shadowLanguage';

// Use the locally bundled Monaco instead of CDN
loader.config({ monaco });

// The private language ids an LSP-managed model moves onto, so Monaco's own
// TypeScript worker stops answering for it while every other Monaco instance in
// the page keeps its built-in support. This is the only place the raw Monarch
// definitions are read; `shadowLanguage.ts` itself stays Monaco-free.
registerShadowLanguages(monaco as unknown as ShadowMonaco, {
    typescript: { conf: tsConf, language: tsLanguage },
    javascript: { conf: jsConf, language: jsLanguage },
});

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
