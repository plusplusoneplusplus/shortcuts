/** Browser-safe wire contract shared by the server, desktop SPA and main process. */
export const BROWSER_ACTIONS = [
    'tabs', 'open', 'select', 'snapshot', 'read', 'click', 'type', 'select_option',
    'press', 'scroll', 'navigate', 'wait', 'screenshot', 'eval',
] as const;

export const BROWSER_TOOL_DESCRIPTION = 'Use only when browser mode is active (user typed /browser); otherwise never call. '
    + 'tabs; open(url,newTab?); select(tab); snapshot(ref?,all?); read(ref?,offset?); click(ref); type(ref,text,submit?); '
    + 'select_option(ref,value); press(key); scroll(ref?|direction); navigate(direction:back|forward|reload); '
    + 'wait(text|ms); screenshot(ref?); eval(js). Use eN snapshot refs. Screenshots only on request.';
export const BROWSER_SCHEMA_CHAR_BUDGET = 1600;

export interface BrowserCommand {
    action: typeof BROWSER_ACTIONS[number];
    tab?: string;
    ref?: string;
    url?: string;
    text?: string;
    value?: string;
    key?: string;
    direction?: string;
    ms?: number;
    js?: string;
    all?: boolean;
    offset?: number;
    newTab?: boolean;
    submit?: boolean;
}

export interface BrowserControlElement {
    ref: string;
    role: string;
    name: string;
    depth: number;
    checked?: boolean;
}

export interface BrowserControlTab {
    id: string;
    title: string;
    url: string;
    engine: 'electron' | 'webview2';
}

export interface BrowserCommandResult {
    tab?: string;
    title?: string;
    url?: string;
    tabs?: BrowserControlTab[];
    elements?: BrowserControlElement[];
    interactiveElements?: BrowserControlElement[];
    text?: string;
    textTotal?: number;
    value?: unknown;
    valueJson?: string;
    valueTruncated?: boolean;
    image?: { data: string; mimeType: 'image/jpeg' };
}

export interface BrowserCommandRequest {
    id: string;
    turnId?: string;
    workspaceId: string;
    processId: string;
    command: BrowserCommand;
    selectedTab?: string;
}

export type BrowserCommandReply =
    | { id: string; ok: true; result: BrowserCommandResult }
    | { id: string; ok: false; error: string };

export interface BrowserControlRuntime {
    getEnabled(): boolean;
    execute(workspaceId: string, processId: string, command: BrowserCommand, selectedTab?: string, signal?: AbortSignal, turnId?: string): Promise<BrowserCommandResult>;
}

export const BROWSER_TOOL_PARAMETERS = {
    type: 'object',
    properties: {
        action: { type: 'string', enum: BROWSER_ACTIONS },
        tab: { type: 'string' }, ref: { type: 'string' }, url: { type: 'string' },
        text: { type: 'string' }, value: { type: 'string' }, key: { type: 'string' },
        direction: { type: 'string' }, ms: { type: 'integer' }, js: { type: 'string' },
        all: { type: 'boolean' }, offset: { type: 'integer' },
        newTab: { type: 'boolean' }, submit: { type: 'boolean' },
    },
    required: ['action'],
    additionalProperties: false,
} as const;

const ACTION_PARAMS: Record<BrowserCommand['action'], { allowed: string[]; required: string[] }> = {
    tabs: { allowed: [], required: [] },
    open: { allowed: ['url', 'newTab'], required: ['url'] },
    select: { allowed: ['tab'], required: ['tab'] },
    snapshot: { allowed: ['ref', 'all'], required: [] },
    read: { allowed: ['ref', 'offset'], required: [] },
    click: { allowed: ['ref'], required: ['ref'] },
    type: { allowed: ['ref', 'text', 'submit'], required: ['ref', 'text'] },
    select_option: { allowed: ['ref', 'value'], required: ['ref', 'value'] },
    press: { allowed: ['key'], required: ['key'] },
    scroll: { allowed: ['ref', 'direction'], required: [] },
    navigate: { allowed: ['direction'], required: ['direction'] },
    wait: { allowed: ['text', 'ms'], required: [] },
    screenshot: { allowed: ['ref'], required: [] },
    eval: { allowed: ['js'], required: ['js'] },
};

/** Shared action validation; model and desktop boundaries use the same contract. */
export function assertBrowserCommand(raw: unknown): asserts raw is BrowserCommand {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('browser requires an object');
    const args = raw as Record<string, unknown>;
    if (typeof args.action !== 'string' || !BROWSER_ACTIONS.some(action => action === args.action)) {
        throw new TypeError('Unknown browser action');
    }
    const action = args.action as BrowserCommand['action'];
    const { allowed, required } = ACTION_PARAMS[action];
    for (const [name, value] of Object.entries(args)) {
        if (name === 'action') continue;
        if (!allowed.includes(name)) throw new TypeError(`${action}: unexpected parameter ${name}`);
        if (name === 'all' || name === 'newTab' || name === 'submit') {
            if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
        } else if (name === 'offset' || name === 'ms') {
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (name === 'ms' && value > 30_000)) {
                throw new TypeError(`${name} must be a nonnegative integer${name === 'ms' ? ' up to 30000' : ''}`);
            }
        } else if (typeof value !== 'string') {
            throw new TypeError(`${name} must be string`);
        } else if (name !== 'text' && name !== 'value' && !value.trim()) {
            throw new TypeError(`${name} must not be empty`);
        }
    }
    for (const name of required) if (!Object.prototype.hasOwnProperty.call(args, name)) throw new TypeError(`${action}: ${name} is required`);
    if (action === 'wait' && (('text' in args) === ('ms' in args))) throw new TypeError('wait requires exactly one of text or ms');
    if (action === 'wait' && typeof args.text === 'string' && !args.text.trim()) throw new TypeError('wait text must not be empty');
    if (action === 'scroll') {
        if (!('ref' in args) && !('direction' in args)) throw new TypeError('scroll requires ref or direction');
        if ('direction' in args && !['up', 'down', 'left', 'right'].includes(String(args.direction))) throw new TypeError('scroll direction must be up, down, left or right');
    }
    if (action === 'navigate' && !['back', 'forward', 'reload'].includes(String(args.direction))) throw new TypeError('navigate direction must be back, forward or reload');
}

export function parseBrowserCommand(raw: unknown): BrowserCommand {
    assertBrowserCommand(raw);
    return raw;
}
