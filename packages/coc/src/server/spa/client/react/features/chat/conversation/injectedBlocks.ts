export interface ExtractedInjectedBlocks {
    text: string;
    chatStyle?: string;
    chatMode?: string;
}

function trimLeadingBlankLines(text: string): string {
    return text.replace(/^(?:[\t ]*(?:\r\n|\n|\r))+/, '');
}

/**
 * Removes the server-injected chat style and mode blocks from the leading
 * prefix of display text while retaining each complete block verbatim.
 */
export function extractInjectedBlocks(text: string): ExtractedInjectedBlocks {
    let remaining = text;
    let chatStyle: string | undefined;
    let chatMode: string | undefined;

    for (let blockCount = 0; blockCount < 2; blockCount += 1) {
        const tag = chatStyle === undefined && remaining.startsWith('<chat-style>')
            ? 'chat-style'
            : chatMode === undefined && remaining.startsWith('<coc-chat-mode>')
                ? 'coc-chat-mode'
                : undefined;

        if (tag === undefined) {
            break;
        }

        const closingTag = `</${tag}>`;
        const closingTagStart = remaining.indexOf(closingTag, tag.length + 2);
        if (closingTagStart < 0) {
            break;
        }

        const blockEnd = closingTagStart + closingTag.length;
        const block = remaining.slice(0, blockEnd);
        if (tag === 'chat-style') {
            chatStyle = block;
        } else {
            chatMode = block;
        }

        remaining = trimLeadingBlankLines(remaining.slice(blockEnd));
    }

    const result: ExtractedInjectedBlocks = { text: remaining };
    if (chatStyle !== undefined) {
        result.chatStyle = chatStyle;
    }
    if (chatMode !== undefined) {
        result.chatMode = chatMode;
    }
    return result;
}
