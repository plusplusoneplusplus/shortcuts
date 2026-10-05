/**
 * Command grammar shared by the Teams and WhatsApp connectors.
 *
 * One spec table drives both the parser and the help text, so they cannot drift.
 * Rules:
 *   - Case-insensitive; the leading `/` is optional except for mode prefixes,
 *     whose free-text body would otherwise swallow ordinary messages.
 *   - `/ask`, `/autopilot`, `/ralph`, and `/sentinel` set chat mode; plain text
 *     leaves it undefined (follow-ups keep the chat's current mode; new chats
 *     start as the sentinel dispatcher).
 *   - Any other `/word` that is not a command is `invalid` (callers reply with
 *     "Unknown command" + help). Bare `list|select|create` followed by a
 *     command noun (repo/agent/topic) but malformed is also `invalid`;
 *     other bare text is chat.
 *   - `[chatid] message` targets an explicit chat; every mode prefix can
 *     precede `[chatid] message` to combine mode and target.
 *   - `list topics <ref>` lists a remote repo's chats read-only; `<ref>` is a
 *     `n.m` number from `list remotes` or `name@server`. Bare `list topics`
 *     stays local. A trailing `-v` on either form also shows topic ids.
 */

export type MessagingChatMode = 'ask' | 'autopilot' | 'ralph' | 'sentinel';

export type MessagingCommand =
    | { type: 'list-repos' | 'list-remotes' | 'create-topic' | 'help' | 'quota'; args: '' }
    | { type: 'select-repo' | 'select-topic'; args: string }
    /**
     * `args` is an optional remote repo ref (`n.m` or `name@server`); empty lists
     * local topics. `verbose` (`-v`) shows topic ids.
     */
    | { type: 'list-topics'; args: string; verbose?: boolean }
    /** `args` is optional custom instructions that focus the summary. */
    | { type: 'compact'; args: string }
    /** `mode` is undefined for plain text: keep the chat's current mode. */
    | { type: 'chat'; args: string; mode?: MessagingChatMode }
    | { type: 'chat-explicit'; chatId: string; args: string; mode?: MessagingChatMode }
    | { type: 'invalid'; args: string };

export type MessagingControlCommand = Extract<MessagingCommand, { type: 'list-repos' | 'list-remotes' | 'list-topics' | 'create-topic' | 'help' | 'quota' | 'select-repo' | 'select-topic' | 'compact' }>;

export interface MessagingHelpCommandSpec {
    group: string;
    usage: string;
    summary: string;
    example?: string;
}

interface CommandSpec extends MessagingHelpCommandSpec {
    type: MessagingControlCommand['type'];
    /**
     * Matched against the text after an optional leading `/`; group 1 is the
     * argument, group 2 (list-topics only) the `-v` flag.
     */
    pattern: RegExp;
}

export const MESSAGING_COMMAND_SPECS: readonly CommandSpec[] = [
    { type: 'list-repos', group: 'Repos', pattern: /^list\s+(?:repos?|agents?)$/i, usage: 'list repos', summary: 'Show repos (alias: list agents)' },
    { type: 'select-repo', group: 'Repos', pattern: /^select\s+repos?\s+(.+)$/i, usage: 'select repo <n|name|id>', summary: 'Choose a repo; next message starts a new chat', example: 'select repo 2' },
    { type: 'list-remotes', group: 'Repos', pattern: /^list\s+remotes?$/i, usage: 'list remotes', summary: 'Show remote servers and repos' },
    { type: 'list-topics', group: 'Topics', pattern: /^list\s+(?:chat\s+)?topics?(?:\s+(\d+\.\d+|[^\s@]+@[^\s@]+))?(\s+-v)?$/i, usage: 'list topics [ref] [-v]', summary: 'Show chats; -v adds ids. Remote ref: n.m or repo@server (read-only)', example: 'list topics 1.2 -v' },
    { type: 'create-topic', group: 'Topics', pattern: /^create\s+(?:chat\s+)?topic$/i, usage: 'create topic', summary: 'Next message starts a new chat' },
    { type: 'select-topic', group: 'Topics', pattern: /^select\s+(?:chat\s+)?topic\s+(.+)$/i, usage: 'select topic <n|id>', summary: 'Continue an existing chat', example: 'select topic 1' },
    { type: 'compact', group: 'Topics', pattern: /^compact(?:\s+(.+))?$/is, usage: 'compact [instructions]', summary: 'Summarize context: replied-to chat, else selected topic' },
    { type: 'help', group: 'Tools', pattern: /^help$/i, usage: 'help', summary: 'Show this help' },
    { type: 'quota', group: 'Tools', pattern: /^quota$/i, usage: 'quota', summary: 'Show AI provider quota' },
];

/** Mode names drive both parsing and help. */
export const MESSAGING_MODE_SPECS: readonly { mode: MessagingChatMode; summary: string }[] = [
    { mode: 'ask', summary: 'Read-only question' },
    { mode: 'autopilot', summary: 'Run a task' },
    { mode: 'ralph', summary: 'Work toward a goal' },
    { mode: 'sentinel', summary: 'Use the dispatcher' },
];

const EXPLICIT_CHAT_PATTERN = /^\[([^\]]+)\]\s*(.+)$/s;
const MODE_PATTERN = new RegExp(`^/(${MESSAGING_MODE_SPECS.map(spec => spec.mode).join('|')})(?:\\s+(.*))?$`, 'is');
const COMMAND_LIKE_PATTERN = /^(?:list|select|create)\s+(?:repos?|agents?|remotes?|(?:chat\s+)?topics?)\b|^(?:list|select|create)$/i;

export interface MessagingHelpFormat {
    strong?: (text: string) => string;
    code?: (text: string) => string;
    escape?: (text: string) => string;
}

/** Reusable grouped layout for consumers with their own command grammar. */
export function formatMessagingHelpCommands(
    specs: readonly MessagingHelpCommandSpec[], format: MessagingHelpFormat = {},
): string {
    const plain = (text: string) => text;
    const escape = format.escape ?? plain;
    const strong = format.strong ?? escape;
    const code = format.code ?? escape;
    return [...new Set(specs.map(spec => spec.group))].map(group => [
        strong(group),
        ...specs.filter(spec => spec.group === group).map(spec => [
            code(spec.usage),
            escape(spec.summary),
            ...(spec.example ? [`Example: ${code(spec.example)}`] : []),
        ].join('\n')),
    ].join('\n\n')).join('\n\n');
}

/** Grouped help; Teams supplies Markdown styling, WhatsApp native bold headings. */
export function formatMessagingHelp(format: MessagingHelpFormat = {}): string {
    const plain = (text: string) => text;
    const strong = format.strong ?? plain;
    const code = format.code ?? plain;
    const escape = format.escape ?? plain;
    const sections = [
        `${strong('CoC help')}\nCommands ignore case; leading / is optional.\n<...> required · [...] optional · n = list number`,
        formatMessagingHelpCommands(MESSAGING_COMMAND_SPECS, format),
        [
            strong('Chat'),
            'Send plain text to continue the selected chat in its current mode.',
            'Without a topic, a new sentinel (dispatcher) chat starts.',
            `${code('[chatid] <message>')}\nSend to a specific chat.`,
        ].join('\n'),
        [
            strong('Modes (/ required)'),
            ...MESSAGING_MODE_SPECS.map(spec => `${code(`/${spec.mode} <message>`)} — ${escape(spec.summary)}`),
            'Set the mode for this message; prefixes can also target a chat.',
            `Example: ${code('/ask [chatid] What changed?')}`,
        ].join('\n'),
        'Unknown /commands reply with this help.',
    ];
    return sections.join('\n\n');
}

/** Plain-text fallback for consumers without platform styling. */
export const MESSAGING_HELP_TEXT = formatMessagingHelp();

function parseChat(text: string, mode?: MessagingChatMode): MessagingCommand {
    const explicit = EXPLICIT_CHAT_PATTERN.exec(text);
    if (explicit) return { type: 'chat-explicit', chatId: explicit[1].trim(), args: explicit[2].trim(), mode };
    return { type: 'chat', args: text, mode };
}

export function parseMessagingCommand(text: string): MessagingCommand {
    const value = text.trim();
    const body = value.replace(/^\//, '').trim();
    for (const { pattern, type } of MESSAGING_COMMAND_SPECS) {
        const match = pattern.exec(body);
        if (!match) continue;
        const args = (match[1] ?? '').trim();
        return (type === 'list-topics' ? { type, args, verbose: !!match[2] } : { type, args }) as MessagingControlCommand;
    }
    const modeCommand = MODE_PATTERN.exec(value);
    if (modeCommand) {
        const message = (modeCommand[2] ?? '').trim();
        const mode = modeCommand[1].toLowerCase() as MessagingChatMode;
        // An empty body stays a chat so callers can ask for the message.
        return message ? parseChat(message, mode) : { type: 'chat', args: '', mode };
    }
    if (value.startsWith('/') || COMMAND_LIKE_PATTERN.test(body)) return { type: 'invalid', args: value };
    return parseChat(value);
}

export function isMessagingControlCommand(command: MessagingCommand): command is MessagingControlCommand {
    return command.type !== 'chat' && command.type !== 'chat-explicit' && command.type !== 'invalid';
}
