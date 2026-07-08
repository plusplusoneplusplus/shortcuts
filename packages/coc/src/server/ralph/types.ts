/**
 * Compatibility barrel for Ralph session journal types.
 *
 * The portable record contracts live in @plusplusoneplusplus/coc-workflow/ralph;
 * CoC keeps this local path so existing server routes/tests can continue to
 * import the same module while filesystem and queue adapters remain here.
 */

export type {
    ParsedProgressSection,
    RalphExitSignal,
    RalphFinalCheckRecord,
    RalphFinalCheckStatus,
    RalphIterationRecord,
    RalphLoopRecord,
    RalphSessionCompleteReason,
    RalphSessionPhase,
    RalphSessionRecord,
    RalphTerminalReason,
    RalphWorktreeMetadata,
} from '@plusplusoneplusplus/coc-workflow/ralph';
