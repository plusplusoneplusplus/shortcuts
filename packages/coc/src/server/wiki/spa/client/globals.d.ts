// CDN globals loaded via <script> tags in html-template.ts
declare const marked: { parse(md: string): string };
declare const hljs: { highlightElement(el: Element): void };
declare const mermaid: {
    initialize(config: Record<string, unknown>): void;
    run(opts: { nodes: NodeListOf<Element> }): Promise<void>;
};
declare const d3: any; // eslint-disable-line @typescript-eslint/no-explicit-any

// Config injected by the server into a <script> tag before the bundle
interface WikiConfig {
    defaultTheme: string;
    enableSearch: boolean;
    enableAI: boolean;
    enableGraph: boolean;
    enableWatch: boolean;
}

interface Window {
    __WIKI_CONFIG__: WikiConfig;
}
