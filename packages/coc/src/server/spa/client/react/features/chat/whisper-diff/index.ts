/**
 * Barrel for the transient read-only whisper diff panel (AC-03).
 */
export { WhisperDiffPanel } from './WhisperDiffPanel';
export type { WhisperDiffPanelProps } from './WhisperDiffPanel';
export { WhisperDiffDock } from './WhisperDiffDock';
export type { WhisperDiffDockProps } from './WhisperDiffDock';
export { useWhisperDiffState } from './useWhisperDiffState';
export type { WhisperDiffState, WhisperDiffStatus } from './useWhisperDiffState';
export { useWhisperDiffPanelState } from './useWhisperDiffPanelState';
export type {
    UseWhisperDiffPanelStateOptions,
    UseWhisperDiffPanelStateReturn,
} from './useWhisperDiffPanelState';
export { WHISPER_DIFF_EVENT, dispatchOpenWhisperDiff } from './whisperDiffEvent';
