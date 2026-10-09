import { marked, type Token, type Tokens } from 'marked';
import { chunkWhatsAppText } from '@plusplusoneplusplus/coc-connector/whatsapp';

export function formatLabeledWhatsAppChunks(
    text: string, header: (part: number, total: number) => string,
): string[] {
    let total = 1;
    for (;;) {
        const chunks = chunkWhatsAppText(text, 4096 - header(total, total).length);
        if (!chunks.length) chunks.push('');
        if (chunks.length === total) return chunks.map((chunk, index) => header(index + 1, total) + chunk);
        total = chunks.length;
    }
}

function childrenOf(token: Token): Token[] {
    return 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : [];
}

/** Use WhatsApp's native inline markers, retaining link destinations. */
function renderInline(tokens: Token[]): string {
    return tokens.map(token => {
        switch (token.type) {
            case 'text':
                return childrenOf(token).length ? renderInline(childrenOf(token)) : token.raw;
            case 'escape':
                return token.text;
            case 'strong':
                return `*${renderInline(childrenOf(token))}*`;
            case 'em':
                return `_${renderInline(childrenOf(token))}_`;
            case 'del':
                return `~${renderInline(childrenOf(token))}~`;
            case 'codespan': {
                // marked escapes code text for HTML; WhatsApp needs literal text.
                const text = token.text.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
                return `\`\`\`${text}\`\`\``;
            }
            case 'link': {
                const label = renderInline(childrenOf(token));
                return label === token.href ? label : `${label} (${token.href})`;
            }
            case 'br':
                return '\n';
            default:
                return token.raw;
        }
    }).join('');
}

function renderTable(table: Tokens.Table): string {
    const headers = table.header.map((cell, index) => renderInline(cell.tokens) || `Column ${index + 1}`);
    const value = (cell: Tokens.TableCell) => renderInline(cell.tokens) || '—';
    if (headers.length === 2) {
        // Keep the column names once, then use each first-column value as its key.
        return [headers.join(' → '), ...table.rows.map(row => `${value(row[0])}: ${value(row[1])}`)].join('\n');
    }
    return table.rows.length
        ? table.rows.map(row => row.map((cell, index) => `${headers[index]}: ${value(cell)}`).join('\n')).join('\n\n')
        : headers.join(' · ');
}

/** Convert GFM tables before delivery/chunking; leave other Markdown intact. */
export function formatWhatsAppAnswer(markdown: string): string {
    const tokens = marked.lexer(markdown, { gfm: true });
    if (!tokens.some(token => token.type === 'table')) {
        return markdown;
    }
    // Match lexer raw text against normalized source so skipped link definitions
    // and surrounding prose remain intact rather than being re-rendered.
    const source = markdown.replace(/\r\n|\r/g, '\n');
    let scanned = 0;
    let copied = 0;
    let result = '';
    for (const token of tokens) {
        const start = source.indexOf(token.raw, scanned);
        if (start < 0) {
            return markdown;
        }
        scanned = start + token.raw.length;
        if (token.type !== 'table') {
            continue;
        }
        result += source.slice(copied, start) + renderTable(token as Tokens.Table)
            + (token.raw.match(/\n*$/)?.[0] ?? '');
        copied = scanned;
    }
    return result + source.slice(copied);
}
