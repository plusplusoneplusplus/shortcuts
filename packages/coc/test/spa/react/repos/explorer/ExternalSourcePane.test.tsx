// @vitest-environment jsdom
/**
 * The read-only view of a definition outside every workspace.
 *
 * What matters here is what the pane is NOT: it holds no path, reads no file
 * API, and offers nothing that could write. It renders text it was handed, and
 * it keeps that text alive for as long as it is open — which is the whole point,
 * because the attachment that read it is unmounting as this pane appears.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalSourcePane } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExternalSourcePane';
import {
    publishExternalSource,
    readExternalSourceRecord,
    resetExternalSourceStoreForTests,
} from '../../../../../src/server/spa/client/react/features/language-servers/externalSourceStore';

const editors = vi.hoisted(() => ({ mounted: [] as Record<string, unknown>[] }));

vi.mock('../../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: (props: Record<string, unknown>) => {
        editors.mounted.push(props);
        return <textarea data-testid="external-editor" value={String(props.value)} readOnly />;
    },
    getMonacoLanguage: (name: string) => (name.endsWith('.hpp') ? 'cpp' : 'plaintext'),
}));

beforeEach(() => {
    editors.mounted.length = 0;
    resetExternalSourceStoreForTests();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    resetExternalSourceStoreForTests();
});

describe('ExternalSourcePane', () => {
    it('renders the handed-over source read-only at the requested position', () => {
        publishExternalSource({
            resourceId: 'cap-1',
            content: 'namespace std { class string_view; }',
            displayName: 'string_view',
            languageHint: 'cpp',
        });

        render(<ExternalSourcePane resourceId="cap-1" name="string_view" revealLine={42} revealColumn={7} />);

        expect(screen.getByTestId('external-source-badge')).toHaveTextContent('External · Read only');
        expect(editors.mounted.at(-1)).toMatchObject({
            value: 'namespace std { class string_view; }',
            onModelMount: expect.any(Function),
            revealLine: 42,
            revealColumn: 7,
            // No extension on the basename, so the host's hint is what keeps it C++.
            language: 'cpp',
        });
    });

    it('offers no save affordance and never reports dirty state', () => {
        publishExternalSource({ resourceId: 'cap-1', content: 'x', displayName: 'widget.hpp' });

        render(<ExternalSourcePane resourceId="cap-1" name="widget.hpp" />);

        const props = editors.mounted.at(-1)!;
        expect(props.onChange).toBeUndefined();
        expect(props.onSave).toBeUndefined();
        expect(props.onModelMount).toEqual(expect.any(Function));
    });

    it('holds the source alive while it is open and releases it on close', () => {
        publishExternalSource({ resourceId: 'cap-1', content: 'x', displayName: 'widget.hpp' });

        const view = render(<ExternalSourcePane resourceId="cap-1" name="widget.hpp" />);
        vi.advanceTimersByTime(10 * 60_000);
        expect(readExternalSourceRecord('cap-1')).toBeDefined();

        view.unmount();
        vi.advanceTimersByTime(10 * 60_000);
        expect(readExternalSourceRecord('cap-1')).toBeUndefined();
    });

    it('reports an unavailable source rather than an empty editor', () => {
        render(<ExternalSourcePane resourceId="cap-gone" name="string_view" />);

        expect(screen.getByTestId('external-source-unavailable'))
            .toHaveTextContent('Definition source unavailable.');
        expect(editors.mounted).toHaveLength(0);
    });
});
