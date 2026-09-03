import { describe, expect, it } from 'vitest';
import { extractInjectedBlocks } from '../../../src/server/spa/client/react/features/chat/conversation/injectedBlocks';

const CHAT_STYLE_BLOCK = [
    '<chat-style>',
    'Selected style: Structured.',
    'Focus on clear sections.',
    '</chat-style>',
].join('\n');

const CHAT_MODE_BLOCK = [
    '<coc-chat-mode>',
    'Current mode: ask.',
    '</coc-chat-mode>',
].join('\n');

describe('extractInjectedBlocks', () => {
    it('extracts both supported blocks and trims blank lines before the message', () => {
        const message = 'Keep **my words** intact.';

        expect(extractInjectedBlocks(`${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}\n\n\n${message}`)).toEqual({
            text: message,
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('extracts only a leading chat style block', () => {
        expect(extractInjectedBlocks(`${CHAT_STYLE_BLOCK}\n\nExplain the change.`)).toEqual({
            text: 'Explain the change.',
            chatStyle: CHAT_STYLE_BLOCK,
        });
    });

    it('extracts only a leading chat mode block', () => {
        expect(extractInjectedBlocks(`${CHAT_MODE_BLOCK}\r\n\r\nExplain the change.`)).toEqual({
            text: 'Explain the change.',
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('returns text without supported blocks byte-for-byte', () => {
        const text = '\n  Ordinary text with trailing whitespace.  \n';

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('extracts the blocks in reversed order', () => {
        expect(extractInjectedBlocks(`${CHAT_MODE_BLOCK}\n\n${CHAT_STYLE_BLOCK}\n\nProceed.`)).toEqual({
            text: 'Proceed.',
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('does not strip a supported block that appears mid-message', () => {
        const text = `Here is a quoted block:\n\n${CHAT_STYLE_BLOCK}`;

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('leaves an unterminated leading block unchanged', () => {
        const text = '<chat-style>\nSelected style: Direct.\nExplain the change.';

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });

    it('returns an empty message when the text contains only supported blocks', () => {
        expect(extractInjectedBlocks(`${CHAT_STYLE_BLOCK}\n\n${CHAT_MODE_BLOCK}`)).toEqual({
            text: '',
            chatStyle: CHAT_STYLE_BLOCK,
            chatMode: CHAT_MODE_BLOCK,
        });
    });

    it('does not skip an unsupported injected block to find a supported one', () => {
        const text = `<selected_skills>\n- example\n</selected_skills>\n\n${CHAT_MODE_BLOCK}\n\nProceed.`;

        expect(extractInjectedBlocks(text)).toEqual({ text });
    });
});
