/**
 * Monaco Editor environment setup.
 *
 * Configures the bundled Monaco instance and worker URLs.
 * Must be imported before any Monaco editor components mount.
 */
import * as monaco from 'monaco-editor';
import 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js';
import { loader } from '@monaco-editor/react';
import { conf as tsConf, language as tsLanguage } from 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js';
import { conf as jsConf, language as jsLanguage } from 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js';
import { registerShadowLanguages, type ShadowMonaco } from '../../language-servers/shadowLanguage';
import { installLanguageEditorOpener, type NavigationMonaco } from '../../language-servers/editorNavigation';
import { installSemanticTokenThemes, type SemanticThemeMonaco } from '../../language-servers/semanticTokens';
import { registerTlaLanguage, type TlaMonaco } from '../../../shared/monaco/tlaLanguage';
import { monacoWorkerUrl } from './monacoWorkerUrls';

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

// Languages Monaco's bundle lacks are registered before any model exists, so
// a `.tla` file opened in an editor, preview or diff tokenizes from the start.
registerTlaLanguage(monaco as unknown as TlaMonaco);

// A definition in another file has nowhere to open in a standalone Monaco, so
// the one global opener is installed here and dispatches to whichever preview
// pane started the navigation. The side-effect import above supplies Monaco's
// Ctrl/Cmd-click gesture; panes register themselves against their model.
installLanguageEditorOpener(monaco as unknown as NavigationMonaco);

// Language-server semantic tokens are colored by rules added to the built-in
// `vs` and `vs-dark` themes, so every editor keeps its existing theme name.
installSemanticTokenThemes(monaco as unknown as SemanticThemeMonaco);

window.MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, label: string) {
        return monacoWorkerUrl(label);
    },
};
