import { describe, expect, it } from 'vitest';
import { buildChatPopOutUrl } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatWindowActions';

describe('buildChatPopOutUrl', () => {
    it('builds the local chat pop-out URL without a clone base', () => {
        expect(buildChatPopOutUrl('http://localhost:3000/', 'proc-1', 'ws1'))
            .toBe('http://localhost:3000/?workspace=ws1#popout/activity/proc-1');
    });

    it('includes cloneBaseUrl for remote chat pop-outs', () => {
        expect(buildChatPopOutUrl(
            'http://localhost:3000/',
            'proc/1',
            'remote-ws',
            'http://127.0.0.1:4000'
        )).toBe('http://localhost:3000/?workspace=remote-ws&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000#popout/activity/proc%2F1');
    });

    it('omits the query string when no workspace is known', () => {
        expect(buildChatPopOutUrl('http://localhost:3000/', 'proc-1'))
            .toBe('http://localhost:3000/#popout/activity/proc-1');
    });
});
