/**
 * Command grammar shared by the Teams and WhatsApp connectors.
 *
 * One spec table drives both the parser and the help text, so they cannot drift.
 * Rules:
 *   - Case-insensitive; the leading `/` is optional except for `/autopilot` and
 *     `/ask`, whose free-text body would otherwise swallow ordinary messages.
 *   - Chat mode is three-state: `/autopilot <msg>` → autopilot, `/ask <msg>` →
 *     ask, plain text → undefined (follow-ups keep the chat's current mode; new
 *     chats default to ask).
 *   - Any other `/word` that is not a command is `invalid` (callers reply with
 *     "Unknown command" + help). Bare `list|select|create` followed by a
 *     command noun (repo/agent/topic) but malformed is also `invalid`;
 *     other bare text is chat.
 *   - `[chatid] message` targets an explicit chat; `/autopilot [chatid] message`
 *     and `/ask [chatid] message` combine both.
 *   - `list topics <ref>` lists a remote repo's chats read-only; `<ref>` is a
 *     `n.m` number from `list remotes` or `name@server`. Bare `list topics`
 *     stays local.
 */

export type MessagingChatMode = 'ask' | 'autopilot';

export type MessagingCommand =
    | { type: 'list-repos' | 'list-remotes' | 'create-topic' | 'help' | 'quota'; args: '' }
    | { type: 'select-repo' | 'select-topic'; args: string }
    /** `args` is an optional remote repo ref (`n.m` or `name@server`); empty lists local topics. */
    | { type: 'list-topics'; args: string }
    /** `args` is optional custom instructions that focus the summary. */
    | { type: 'compact'; args: string }
    /** `mode` is undefined for plain text: keep the chat's current mode. */
    | { type: 'chat'; args: string; mode?: MessagingChatMode }
    | { type: 'chat-explicit'; chatId: string; args: string; mode?: MessagingChatMode }
    | { type: 'invalid'; args: string };

export type MessagingControlCommand = Extract<MessagingCommand, { type: 'list-repos' | 'list-remotes' | 'list-topics' | 'create-topic' | 'help' | 'quota' | 'select-repo' | 'select-topic' | 'compact' }>;

interface CommandSpec {
    type: MessagingControlCommand['type'];
    /** Matched against the text after an optional leading `/`; group 1 is the argument. */
    pattern: RegExp;
    usage: string;
    summary: string;
}

export const MESSAGING_COMMAND_SPECS: readonly CommandSpec[] = [
    { type: 'list-repos', pattern: /^list\s+(?:repos?|agents?)$/i, usage: 'list repos', summary: 'list registered repos (alias: list agents)' },
    { type: 'select-repo', pattern: /^select\s+repos?\s+(.+)$/i, usage: 'select repo <n|name|id>', summary: 'choose the repo for new chats' },
    { type: 'list-remotes', pattern: /^list\s+remotes?$/i, usage: 'list remotes', summary: 'list remote servers and their repos' },
    { type: 'list-topics', pattern: /^list\s+(?:chat\s+)?topics?(?:\s+(\d+\.\d+|[^\s@]+@[^\s@]+))?$/i, usage: 'list topics', summary: 'list recent chats; add n.m or repo@server for a remote repo (read-only)' },
    { type: 'create-topic', pattern: /^create\s+(?:chat\s+)?topic$/i, usage: 'create topic', summary: 'your next message starts a new chat' },
    { type: 'select-topic', pattern: /^select\s+(?:chat\s+)?topic\s+(.+)$/i, usage: 'select topic <n|id>', summary: 'continue an existing chat' },
    { type: 'compact', pattern: /^compact(?:\s+(.+))?$/is, usage: 'compact [instructions]', summary: "compact the chat's context (quoted reply's chat, else selected topic)" },
    { type: 'help', pattern: /^help$/i, usage: 'help', summary: 'show this help' },
    { type: 'quota', pattern: /^quota$/i, usage: 'quota', summary: 'show AI provider quota' },
];

const EXPLICIT_CHAT_PATTERN = /^\[([^\]]+)\]\s*(.+)$/s;
const MODE_PATTERN = /^\/(autopilot|ask)(?:\s+(.*))?$/is;
const COMMAND_LIKE_PATTERN = /^(?:list|select|create)\s+(?:repos?|agents?|remotes?|(?:chat\s+)?topics?)\b|^(?:list|select|create)$/i;

export const MESSAGING_HELP_TEXT = [
    'Commands (case-insensitive, leading / optional):',
    ...MESSAGING_COMMAND_SPECS.map(spec => `${spec.usage} — ${spec.summary}`),
    '/autopilot <message> — run this one message in autopilot (/ required)',
    '/ask <message> — run this one message in ask (read-only) mode (/ required)',
    '[chatid] <message> — send to a specific chat',
    '<message> — chat in the selected topic (keeps its mode), or start one in ask',
    'Any other /word replies "Unknown command".',
].join('\n');

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
        if (match) return { type, args: (match[1] ?? '').trim() } as MessagingControlCommand;
    }
    const modeCommand = MODE_PATTERN.exec(value);
    if (modeCommand) {
        const message = (modeCommand[2] ?? '').trim();
        const mode = modeCommand[1].toLowerCase() as MessagingChatMode;
        return message ? parseChat(message, mode) : { type: 'invalid', args: value };
    }
    if (value.startsWith('/') || COMMAND_LIKE_PATTERN.test(body)) return { type: 'invalid', args: value };
    return parseChat(value);
}

export function isMessagingControlCommand(command: MessagingCommand): command is MessagingControlCommand {
    return command.type !== 'chat' && command.type !== 'chat-explicit' && command.type !== 'invalid';
}
