/**
 * Monaco ships no typings for the individual basic-language modules, only for
 * their `.contribution` entry points. The shadow languages (see
 * `features/language-servers/shadowLanguage.ts`) need the raw Monarch
 * definitions, so declare the two modules that are imported.
 */
declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.js' {
    export const conf: unknown;
    export const language: unknown;
}

declare module 'monaco-editor/esm/vs/basic-languages/javascript/javascript.js' {
    export const conf: unknown;
    export const language: unknown;
}
