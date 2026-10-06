import { describe, expect, it } from 'vitest';
import { chunkWhatsAppText } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { formatWhatsAppAnswer } from '../../../src/server/messaging/whatsapp-answer-format';

describe('WhatsApp Markdown tables', () => {
    it('renders two-column key/value tables with their column names', () => {
        expect(formatWhatsAppAnswer('| Setting | Value |\n| :--- | ---: |\n| Mode | Auto |\n| Retries | 3 |'))
            .toBe('Setting → Value\nMode: Auto\nRetries: 3');
    });

    it('labels every cell in wider tables and separates rows', () => {
        expect(formatWhatsAppAnswer('Name | Status | Owner\n--- | :---: | ---:\nAPI | Ready | Ada\nUI | Pending | Ben'))
            .toBe('Name: API\nStatus: Ready\nOwner: Ada\n\nName: UI\nStatus: Pending\nOwner: Ben');
    });

    it('keeps surrounding prose and multiple tables separate', () => {
        const table = '| Key | Value |\n| --- | --- |\n| A | B |';
        expect(formatWhatsAppAnswer(`Before **bold**.\n\n${table}\n\nBetween.\n\n${table}\n\nAfter.`))
            .toBe('Before **bold**.\n\nKey → Value\nA: B\n\nBetween.\n\nKey → Value\nA: B\n\nAfter.');
    });

    it('uses native inline formatting in headers and cells without losing links', () => {
        expect(formatWhatsAppAnswer('| **Key** | *Value* |\n| --- | --- |\n| **Mode** | *auto* ~~old~~ `new` [Docs](https://example.com) |'))
            .toBe('*Key* → _Value_\n*Mode*: _auto_ ~old~ ```new``` Docs (https://example.com)');
    });

    it('keeps reference definitions and uses the parser to resolve cell links', () => {
        const text = '[docs]: https://example.com\n\n| Key | Value |\n| --- | --- |\n| Site | [Docs][docs] |';
        expect(formatWhatsAppAnswer(text))
            .toBe('[docs]: https://example.com\n\nKey → Value\nSite: Docs (https://example.com)');
    });

    it('handles CRLF tables and preserves non-table messages exactly', () => {
        expect(formatWhatsAppAnswer('| Key | Value |\r\n| --- | --- |\r\n| A | B |')).toBe('Key → Value\nA: B');
        const prose = '[docs]: https://example.com\r\n\r\nSee [Docs][docs].';
        expect(formatWhatsAppAnswer(prose)).toBe(prose);
    });

    it('preserves escaped pipes, including pipes inside inline code', () => {
        expect(formatWhatsAppAnswer('| Key | Value |\n| --- | --- |\n| A \\| B | `x \\| y` |'))
            .toBe('Key → Value\nA | B: ```x | y```');
    });

    it('keeps inline code literal, including HTML characters and entities', () => {
        expect(formatWhatsAppAnswer('| Key | Value |\n| --- | --- |\n| Code | `a & b <c> &lt;` |'))
            .toBe('Key → Value\nCode: ```a & b <c> &lt;```');
    });

    it.each(['```markdown', '~~~~', '````'])('leaves tables inside %s fences intact', fence => {
        const close = fence.match(/^[`~]+/)![0];
        const code = `${fence}\n| Key | Value |\n| --- | --- |\n| A | B |\n${close}`;
        expect(formatWhatsAppAnswer(`${code}\n\n| Key | Value |\n| --- | --- |\n| C | D |`))
            .toBe(`${code}\n\nKey → Value\nC: D`);
    });

    it('keeps indented code and pipe prose intact', () => {
        const text = 'A | B\n\n    | Key | Value |\n    | --- | --- |\n    | A | B |';
        expect(formatWhatsAppAnswer(text)).toBe(text);
    });

    it('retains empty and missing cells with labels for unnamed columns', () => {
        expect(formatWhatsAppAnswer('| Name | | Status |\n| --- | --- | --- |\n| API | | |\n| UI | Ada |'))
            .toBe('Name: API\nColumn 2: —\nStatus: —\n\nName: UI\nColumn 2: Ada\nStatus: —');
        expect(formatWhatsAppAnswer('| Key | Value |\n| --- | --- |\n| | |')).toBe('Key → Value\n—: —');
    });

    it('preserves parser semantics for mismatched alignment and extra cells', () => {
        const invalid = '| A | B |\n| --- |\n| x | y |';
        expect(formatWhatsAppAnswer(invalid)).toBe(invalid);
        expect(formatWhatsAppAnswer('| A | B |\n| --- | --- |\n| x | y | ignored |')).toBe('A → B\nx: y');
    });

    it('keeps headers of tables without body rows', () => {
        expect(formatWhatsAppAnswer('| A | B | C |\n| --- | --- | --- |')).toBe('A · B · C');
    });

    it('splits converted text losslessly within the message limit', () => {
        const rows = Array.from({ length: 150 }, (_, i) => `| ${i} | ready | ${'owner '.repeat(8)}😀 |`);
        const text = formatWhatsAppAnswer(`Name | Status | Owner\n--- | --- | ---\n${rows.join('\n')}`);
        const parts = chunkWhatsAppText(text);
        expect(parts.length).toBeGreaterThan(1);
        expect(parts.every(part => part.length <= 4096)).toBe(true);
        expect(parts.join('')).toBe(text);
        expect(text).toContain('Name: 149\nStatus: ready\nOwner:');
        expect(text).not.toContain('|');
    });
});
