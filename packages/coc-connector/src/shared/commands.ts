/**
 * Command grammar shared by the Teams and WhatsApp connectors.
 *
 * One spec table drives both the parser and the help text, so they cannot drift.
 * Rules:
 *   - Case-insensitive; the leading `/` is optional except for `/autopilot`,
 *     whose free-text body would otherwise swallow ordinary messages.
 *   - Any other `/word` that is not a command is `invalid` (callers reply with
 *     "Unknown command" + help). Bare `list|select|create` followed by a
 *     command noun (repo/agent/topic) but malformed is also `invalid`;
 *     other bare text is chat.
 *   - `[chatid] message` targets an explicit chat; `/autopilot [chatid] message`
 *     combines both.
 */

export type MessagingChatMode = 'ask' | 'autopilot';

export type MessagingCommand =
    | { type: 'list-repos' | 'list-topics' | 'create-topic' | 'help' | 'quota'; args: '' }
    | { type: 'select-repo' | 'select-topic'; args: string }
    /** `args` is optional custom instructions that focus the summary. */
    | { type: 'compact'; args: string }
    | { type: 'chat'; args: string; mode: MessagingChatMode }
    | { type: 'chat-explicit'; chatId: string; args: string; mode: MessagingChatMode }
    | { type: 'invalid'; args: string };

export type MessagingControlCommand = Extract<MessagingCommand, { type: 'list-repos' | 'list-topics' | 'create-topic' | 'help' | 'quota' | 'select-repo' | 'select-topic' | 'compact' }>;

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
    { type: 'list-topics', pattern: /^list\s+(?:chat\s+)?topics?$/i, usage: 'list topics', summary: 'list recent chats' },
    { type: 'create-topic', pattern: /^create\s+(?:chat\s+)?topic$/i, usage: 'create topic', summary: 'your next message starts a new chat' },
    { type: 'select-topic', pattern: /^select\s+(?:chat\s+)?topic\s+(.+)$/i, usage: 'select topic <n|id>', summary: 'continue an existing chat' },
    { type: 'compact', pattern: /^compact(?:\s+(.+))?$/is, usage: 'compact [instructions]', summary: "compact the chat's context (quoted reply's chat, else selected topic)" },
    { type: 'help', pattern: /^help$/i, usage: 'help', summary: 'show this help' },
    { type: 'quota', pattern: /^quota$/i, usage: 'quota', summary: 'show AI provider quota' },
];

const EXPLICIT_CHAT_PATTERN = /^\[([^\]]+)\]\s*(.+)$/s;
const AUTOPILOT_PATTERN = /^\/autopilot(?:\s+(.*))?$/is;
const COMMAND_LIKE_PATTERN = /^(?:list|select|create)\s+(?:repos?|agents?|(?:chat\s+)?topics?)\b|^(?:list|select|create)$/i;

export const MESSAGING_HELP_TEXT = [
    'Commands (case-insensitive, leading / optional):',
    ...MESSAGING_COMMAND_SPECS.map(spec => `${spec.usage} — ${spec.summary}`),
    '/autopilot <message> — run this one message in autopilot (/ required)',
    '[chatid] <message> — send to a specific chat',
    '<message> — chat in the selected topic, or start one',
    'Any other /word replies "Unknown command".',
].join('\n');

function parseChat(text: string, mode: MessagingChatMode): MessagingCommand {
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
    const autopilot = AUTOPILOT_PATTERN.exec(value);
    if (autopilot) {
        const message = (autopilot[1] ?? '').trim();
        return message ? parseChat(message, 'autopilot') : { type: 'invalid', args: value };
    }
    if (value.startsWith('/') || COMMAND_LIKE_PATTERN.test(body)) return { type: 'invalid', args: value };
    return parseChat(value, 'ask');
}

export function isMessagingControlCommand(command: MessagingCommand): command is MessagingControlCommand {
    return command.type !== 'chat' && command.type !== 'chat-explicit' && command.type !== 'invalid';
}
