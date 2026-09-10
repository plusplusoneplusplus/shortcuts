import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { InjectedBlockChips } from '../../../src/server/spa/client/react/features/chat/conversation/InjectedBlockChips';

const READ_ONLY_DIRECTIVE = [
    '<coc-chat-mode>',
    '<coc-read-only-mode>',
    'You are in read-only mode.',
    '</coc-read-only-mode>',
    '</coc-chat-mode>',
].join('\n');

const AUTOPILOT_DIRECTIVE = [
    '<coc-chat-mode>',
    'This chat has been switched to autopilot mode. The read-only restriction stated earlier no longer applies.',
    '</coc-chat-mode>',
].join('\n');

function labels(container: HTMLElement): string[] {
    return Array.from(container.querySelectorAll('[data-testid="injected-block-chip"]'))
        .map(chip => chip.textContent);
}

describe('InjectedBlockChips', () => {
    it('renders nothing when no block is present', () => {
        const { container } = render(<InjectedBlockChips />);

        expect(container.innerHTML).toBe('');
    });

    it('names the mode chip off the read-only marker', () => {
        const { container } = render(<InjectedBlockChips chatMode={READ_ONLY_DIRECTIVE} />);

        expect(labels(container)).toEqual(['Ask']);
    });

    it('names the mode chip off the autopilot transition note', () => {
        const { container } = render(<InjectedBlockChips chatMode={AUTOPILOT_DIRECTIVE} />);

        expect(labels(container)).toEqual(['Autopilot']);
    });

    it('falls back to a generic mode label for an unrecognised directive', () => {
        const { container } = render(
            <InjectedBlockChips chatMode={'<coc-chat-mode>\nsomething new\n</coc-chat-mode>'} />,
        );

        expect(labels(container)).toEqual(['Chat mode']);
    });

    it('names the style chip off the selected style line', () => {
        const block = '<chat-style>\nSelected style: Direct.\nBe brief.\n</chat-style>';
        const { container } = render(<InjectedBlockChips chatStyle={block} />);

        expect(labels(container)).toEqual(['Direct']);
    });

    it('falls back to a generic skills chip when the names did not parse', () => {
        const block = '<selected_skills>\nUnrecognised wording.\n</selected_skills>';
        const { container, getByTestId } = render(<InjectedBlockChips selectedSkills={block} />);

        expect(labels(container)).toEqual(['Selected skills']);
        fireEvent.click(container.querySelector('[data-testid="injected-block-chip"]') as HTMLButtonElement);
        expect(getByTestId('injected-block-body').textContent).toBe(block);
    });

    it('keeps the panel scrollable rather than letting a long block grow the bubble', () => {
        const block = `<selected_skills>\n${'line\n'.repeat(200)}</selected_skills>`;
        const { container, getByTestId } = render(
            <InjectedBlockChips selectedSkills={block} skillNames={['impl']} />,
        );

        fireEvent.click(container.querySelector('[data-chip-id="skill:impl"]') as HTMLButtonElement);
        const body = getByTestId('injected-block-body');
        expect(body.className).toContain('max-h-[16rem]');
        expect(body.className).toContain('overflow-auto');
        expect(body.textContent).toBe(block);
    });
});
