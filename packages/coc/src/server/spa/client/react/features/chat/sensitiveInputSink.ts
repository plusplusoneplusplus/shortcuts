/**
 * Runs the sink for an ask_user `sensitive-input` question right here in the
 * dashboard. The pasted secret goes to the desktop bridge only; the server
 * and the AI get the redacted receipt this returns.
 */

import type { AskUserResponseRequest } from '@plusplusoneplusplus/coc-client';
import { desktopBrowserBridge } from '../../shared/file-path/browser-bridge';
import type { AskUserQuestion } from './hooks/useChatSSE';

export type SensitiveInputReceipt = NonNullable<AskUserResponseRequest['answers'][number]['receipt']>;

/** True when this dashboard can run the question's sink (CoC desktop with cookie import). */
export function canRunSensitiveInputSink(question: AskUserQuestion): boolean {
    return question.sink === 'browser.cookies' && typeof desktopBrowserBridge()?.importCookies === 'function';
}

export async function runSensitiveInputSink(question: AskUserQuestion, value: string): Promise<SensitiveInputReceipt> {
    const importCookies = desktopBrowserBridge()?.importCookies;
    const domain = question.sinkArgs?.domain;
    if (question.sink !== 'browser.cookies' || !importCookies || !domain) return { ok: false, reason: 'import-failed' };
    try {
        const reply = await importCookies(question.sinkArgs?.viewId ?? null, domain, value);
        // Only the fixed reason code and the count leave this function; the
        // desktop's message can quote parser details, so it is dropped.
        if (reply.ok) return { ok: true, count: reply.count };
        return { ok: false, reason: reply.reason === 'invalid' ? 'invalid-input' : 'import-failed' };
    } catch {
        return { ok: false, reason: 'import-failed' };
    }
}
