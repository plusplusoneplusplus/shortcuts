/**
 * Tests for CommentHighlight — buildTextRange, wrapRangeInMark, and component behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import {
    CommentHighlight,
    buildTextRange,
    wrapRangeInMark,
} from '../../../../src/server/spa/client/react/tasks/comments/CommentHighlight';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        taskId: 'task1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello world',
        comment: 'test comment',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

// ── buildTextRange ──

describe('buildTextRange', () => {
    it('returns a Range for text within a single text node', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world, this is a test.';
        const range = buildTextRange(div, 'world');
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe('world');
    });

    it('returns a Range spanning multiple text nodes', () => {
        const div = document.createElement('div');
        const span1 = document.createElement('span');
        span1.textContent = 'Hello ';
        const span2 = document.createElement('span');
        span2.textContent = 'world';
        div.appendChild(span1);
        div.appendChild(span2);

        const range = buildTextRange(div, 'lo world');
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe('lo world');
    });

    it('returns null when the text is not found', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        expect(buildTextRange(div, 'missing')).toBeNull();
    });

    it('returns null for an empty container', () => {
        const div = document.createElement('div');
        expect(buildTextRange(div, 'anything')).toBeNull();
    });

    it('handles text that spans across element boundaries (full line)', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p>First line</p><p>Second line</p>';
        const range = buildTextRange(div, 'First line');
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe('First line');
    });

    it('finds the first occurrence when text appears multiple times', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p>test</p><p>test</p>';
        const range = buildTextRange(div, 'test');
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe('test');
    });
});

// ── wrapRangeInMark ──

describe('wrapRangeInMark', () => {
    it('wraps a simple single-node range with surroundContents', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        const range = document.createRange();
        range.setStart(div.firstChild!, 6);
        range.setEnd(div.firstChild!, 11);

        const mark = wrapRangeInMark(range, { 'data-comment-id': 'c1', class: 'highlight' });
        expect(mark).not.toBeNull();
        expect(mark!.tagName).toBe('MARK');
        expect(mark!.textContent).toBe('world');
        expect(mark!.getAttribute('data-comment-id')).toBe('c1');
        expect(div.querySelector('mark')).toBe(mark);
    });

    it('falls back to extractContents when range crosses element boundaries', () => {
        const div = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = 'bold ';
        const text = document.createTextNode('plain');
        div.appendChild(b);
        div.appendChild(text);

        const range = document.createRange();
        range.setStart(b.firstChild!, 2);
        range.setEnd(text, 3);

        const mark = wrapRangeInMark(range, { 'data-comment-id': 'c2' });
        expect(mark).not.toBeNull();
        expect(mark!.tagName).toBe('MARK');
        expect(mark!.textContent).toBe('ld pla');
    });

    it('sets all provided attributes on the mark element', () => {
        const div = document.createElement('div');
        div.textContent = 'test';
        const range = document.createRange();
        range.setStart(div.firstChild!, 0);
        range.setEnd(div.firstChild!, 4);

        const mark = wrapRangeInMark(range, {
            'data-comment-id': 'c3',
            'class': 'my-class',
            'role': 'mark',
            'aria-label': 'Commented text',
        });
        expect(mark).not.toBeNull();
        expect(mark!.getAttribute('role')).toBe('mark');
        expect(mark!.getAttribute('aria-label')).toBe('Commented text');
        expect(mark!.className).toBe('my-class');
    });
});

// ── CommentHighlight component ──

describe('CommentHighlight', () => {
    it('injects <mark> for an open comment with matching text', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world, this is a test.';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        render(
            <CommentHighlight
                comments={[makeComment({ selectedText: 'world' })]}
                containerRef={ref}
                onCommentClick={vi.fn()}
            />,
        );

        const mark = div.querySelector('mark[data-comment-id="c1"]');
        expect(mark).not.toBeNull();
        expect(mark!.textContent).toBe('world');

        document.body.removeChild(div);
    });

    it('does not inject <mark> for resolved comments', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        render(
            <CommentHighlight
                comments={[makeComment({ status: 'resolved', selectedText: 'world' })]}
                containerRef={ref}
                onCommentClick={vi.fn()}
            />,
        );

        expect(div.querySelector('mark')).toBeNull();

        document.body.removeChild(div);
    });

    it('handles full-line selection that crosses element boundaries', () => {
        const div = document.createElement('div');
        div.innerHTML = '<p><strong>Tests</strong> only check <code>toHaveBeenCalled()</code></p>';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        const selectedText = 'Tests only check toHaveBeenCalled()';

        render(
            <CommentHighlight
                comments={[makeComment({ selectedText })]}
                containerRef={ref}
                onCommentClick={vi.fn()}
            />,
        );

        const mark = div.querySelector('mark[data-comment-id="c1"]');
        expect(mark).not.toBeNull();
        expect(mark!.textContent).toBe(selectedText);

        document.body.removeChild(div);
    });

    it('handles selection spanning multiple sibling elements', () => {
        const div = document.createElement('div');
        div.innerHTML = '<span>Hello </span><em>beautiful</em><span> world</span>';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        render(
            <CommentHighlight
                comments={[makeComment({ selectedText: 'Hello beautiful world' })]}
                containerRef={ref}
                onCommentClick={vi.fn()}
            />,
        );

        const mark = div.querySelector('mark[data-comment-id="c1"]');
        expect(mark).not.toBeNull();
        expect(mark!.textContent).toBe('Hello beautiful world');

        document.body.removeChild(div);
    });

    it('fires onCommentClick when a <mark> is clicked', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        const onClick = vi.fn();
        const comment = makeComment({ selectedText: 'world' });

        render(
            <CommentHighlight
                comments={[comment]}
                containerRef={ref}
                onCommentClick={onClick}
            />,
        );

        const mark = div.querySelector('mark[data-comment-id="c1"]');
        expect(mark).not.toBeNull();
        mark!.click();
        expect(onClick).toHaveBeenCalledWith(comment);

        document.body.removeChild(div);
    });

    it('does not fire onCommentClick for clicks outside <mark>', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        const onClick = vi.fn();

        render(
            <CommentHighlight
                comments={[makeComment({ selectedText: 'world' })]}
                containerRef={ref}
                onCommentClick={onClick}
            />,
        );

        div.click();
        expect(onClick).not.toHaveBeenCalled();

        document.body.removeChild(div);
    });

    it('clears old highlights before re-applying', () => {
        const div = document.createElement('div');
        div.textContent = 'Hello world';
        document.body.appendChild(div);

        const ref = createRef<HTMLDivElement>();
        (ref as any).current = div;

        const { rerender } = render(
            <CommentHighlight
                comments={[makeComment({ selectedText: 'Hello' })]}
                containerRef={ref}
                onCommentClick={vi.fn()}
            />,
        );

        expect(div.querySelectorAll('mark').length).toBe(1);
        expect(div.querySelector('mark')!.textContent).toBe('Hello');

        rerender(
            <CommentHighlight
                comments={[makeComment({ id: 'c2', selectedText: 'world' })]}
                containerRef={ref}
                onCommentClick={vi.fn()}
            />,
        );

        expect(div.querySelectorAll('mark').length).toBe(1);
        expect(div.querySelector('mark')!.textContent).toBe('world');
        expect(div.querySelector('mark')!.getAttribute('data-comment-id')).toBe('c2');

        document.body.removeChild(div);
    });
});
