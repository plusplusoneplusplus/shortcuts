/** Browser-safe wire contract shared by the server, desktop SPA and main process. */
export const BROWSER_ACTIONS = [
    'tabs', 'open', 'select', 'snapshot', 'read', 'click', 'type', 'select_option',
    'press', 'scroll', 'navigate', 'wait', 'screenshot', 'eval', 'frames', 'paste_html',
] as const;

export const BROWSER_TOOL_DESCRIPTION = 'Only in /browser mode; otherwise never call. tabs; open(url,newTab?); select(tab); snapshot(ref?,all?); '
    + 'read(ref?|frame?,offset?); click(ref); type(ref,text,submit?); select_option(ref,value); press(key,frame?); '
    + 'scroll(ref?|direction,frame?); navigate(direction:back|forward|reload); wait(text,frame?)|wait(ms); '
    + 'eval(js,frame?); frames(offset?); paste_html(ref,html,text,replaceClipboard?). Rich paste requires enabled support and focused selection; replaces clipboard only with permission. '
    + 'Ref/frame are exclusive. Use returned refs; frames require enabled support. '
    + 'screenshot(ref?,format?,view?) only on request; JPEG default. Saves file; reply with returned markdown. view=true attaches pixels.';
export const BROWSER_SCHEMA_CHAR_BUDGET = 1600;

export interface BrowserCommand {
    action: typeof BROWSER_ACTIONS[number];
    tab?: string;
    ref?: string;
    frame?: string;
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
    format?: 'jpeg' | 'png';
    view?: boolean;
    html?: string;
    replaceClipboard?: boolean;
}

export interface BrowserControlElement {
    ref: string;
    role: string;
    name: string;
    depth: number;
    checked?: boolean;
    frame?: string;
}

export interface BrowserControlFrame {
    id: string;
    parent?: string;
    origin: string;
    name: string;
    document: string;
    status: 'ready' | 'loading' | 'unavailable';
    depth: number;
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
    frames?: BrowserControlFrame[];
    frame?: string;
    document?: string;
    truncated?: string;
    text?: string;
    textTotal?: number;
    value?: unknown;
    valueJson?: string;
    valueTruncated?: boolean;
    image?: { data: string; mimeType: 'image/jpeg' | 'image/png' };
}

export interface BrowserCommandRequest {
    id: string;
    turnId?: string;
    workspaceId: string;
    processId: string;
    command: BrowserCommand;
    selectedTab?: string;
    framesEnabled?: boolean;
    richPasteEnabled?: boolean;
}

export type BrowserCommandReply =
    | { id: string; ok: true; result: BrowserCommandResult }
    | { id: string; ok: false; error: string };

export interface BrowserControlRuntime {
    getEnabled(): boolean;
    getFramesEnabled?(): boolean;
    execute(workspaceId: string, processId: string, command: BrowserCommand, selectedTab?: string, signal?: AbortSignal, turnId?: string): Promise<BrowserCommandResult>;
}

export const BROWSER_TOOL_PARAMETERS = {
    type: 'object',
    properties: {
        action: { type: 'string', enum: BROWSER_ACTIONS },
        tab: { type: 'string' }, ref: { type: 'string' }, frame: { type: 'string' }, url: { type: 'string' },
        text: { type: 'string' }, value: { type: 'string' }, key: { type: 'string' },
        direction: { type: 'string' }, ms: { type: 'integer' }, js: { type: 'string' },
        all: { type: 'boolean' }, offset: { type: 'integer' },
        html: { type: 'string' }, replaceClipboard: { type: 'boolean' },
        newTab: { type: 'boolean' }, submit: { type: 'boolean' },
        format: { type: 'string', enum: ['jpeg', 'png'] }, view: { type: 'boolean' },
    },
    required: ['action'],
    additionalProperties: false,
} as const;

const ACTION_PARAMS: Record<BrowserCommand['action'], { allowed: string[]; required: string[] }> = {
    tabs: { allowed: [], required: [] },
    open: { allowed: ['url', 'newTab'], required: ['url'] },
    select: { allowed: ['tab'], required: ['tab'] },
    snapshot: { allowed: ['ref', 'all'], required: [] },
    read: { allowed: ['ref', 'frame', 'offset'], required: [] },
    click: { allowed: ['ref'], required: ['ref'] },
    type: { allowed: ['ref', 'text', 'submit'], required: ['ref', 'text'] },
    select_option: { allowed: ['ref', 'value'], required: ['ref', 'value'] },
    press: { allowed: ['key', 'frame'], required: ['key'] },
    scroll: { allowed: ['ref', 'frame', 'direction'], required: [] },
    navigate: { allowed: ['direction'], required: ['direction'] },
    wait: { allowed: ['text', 'ms', 'frame'], required: [] },
    screenshot: { allowed: ['ref', 'format', 'view'], required: [] },
    eval: { allowed: ['js', 'frame'], required: ['js'] },
    frames: { allowed: ['offset'], required: [] },
    paste_html: { allowed: ['ref', 'html', 'text', 'replaceClipboard'], required: ['ref', 'html', 'text'] },
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
        if (name === 'all' || name === 'newTab' || name === 'submit' || name === 'view' || name === 'replaceClipboard') {
            if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
        } else if (name === 'offset' || name === 'ms') {
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || (name === 'ms' && value > 30_000)) {
                throw new TypeError(`${name} must be a nonnegative integer${name === 'ms' ? ' up to 30000' : ''}`);
            }
        } else if (typeof value !== 'string') {
            throw new TypeError(`${name} must be string`);
        } else if (name !== 'text' && name !== 'value' && !value.trim()) {
            throw new TypeError(`${name} must not be empty`);
        } else if (name === 'frame' && value.length > 256) {
            throw new TypeError('frame handle is too long');
        } else if (name === 'frame' && /[\s|[\]]/.test(value)) {
            throw new TypeError('invalid frame handle');
        }
    }
    for (const name of required) if (!Object.prototype.hasOwnProperty.call(args, name)) throw new TypeError(`${action}: ${name} is required`);
    if (action === 'paste_html' && (String(args.html).length + String(args.text).length > 128000)) {
        throw new TypeError('Rich paste exceeds 128000 characters');
    }
    if ('frame' in args && 'ref' in args) throw new TypeError(`${action}: ref and frame cannot be combined`);
    if (action === 'wait' && 'frame' in args && 'ms' in args) throw new TypeError('frame is only valid for text wait');
    if (action === 'wait' && (('text' in args) === ('ms' in args))) throw new TypeError('wait requires exactly one of text or ms');
    if (action === 'wait' && typeof args.text === 'string' && !args.text.trim()) throw new TypeError('wait text must not be empty');
    if (action === 'scroll') {
        if (!('ref' in args) && !('direction' in args)) throw new TypeError('scroll requires ref or direction');
        if ('direction' in args && !['up', 'down', 'left', 'right'].includes(String(args.direction))) throw new TypeError('scroll direction must be up, down, left or right');
    }
    if (action === 'navigate' && !['back', 'forward', 'reload'].includes(String(args.direction))) throw new TypeError('navigate direction must be back, forward or reload');
    if ('format' in args && args.format !== 'jpeg' && args.format !== 'png') throw new TypeError('format must be jpeg or png');
}

export function parseBrowserCommand(raw: unknown): BrowserCommand {
    assertBrowserCommand(raw);
    return raw;
}
