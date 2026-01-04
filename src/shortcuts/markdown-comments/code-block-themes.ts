/**
 * Color scheme presets for code block syntax highlighting
 * These are applied based on the user's workspaceShortcuts.markdownComments.codeBlockTheme setting
 */

export type CodeBlockTheme = 'auto' | 'light' | 'dark';

/**
 * CSS color definitions for syntax highlighting tokens
 */
interface SyntaxColors {
    keyword: string;        // keywords, selector-tags, built-in, names, tags
    string: string;         // strings, titles, sections, attributes, literals
    number: string;         // numbers, symbols, bullets, links
    comment: string;        // comments, quotes, deletions, meta
    function: string;       // function names, class titles
    variable: string;       // variables, template-variables, attrs, params, properties
    type: string;           // types, class names
    regexp: string;         // regexp, selector-attr, selector-pseudo
}

/**
 * Code block styling including background and borders
 */
interface CodeBlockStyle {
    /** Background color for the code content area */
    contentBackground: string;
    /** Background color for the header (language label) */
    headerBackground: string;
    /** Border color for the code block */
    border: string;
    /** Background color on line hover */
    lineHover: string;
    /** Left accent border color */
    accentBorder: string;
}

/**
 * Complete theme definition
 */
export interface CodeBlockThemeDefinition {
    syntax: SyntaxColors;
    block: CodeBlockStyle;
}

/**
 * Dark theme preset - optimized for dark VSCode themes
 * Uses high-saturation colors for better visibility on dark backgrounds
 */
export const darkTheme: CodeBlockThemeDefinition = {
    syntax: {
        keyword: '#7dcfff',     // Bright blue
        string: '#ce9178',      // Orange/rust
        number: '#b5cea8',      // Light green
        comment: '#6a9955',     // Muted green
        function: '#dcdcaa',    // Yellow
        variable: '#9cdcfe',    // Light blue
        type: '#4ec9b0',        // Teal/cyan
        regexp: '#d16969',      // Red
    },
    block: {
        contentBackground: '#1e1e1e',      // Darker than typical editor bg
        headerBackground: '#2d2d30',       // Slightly lighter header
        border: '#3c3c3c',                 // Visible border
        lineHover: 'rgba(255, 255, 255, 0.06)',
        accentBorder: '#0078d4',           // VSCode blue accent
    }
};

/**
 * Light theme preset - optimized for light VSCode themes
 * Uses darker, more saturated colors for better visibility on light backgrounds
 */
export const lightTheme: CodeBlockThemeDefinition = {
    syntax: {
        keyword: '#0000ff',     // Classic blue
        string: '#a31515',      // Dark red
        number: '#098658',      // Forest green
        comment: '#008000',     // Green
        function: '#795e26',    // Brown/olive
        variable: '#001080',    // Dark blue
        type: '#267f99',        // Teal
        regexp: '#811f3f',      // Dark magenta
    },
    block: {
        contentBackground: '#f5f5f5',      // Light gray background
        headerBackground: '#e8e8e8',       // Slightly darker header
        border: '#d4d4d4',                 // Visible border
        lineHover: 'rgba(0, 0, 0, 0.04)',
        accentBorder: '#0078d4',           // VSCode blue accent
    }
};

/**
 * Generate CSS custom properties for the given theme
 */
export function generateThemeCSS(theme: CodeBlockThemeDefinition): string {
    return `
        /* Code block theme overrides */
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-built_in,
        .hljs-name,
        .hljs-tag {
            color: ${theme.syntax.keyword} !important;
        }

        .hljs-string,
        .hljs-title,
        .hljs-section,
        .hljs-attribute,
        .hljs-literal,
        .hljs-template-tag,
        .hljs-template-variable,
        .hljs-addition {
            color: ${theme.syntax.string} !important;
        }

        .hljs-number,
        .hljs-symbol,
        .hljs-bullet,
        .hljs-link {
            color: ${theme.syntax.number} !important;
        }

        .hljs-comment,
        .hljs-quote,
        .hljs-deletion,
        .hljs-meta {
            color: ${theme.syntax.comment} !important;
        }

        .hljs-class .hljs-title,
        .hljs-function .hljs-title,
        .hljs-title.function_ {
            color: ${theme.syntax.function} !important;
        }

        .hljs-variable,
        .hljs-template-variable,
        .hljs-attr,
        .hljs-params,
        .hljs-property {
            color: ${theme.syntax.variable} !important;
        }

        .hljs-type,
        .hljs-title.class_ {
            color: ${theme.syntax.type} !important;
        }

        .hljs-regexp,
        .hljs-selector-attr,
        .hljs-selector-pseudo {
            color: ${theme.syntax.regexp} !important;
        }

        /* Code block styling */
        .code-block {
            background: ${theme.block.contentBackground} !important;
            border-color: ${theme.block.border} !important;
            border-left: 3px solid ${theme.block.accentBorder} !important;
        }

        .code-block-header {
            background: ${theme.block.headerBackground} !important;
            border-bottom-color: ${theme.block.border} !important;
        }

        .code-block-content {
            background: ${theme.block.contentBackground} !important;
        }

        .code-line:hover {
            background: ${theme.block.lineHover} !important;
        }
    `;
}

/**
 * Get the theme definition based on setting and current VSCode theme kind
 */
export function getThemeForSetting(
    setting: CodeBlockTheme,
    vscodeThemeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'
): CodeBlockThemeDefinition {
    if (setting === 'light') {
        return lightTheme;
    }
    if (setting === 'dark') {
        return darkTheme;
    }

    // 'auto' - detect based on VSCode theme
    if (vscodeThemeKind === 'light' || vscodeThemeKind === 'high-contrast-light') {
        return lightTheme;
    }
    return darkTheme;
}

/**
 * Generate the CSS style block for the webview
 */
export function generateCodeBlockThemeStyle(
    setting: CodeBlockTheme,
    vscodeThemeKind: 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'
): string {
    const theme = getThemeForSetting(setting, vscodeThemeKind);
    return `<style id="code-block-theme">${generateThemeCSS(theme)}</style>`;
}
