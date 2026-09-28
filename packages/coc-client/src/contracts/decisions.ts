/**
 * Decision API contracts (`POST /api/workspaces/:workspaceId/decisions/evaluate`).
 *
 * Question and answer naming (`noul`, `choice`, `score`, `probabilities`,
 * `legend`, `confidence`) follows TypeSafe so a future TypeSafe backend does
 * not change callers.
 */

export type DecisionJsonValue =
  | string
  | number
  | boolean
  | null
  | DecisionJsonValue[]
  | { [key: string]: DecisionJsonValue };

export const DECISION_BACKENDS = ['copilot', 'typesafe'] as const;
export type DecisionBackendName = typeof DECISION_BACKENDS[number];

export const DECISION_QUESTION_TYPES = ['noul', 'choice', 'score'] as const;
export type DecisionQuestionType = typeof DECISION_QUESTION_TYPES[number];

/** Yes/no question answered with a value in `[0, 1]`. */
export interface NoulDecisionQuestion {
  type: 'noul';
  instructions: DecisionJsonValue;
  criteria?: {
    true?: DecisionJsonValue;
    false?: DecisionJsonValue;
  };
}

/** Pick one option; `criteria` keys are the option values. */
export interface ChoiceDecisionQuestion {
  type: 'choice';
  instructions: DecisionJsonValue;
  criteria: Record<string, DecisionJsonValue | null>;
}

/** Ordered levels; the answer's `score` is the probability-weighted level index. */
export interface ScoreDecisionQuestion {
  type: 'score';
  instructions: DecisionJsonValue;
  criteria: DecisionJsonValue[];
}

export type DecisionQuestion = NoulDecisionQuestion | ChoiceDecisionQuestion | ScoreDecisionQuestion;

export interface DecisionRequest {
  /** Defaults to `copilot`. `typesafe` is declared but currently returns `501`. */
  backend?: DecisionBackendName;
  state: string | object | unknown[];
  questions: Record<string, DecisionQuestion>;
}

export interface NoulDecisionAnswer {
  type: 'noul';
  /** Probability that the answer is true, clamped to `[0, 1]`. */
  value: number;
  confidence: number;
}

export interface ChoiceDecisionAnswer {
  type: 'choice';
  /** Option with the highest normalized probability. */
  choice: string;
  /** Normalized distribution over every option; sums to `1`. */
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreDecisionAnswer {
  type: 'score';
  /** Probability-weighted level index in `[0, levels - 1]`. */
  score: number;
  /** Level index (as a string) → the submitted level criterion. */
  legend: Record<string, DecisionJsonValue>;
  /** Normalized distribution keyed by level index; sums to `1`. */
  probabilities: Record<string, number>;
  confidence: number;
}

export type DecisionAnswer = NoulDecisionAnswer | ChoiceDecisionAnswer | ScoreDecisionAnswer;

export interface DecisionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface DecisionResponse {
  model: string;
  backend: DecisionBackendName;
  answers: Record<string, DecisionAnswer>;
  usage?: DecisionUsage;
  metadata: {
    /** The distribution comes from the model; normalization does not calibrate it. */
    confidenceKind: 'self_reported';
    attempts: number;
    durationMs: number;
  };
}

export type DecisionErrorCode =
  | 'DECISION_INVALID_REQUEST'
  | 'DECISION_REQUEST_TOO_LARGE'
  | 'DECISION_BACKEND_NOT_IMPLEMENTED'
  | 'DECISION_BACKEND_UNAVAILABLE'
  | 'DECISION_UPSTREAM_FAILED'
  | 'DECISION_MODEL_MISMATCH'
  | 'DECISION_INVALID_OUTPUT'
  | 'DECISION_TIMEOUT'
  | 'DECISION_CANCELLED';
