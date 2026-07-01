/**
 * Tests for the redesigned QueuedFollowUps section.
 *
 * Visual contract (per OpenDesign reference `coc-conversation-redesign-3.html`):
 *   - Section is rendered with a left-indent that aligns with the assistant
 *     avatar gutter (`ml-9`) and a "Queued · N" mono uppercase label.
 *   - Each queued message is a single-line dashed-border surface card.
 *   - Each card single-line truncates the message content (no line-clamp 2).
 *   - When `onCancel` is provided, each card renders a ✕ cancel button that
 *     forwards the message id to `onCancel` on click.
 *   - When `onCancel` is omitted, no cancel button is rendered.
 *   - Empty queue renders nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QueuedFollowUps, QueuedBubble } from '../../../src/server/spa/client/react/features/chat/QueuedBubble';
import type { QueuedMessage } from '../../../src/server/spa/client/react/utils/chatUtils';

function makeMsg(overrides: Partial<QueuedMessage> = {}): QueuedMessage {
    return {
        id: 'msg-1',
        content: 'Then run the e2e test for queue-conversation.spec.ts and paste failures.',
        status: 'queued',
        ...overrides,
    };
}

describe('QueuedFollowUps — redesign', () => {
    it('renders nothing when the queue is empty', () => {
        const { container } = render(<QueuedFollowUps queue={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the "Queued · N" mono uppercase label', () => {
        const { getByTestId } = render(
            <QueuedFollowUps queue={[makeMsg({ id: 'a' }), makeMsg({ id: 'b' })]} />,
        );
        const label = getByTestId('queued-label');
        expect(label.textContent).toBe('Queued · 2');
        expect(label.className).toContain('font-mono');
        expect(label.className).toContain('uppercase');
    });

    it('left-indents the section to align with the assistant avatar gutter', () => {
        const { getByTestId } = render(<QueuedFollowUps queue={[makeMsg()]} />);
        const section = getByTestId('queued-followups');
        expect(section.tagName.toLowerCase()).toBe('section');
        expect(section.className).toContain('ml-9');
    });

    it('renders one dashed-border surface card per queued message', () => {
        const { container } = render(
            <QueuedFollowUps queue={[
                makeMsg({ id: 'a', content: 'First task' }),
                makeMsg({ id: 'b', content: 'Second task' }),
            ]} />,
        );
        const items = container.querySelectorAll('[data-testid="queued-item"]');
        expect(items.length).toBe(2);
        items.forEach(item => {
            expect(item.className).toContain('border-dashed');
            expect(item.className).toContain('rounded');
            expect(item.className).toContain('text-[12.5px]');
        });
    });

    it('truncates message content on a single line', () => {
        const long = 'a'.repeat(400);
        const { getByTestId } = render(<QueuedFollowUps queue={[makeMsg({ content: long })]} />);
        const text = getByTestId('queued-item-text');
        expect(text.className).toContain('truncate');
        expect(text.className).toContain('flex-1');
        expect(text.className).toContain('min-w-0');
        expect(text.textContent).toBe(long);
        expect(text.getAttribute('title')).toBe(long);
    });

    it('does not include the legacy clock emoji', () => {
        const { container } = render(<QueuedFollowUps queue={[makeMsg()]} />);
        expect(container.textContent).not.toContain('🕐');
    });

    it('forwards the queued status to a data-status attribute', () => {
        const { container } = render(
            <QueuedFollowUps queue={[
                makeMsg({ id: 'a', status: 'queued' }),
                makeMsg({ id: 'b', status: 'steering' }),
            ]} />,
        );
        const items = container.querySelectorAll('[data-testid="queued-item"]');
        expect(items[0].getAttribute('data-status')).toBe('queued');
        expect(items[1].getAttribute('data-status')).toBe('steering');
    });

    it('omits the cancel button when no onCancel handler is provided', () => {
        const { container } = render(<QueuedFollowUps queue={[makeMsg()]} />);
        expect(container.querySelector('[data-testid="queued-item-cancel"]')).toBeNull();
    });

    it('renders one ✕ cancel button per item when onCancel is provided', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <QueuedFollowUps queue={[makeMsg({ id: 'a' }), makeMsg({ id: 'b' })]} onCancel={onCancel} />,
        );
        const buttons = container.querySelectorAll('[data-testid="queued-item-cancel"]');
        expect(buttons.length).toBe(2);
        buttons.forEach(btn => {
            expect(btn.tagName.toLowerCase()).toBe('button');
            expect(btn.getAttribute('aria-label')).toBe('Cancel queued message');
            expect(btn.textContent?.trim()).toBe('✕');
            expect(btn.className).toContain('hover:bg-[#ffebe9]');
            expect(btn.className).toContain('hover:text-[#cf222e]');
        });
    });

    it('invokes onCancel with the clicked message id', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <QueuedFollowUps queue={[
                makeMsg({ id: 'msg-1', content: 'First' }),
                makeMsg({ id: 'msg-2', content: 'Second' }),
            ]} onCancel={onCancel} />,
        );
        const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="queued-item-cancel"]');
        fireEvent.click(buttons[1]);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledWith('msg-2');
    });

    it('stops click propagation so cancel does not trigger parent click handlers', () => {
        const onCancel = vi.fn();
        const onParentClick = vi.fn();
        const { container } = render(
            <div onClick={onParentClick}>
                <QueuedFollowUps queue={[makeMsg()]} onCancel={onCancel} />
            </div>,
        );
        const btn = container.querySelector<HTMLButtonElement>('[data-testid="queued-item-cancel"]');
        fireEvent.click(btn!);
        expect(onCancel).toHaveBeenCalled();
        expect(onParentClick).not.toHaveBeenCalled();
    });

    it('exposes an accessible role/listitem structure for the queued items', () => {
        const { container, getByLabelText } = render(
            <QueuedFollowUps queue={[makeMsg({ id: 'a' }), makeMsg({ id: 'b' })]} />,
        );
        expect(getByLabelText('Queued follow-up messages')).toBeTruthy();
        expect(container.querySelectorAll('[role="list"]').length).toBe(1);
        expect(container.querySelectorAll('[role="listitem"]').length).toBe(2);
    });
});

describe('QueuedFollowUps — queued image attachments', () => {
    const IMG_A = 'data:image/png;base64,AAA';
    const IMG_B = 'data:image/jpeg;base64,BBB';

    it('renders an ImageGallery of thumbnails when the queued message has images', () => {
        const { getByTestId, getAllByTestId } = render(
            <QueuedFollowUps queue={[makeMsg({ images: [IMG_A, IMG_B] })]} />,
        );
        expect(getByTestId('image-gallery')).toBeTruthy();
        const items = getAllByTestId('image-gallery-item');
        expect(items.length).toBe(2);
        const imgs = getByTestId('queued-item').querySelectorAll('img');
        expect(imgs[0].getAttribute('src')).toBe(IMG_A);
        expect(imgs[1].getAttribute('src')).toBe(IMG_B);
    });

    it('renders no gallery when the queued message has no images', () => {
        const { container } = render(<QueuedFollowUps queue={[makeMsg()]} />);
        expect(container.querySelector('[data-testid="image-gallery"]')).toBeNull();
    });

    it('renders no gallery when images is an empty array (no layout shift)', () => {
        const { container } = render(<QueuedFollowUps queue={[makeMsg({ images: [] })]} />);
        expect(container.querySelector('[data-testid="image-gallery"]')).toBeNull();
    });

    it('lays the item out as a column so the gallery sits below the text/✕ row', () => {
        const { getByTestId } = render(<QueuedFollowUps queue={[makeMsg({ images: [IMG_A] })]} />);
        const item = getByTestId('queued-item');
        expect(item.className).toContain('flex-col');
    });

    it('keeps the ✕ cancel working when images are present', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <QueuedFollowUps queue={[makeMsg({ id: 'img-msg', images: [IMG_A] })]} onCancel={onCancel} />,
        );
        const btn = container.querySelector<HTMLButtonElement>('[data-testid="queued-item-cancel"]');
        expect(btn).not.toBeNull();
        fireEvent.click(btn!);
        expect(onCancel).toHaveBeenCalledWith('img-msg');
    });
});

describe('QueuedBubble — deprecated wrapper', () => {
    it('still renders a single queued item with no clock emoji', () => {
        const { container } = render(<QueuedBubble msg={makeMsg({ content: 'legacy single' })} />);
        const item = container.querySelector('[data-testid="queued-item"]');
        expect(item).not.toBeNull();
        expect(item?.textContent).toContain('legacy single');
        expect(item?.textContent).not.toContain('🕐');
    });

    it('forwards onCancel to the underlying item', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <QueuedBubble msg={makeMsg({ id: 'wrapper-1' })} onCancel={onCancel} />,
        );
        const btn = container.querySelector<HTMLButtonElement>('[data-testid="queued-item-cancel"]');
        expect(btn).not.toBeNull();
        fireEvent.click(btn!);
        expect(onCancel).toHaveBeenCalledWith('wrapper-1');
    });
});
