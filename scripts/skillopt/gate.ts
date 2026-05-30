/**
 * AC-06: Held-out validation gate.
 *
 * Scores a candidate skill on the selection (held-out) split.
 * Accepts the candidate if and only if it strictly improves over the current best.
 *
 * The running best is tracked externally (in loop.ts) so that this module
 * is a pure gate function suitable for unit testing.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GateResult {
    accepted: boolean;
    candidateScore: number;
    bestScore: number;
    /** Human-readable decision note. */
    note: string;
}

// ─── Gate function ────────────────────────────────────────────────────────────

/**
 * Returns true iff candidateScore strictly exceeds currentBestScore.
 *
 * @param candidateScore  Average score of the candidate skill on the selection split.
 * @param currentBestScore  Score of the current best skill on the selection split.
 */
export function shouldAccept(candidateScore: number, currentBestScore: number): boolean {
    return candidateScore > currentBestScore;
}

/**
 * Evaluates whether the candidate skill should replace the current best.
 * Records the decision with scores for history logging.
 */
export function evaluateGate(
    candidateScore: number,
    currentBestScore: number
): GateResult {
    const accepted = shouldAccept(candidateScore, currentBestScore);
    const note = accepted
        ? `Accepted: ${candidateScore.toFixed(4)} > ${currentBestScore.toFixed(4)}`
        : `Rejected: ${candidateScore.toFixed(4)} ≤ ${currentBestScore.toFixed(4)}`;

    return { accepted, candidateScore, bestScore: currentBestScore, note };
}
