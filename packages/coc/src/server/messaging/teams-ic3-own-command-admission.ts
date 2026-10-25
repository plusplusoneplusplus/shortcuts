import type { TeamsIc3Account, TeamsIc3Chat, TeamsIc3Message } from '@plusplusoneplusplus/coc-native';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { teamsCodeSpan } from './teams-outbound-format';

export interface TeamsIc3OwnCommandContext {
    readonly account: TeamsIc3Account;
    /** Discovered ordinary chat, or the account's self stream. */
    readonly chat: TeamsIc3Chat;
}

export type TeamsIc3OwnCommandAdmission =
    | { readonly kind: 'command'; readonly prompt: string }
    | { readonly kind: 'ignored'; readonly reason:
        'invalid-evidence' | 'unsupported-chat' | 'foreign-sender'
        | 'edited-or-deleted' | 'incomplete-body' | 'not-command' };

const ignoredTags = new Set([
    'BLOCKQUOTE', 'QUOTE', 'SWIFT', 'ATTACHMENT', 'IMG', 'AT',
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE',
]);
const blockTags = new Set([
    'P', 'DIV', 'BR', 'HR', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

interface RichTextNode {
    nodeName: string;
    getAttribute(name: string): string | null;
}
function isRichTextNode(node: object): node is RichTextNode {
    return 'nodeName' in node && typeof node.nodeName === 'string'
        && 'getAttribute' in node && typeof node.getAttribute === 'function';
}

const richText = new TurndownService({ blankReplacement: () => '\n' });
richText.escape = text => text;
richText.addRule('literal-text', {
    filter: () => true,
    replacement: (content, node) => {
        if (!isRichTextNode(node)) throw new TypeError('Invalid Teams rich-text node.');
        const itemType = node.getAttribute('itemtype') ?? '';
        const classes = node.getAttribute('class') ?? '';
        if (ignoredTags.has(node.nodeName)
            || /(?:^|[/#])(?:reply|quote|forward(?:ed)?(?:message)?)$/i.test(itemType)
            || /(?:^|\s)(?:quote|quoted|forwarded|reply)(?:-message)?(?:\s|$)/i.test(classes)) {
            // Keep boundaries so ignored regions cannot splice a new command prefix.
            return '\n';
        }
        if (node.nodeName === 'BR') return '\n';
        if (node.nodeName === 'CODE') return teamsCodeSpan(content);
        if (node.nodeName === 'PRE') return `\n${teamsCodeSpan(content)}\n`;
        return blockTags.has(node.nodeName) ? `\n${content}\n` : content;
    },
});

function commandText(message: TeamsIc3Message): string {
    const text = message.untrustedHtml === undefined
        ? message.text : richText.turndown(message.untrustedHtml);
    // Plain-text Teams replies can contain Markdown quotations too.
    const tokens = marked.lexer(text);
    const result = tokens.map(token => token.type === 'blockquote' ? '\n' : token.raw).join('');
    return tokens[0]?.type === 'blockquote' ? result.trimStart() : result;
}

/** Accept only an unedited own-user command outside quotes, code and attachments. */
export function admitTeamsIc3OwnCommand(
    context: TeamsIc3OwnCommandContext,
    message: TeamsIc3Message,
): TeamsIc3OwnCommandAdmission {
    const ignore = (reason: Extract<TeamsIc3OwnCommandAdmission, { kind: 'ignored' }>['reason'])
        : TeamsIc3OwnCommandAdmission => ({ kind: 'ignored', reason });
    const { account, chat } = context;
    const self = chat.chatId === '48:notes';
    if (!chat.chatId || message.chatId !== chat.chatId || !message.messageId.trim()
        || !account.tenantId.trim() || !account.userId.trim()) {
        return ignore('invalid-evidence');
    }
    if (self ? chat.kind !== 'self' : !['oneOnOne', 'group'].includes(chat.kind)) {
        return ignore('unsupported-chat');
    }
    if (message.authorKind !== 'user' || !message.authorId
        || message.authorId.toLowerCase() !== account.userId.toLowerCase()) {
        return ignore('foreign-sender');
    }
    const created = Date.parse(message.createdAt);
    const modified = Date.parse(message.modifiedAt);
    if (!Number.isFinite(created) || !Number.isFinite(modified)) return ignore('invalid-evidence');
    if (message.deleted || modified !== created) return ignore('edited-or-deleted');
    if (message.textTruncated || message.htmlTruncated
        || Buffer.byteLength(message.text, 'utf8') > 16 * 1024
        || (message.untrustedHtml !== undefined
            && Buffer.byteLength(message.untrustedHtml, 'utf8') > 16 * 1024)) {
        return ignore('incomplete-body');
    }
    const match = /^@coc\s+([\s\S]*\S)\s*$/i.exec(commandText(message));
    if (!match) return ignore('not-command');
    const prompt = match[1].trim();
    return { kind: 'command', prompt };
}
