/**
 * Tests for JsonResponseView component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// Mock the @uiw/react-json-view library
vi.mock('@uiw/react-json-view', () => ({
    default: ({ value, collapsed, enableClipboard, displayDataTypes }: any) => (
        <div
            data-testid="uiw-json-view"
            data-collapsed={collapsed}
            data-clipboard={enableClipboard}
            data-datatypes={displayDataTypes}
        >
            {JSON.stringify(value)}
        </div>
    ),
}));

vi.mock('@uiw/react-json-view/dark', () => ({
    darkTheme: { backgroundColor: '#1e1e1e' },
}));

vi.mock('@uiw/react-json-view/light', () => ({
    lightTheme: { backgroundColor: '#ffffff' },
}));

import { JsonResponseView } from '../../../src/server/spa/client/react/processes/JsonResponseView';

describe('JsonResponseView', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the JSON viewer with parsed content', () => {
        const { container } = render(<JsonResponseView content='{"name": "test", "count": 5}' />);
        const viewer = container.querySelector('[data-testid="uiw-json-view"]');
        expect(viewer).toBeTruthy();
        expect(viewer!.textContent).toContain('"name"');
        expect(viewer!.textContent).toContain('"test"');
    });

    it('renders with collapsed depth of 3', () => {
        const { container } = render(<JsonResponseView content='{"a": 1}' />);
        const viewer = container.querySelector('[data-testid="uiw-json-view"]');
        expect(viewer!.getAttribute('data-collapsed')).toBe('3');
    });

    it('enables clipboard support', () => {
        const { container } = render(<JsonResponseView content='{"a": 1}' />);
        const viewer = container.querySelector('[data-testid="uiw-json-view"]');
        expect(viewer!.getAttribute('data-clipboard')).toBe('true');
    });

    it('disables data type display', () => {
        const { container } = render(<JsonResponseView content='{"a": 1}' />);
        const viewer = container.querySelector('[data-testid="uiw-json-view"]');
        expect(viewer!.getAttribute('data-datatypes')).toBe('false');
    });

    it('renders an array', () => {
        const { container } = render(<JsonResponseView content='[1, 2, 3]' />);
        const viewer = container.querySelector('[data-testid="uiw-json-view"]');
        expect(viewer).toBeTruthy();
        expect(viewer!.textContent).toContain('[1,2,3]');
    });

    it('has the json-response-view class', () => {
        const { container } = render(<JsonResponseView content='{"a": 1}' />);
        expect(container.querySelector('.json-response-view')).toBeTruthy();
    });

    it('renders nothing for invalid JSON', () => {
        const { container } = render(<JsonResponseView content='not json' />);
        expect(container.querySelector('[data-testid="uiw-json-view"]')).toBeNull();
    });

    it('handles JSON with leading and trailing whitespace', () => {
        const { container } = render(<JsonResponseView content={'  {"key": "value"}  '} />);
        const viewer = container.querySelector('[data-testid="uiw-json-view"]');
        expect(viewer).toBeTruthy();
    });

    it('applies dark theme when dark class is on html element', () => {
        document.documentElement.classList.add('dark');
        try {
            const { container } = render(<JsonResponseView content='{"a": 1}' />);
            expect(container.querySelector('[data-testid="uiw-json-view"]')).toBeTruthy();
        } finally {
            document.documentElement.classList.remove('dark');
        }
    });
});
