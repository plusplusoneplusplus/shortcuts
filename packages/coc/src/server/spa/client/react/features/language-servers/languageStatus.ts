/**
 * What the editor tells the user about their language server.
 *
 * Two statuses describe one document and neither is complete on its own. The
 * store's status says whether *this* document is synchronized (`detached`,
 * `ready`, `unavailable`); the host's session status says what the *process*
 * is doing (`starting`, `reconnecting`, `failed`, and so on). A document can be
 * detached because the server is still starting, because it crashed, or because
 * the socket dropped, and the user needs those told apart.
 *
 * This module is the one place that reconciles them into a single line of
 * text, a tone, and whether a retry is worth offering. It is pure and free of
 * React so the wording can be pinned by tests without a DOM.
 */

import type { LanguageDocumentSnapshot } from './documentStore';
import type { LanguageServerSessionStateView } from './languageServerClient';

/** Drives the colour of the indicator; not a status in its own right. */
export type LanguageStatusTone = 'ready' | 'pending' | 'warning' | 'error';

export interface LanguageStatusDescription {
    /** Short label for the badge itself. */
    label: string;
    /** The full story, for a tooltip: server, runtime, and any failure detail. */
    title: string;
    tone: LanguageStatusTone;
    /** True when a retry could plausibly change something. */
    canRestart: boolean;
    /** True while a restart or a first start is already under way. */
    busy: boolean;
}

/**
 * A host that refused the document explains itself in `reason`. These are the
 * refusals a retry cannot fix by itself, so the label says what to change.
 */
const UNAVAILABLE_LABELS: Record<string, string> = {
    disabled: 'Language support off',
    'no-definition': 'No language server',
    capacity: 'Language servers busy',
    'invalid-path': 'Language support unavailable',
};

export function describeLanguageStatus(
    snapshot: LanguageDocumentSnapshot | null | undefined,
): LanguageStatusDescription {
    if (!snapshot) {
        return { label: 'Language support off', title: 'Language support is off for this file.', tone: 'warning', canRestart: false, busy: false };
    }

    const state = snapshot.state;
    const name = serverLabel(state, snapshot.displayName);

    if (snapshot.status === 'unavailable') {
        const reason = snapshot.unavailable?.reason ?? '';
        const label = UNAVAILABLE_LABELS[reason] ?? 'Language support unavailable';
        return {
            label,
            title: snapshot.unavailable?.detail || label,
            tone: 'warning',
            // Turning support on, or freeing capacity, happens elsewhere; the
            // retry is what picks the change up, so it stays offered.
            canRestart: true,
            busy: false,
        };
    }

    switch (state?.status) {
        case 'starting':
            return { label: `Starting ${name}…`, title: detailed(`Starting ${name}`, state), tone: 'pending', canRestart: false, busy: true };
        case 'reconnecting':
            return { label: `Restarting ${name}…`, title: detailed(`Restarting ${name}`, state), tone: 'pending', canRestart: false, busy: true };
        case 'unavailable':
            return { label: `${name} not found`, title: detailed(`${name} could not be started`, state), tone: 'error', canRestart: true, busy: false };
        case 'failed':
            return { label: `${name} failed`, title: detailed(`${name} failed`, state), tone: 'error', canRestart: true, busy: false };
        default:
            break;
    }

    if (snapshot.status === 'ready') {
        return { label: name, title: detailed(`${name} is ready`, state), tone: 'ready', canRestart: true, busy: false };
    }

    // Attached to nothing, with no failure reported: the socket is down, the
    // session was replaced, or the process has not been asked for yet. All
    // three resolve themselves, and all three are worth a retry.
    return { label: `${name} connecting…`, title: detailed(`Connecting to ${name}`, state), tone: 'pending', canRestart: true, busy: true };
}

/** The server's own name beats the definition's, because it is the truth. */
function serverLabel(state: LanguageServerSessionStateView | null | undefined, displayName: string | null): string {
    return state?.serverName || state?.displayName || displayName || 'Language server';
}

/**
 * The tooltip. Everything the host chose to report, in the order a user would
 * ask for it, and nothing it did not: `detail` and `runtime` are already
 * scrubbed of host paths and environment values on the way out.
 */
function detailed(headline: string, state: LanguageServerSessionStateView | null | undefined): string {
    const parts = [headline];
    if (state?.serverVersion) {
        parts.push(`Version ${state.serverVersion}`);
    }
    if (state?.runtime) {
        parts.push(state.runtime);
    }
    if (state?.detail) {
        parts.push(state.detail);
    }
    if (typeof state?.restarts === 'number' && state.restarts > 0) {
        parts.push(`${state.restarts} restart${state.restarts === 1 ? '' : 's'}`);
    }
    return parts.join(' · ');
}
