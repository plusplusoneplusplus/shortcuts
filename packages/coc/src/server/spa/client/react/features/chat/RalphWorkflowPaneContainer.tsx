/**
 * RalphWorkflowPaneContainer — wires the presentational
 * `RalphWorkflowPane` to the `useRalphSessionView` hook plus the host
 * RepoChatTab callbacks (close, iteration → chat detail).
 *
 * Iteration nodes link to a queue process id encoded as
 * `ralph:<sessionId>:<iteration>`; that's the convention used when the
 * bridge enqueues an iteration. Clicking a node calls `onSelectIteration`
 * with that id so the host can switch the chat detail pane.
 *
 * Final-check nodes carry their own recorded `processId`, so the pane's
 * `onSelectFinalCheck` is wired straight to the host `onSelectIteration`
 * (process-id) callback without the iteration→process-id translation.
 */

import type React from 'react';
import { useCallback } from 'react';
import {
    buildRalphContinueRequest,
    buildRalphResumeRequest,
    RalphWorkflowPane,
} from './RalphWorkflowPane';
import { useRalphSessionView } from './useRalphSessionView';
import { getSpaCocClient } from '../../api/cocClient';
import type { ResolvedModalJobAiSelection } from '../../shared/ModalJobAiControls';

export interface RalphWorkflowPaneContainerProps {
    workspaceId: string;
    sessionId: string;
    onClose?: () => void;
    /** Called with the queue process id of the clicked iteration so the
     *  host can swap the right pane to the chat detail view. */
    onSelectIteration?: (processId: string) => void;
    /** Optional file name decoded from a Ralph session deep-link. */
    selectedFileName?: string;
    /** Called when the user selects a session file. */
    onSelectFile?: (fileName: string) => void;
    now?: number;
}

export function RalphWorkflowPaneContainer(
    props: RalphWorkflowPaneContainerProps,
): React.ReactElement {
    const {
        workspaceId,
        sessionId,
        onClose,
        onSelectIteration,
        selectedFileName,
        onSelectFile,
        now,
    } = props;
    const { view, refresh } = useRalphSessionView(workspaceId, sessionId);

    const handleSelectIteration = useCallback(
        (iteration: number) => {
            if (!onSelectIteration) return;
            const rec = view?.record.iterations.find((r) => r.iteration === iteration);
            // Prefer the recorded process id; fall back to the synthesised
            // queue id used by the bridge when the journal entry is missing
            // a processId for any reason.
            const pid = rec?.processId ?? `ralph:${sessionId}:${iteration}`;
            onSelectIteration(pid);
        },
        [onSelectIteration, view, sessionId],
    );

    const handleContinue = useCallback(
        async (additionalIterations: number, aiSelection?: ResolvedModalJobAiSelection) => {
            await getSpaCocClient().workspaces.continueRalphSession(
                workspaceId,
                sessionId,
                buildRalphContinueRequest(additionalIterations, aiSelection),
            );
            refresh();
        },
        [workspaceId, sessionId, refresh],
    );

    const handleNewLoop = useCallback(
        async (newGoal: string, additionalIterations: number) => {
            await getSpaCocClient().workspaces.startNewRalphLoop(workspaceId, sessionId, {
                newGoal,
                additionalIterations,
            });
            refresh();
        },
        [workspaceId, sessionId, refresh],
    );

    const handleResume = useCallback(
        async (aiSelection?: ResolvedModalJobAiSelection) => {
            await getSpaCocClient().workspaces.resumeRalphSession(
                workspaceId,
                sessionId,
                buildRalphResumeRequest(aiSelection),
            );
            refresh();
        },
        [workspaceId, sessionId, refresh],
    );

    return (
        <RalphWorkflowPane
            workspaceId={workspaceId}
            sessionId={sessionId}
            view={view}
            onClose={onClose}
            onSelectIteration={onSelectIteration ? handleSelectIteration : undefined}
            onSelectFinalCheck={onSelectIteration}
            onContinue={handleContinue}
            onNewLoop={handleNewLoop}
            onResume={handleResume}
            selectedFileName={selectedFileName}
            onSelectFile={onSelectFile}
            now={now}
        />
    );
}
