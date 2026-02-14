import type { WebsiteTheme } from '../../types';

export interface SpaTemplateOptions {
    /** Website theme */
    theme: WebsiteTheme;
    /** Project title */
    title: string;
    /** Enable search */
    enableSearch: boolean;
    /** Enable AI features (Ask panel) */
    enableAI: boolean;
    /** Enable interactive dependency graph */
    enableGraph: boolean;
    /** Enable watch mode (WebSocket live reload) */
    enableWatch?: boolean;
}

export interface ScriptOptions {
    enableSearch: boolean;
    enableAI: boolean;
    enableGraph: boolean;
    enableWatch: boolean;
    defaultTheme: WebsiteTheme;
}
