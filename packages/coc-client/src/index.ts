export { CocClient } from './client';
export { HttpTransport, normalizeOptions } from './http';
export { CocApiError, CocNetworkError } from './errors';
export { buildApiUrl, buildQueryString, buildWebSocketUrl, encodePathSegment, normalizeApiBasePath, normalizeBaseUrl } from './url';
export * from './types';
export * from './contracts';
export * from './domains';
export * from './realtime';
export * from './for-each-plan';
export * from './map-reduce-plan';
export * from './quota';
export * from './browser-control';
export * from './pull-request-url';
export * from './dashboard-discovery';
export * from './date-time-trigger';

// Deprecated names kept for one release after the Refrains/Coda/Overtures rename.
import type { SentinelCodaClient, SentinelRefrainsClient } from './domains';
import type {
  SentinelRefrain,
  SentinelRefrainGateTest,
  SentinelRefrainInput,
  SentinelRefrainRun,
  SentinelCodaChangedEvent,
  SentinelCodaRunStatus,
  SentinelCodaVerdict,
  SentinelCodaConfig,
  SentinelCodaEvidence,
  SentinelCodaFinding,
  SentinelCodaItemState,
  SentinelCodaAuditEntry,
  SentinelCodaFindingRecord,
  SentinelCodaRun,
  SentinelCodaRunSummary,
  SentinelCodaRunDetail,
  SentinelCodaResponse,
  UpdateSentinelCodaConfigRequest,
  StartSentinelCodaRequest,
  StartSentinelCodaResponse,
  SentinelCodaFindingActionRequest,
  SentinelCodaFindingWriteResponse,
  SentinelCodaFindingDismissResponse,
  SentinelOvertureBinding,
  SentinelOvertureCapabilities,
  SentinelOvertureInput,
  SentinelOvertureEventInput,
  CreateSentinelOvertureRequest,
  EditSentinelOvertureRequest,
} from './contracts';

/** @deprecated use SentinelRefrain */
export type SentinelScheduledJob = SentinelRefrain;
/** @deprecated use SentinelRefrainInput */
export type SentinelScheduledJobInput = SentinelRefrainInput;
/** @deprecated use SentinelRefrainRun */
export type SentinelScheduledJobRun = SentinelRefrainRun;
/** @deprecated use SentinelRefrainGateTest */
export type SentinelScheduledJobGateTest = SentinelRefrainGateTest;
/** @deprecated use SentinelRefrainsClient */
export type SentinelScheduledJobsClient = SentinelRefrainsClient;
/** @deprecated use SentinelCodaRunStatus */
export type SentinelScrubRunStatus = SentinelCodaRunStatus;
/** @deprecated use SentinelCodaVerdict */
export type SentinelScrubVerdict = SentinelCodaVerdict;
/** @deprecated use SentinelCodaConfig */
export type SentinelScrubberConfig = SentinelCodaConfig;
/** @deprecated use SentinelCodaEvidence */
export type SentinelScrubEvidence = SentinelCodaEvidence;
/** @deprecated use SentinelCodaFinding */
export type SentinelScrubFinding = SentinelCodaFinding;
/** @deprecated use SentinelCodaItemState */
export type SentinelScrubItemState = SentinelCodaItemState;
/** @deprecated use SentinelCodaAuditEntry */
export type SentinelScrubAuditEntry = SentinelCodaAuditEntry;
/** @deprecated use SentinelCodaFindingRecord */
export type SentinelScrubFindingRecord = SentinelCodaFindingRecord;
/** @deprecated use SentinelCodaRun */
export type SentinelScrubRun = SentinelCodaRun;
/** @deprecated use SentinelCodaRunSummary */
export type SentinelScrubRunSummary = SentinelCodaRunSummary;
/** @deprecated use SentinelCodaRunDetail */
export type SentinelScrubRunDetail = SentinelCodaRunDetail;
/** @deprecated use SentinelCodaResponse */
export type SentinelScrubberResponse = SentinelCodaResponse;
/** @deprecated use UpdateSentinelCodaConfigRequest */
export type UpdateSentinelScrubberConfigRequest = UpdateSentinelCodaConfigRequest;
/** @deprecated use StartSentinelCodaRequest */
export type StartSentinelScrubRequest = StartSentinelCodaRequest;
/** @deprecated use StartSentinelCodaResponse */
export type StartSentinelScrubResponse = StartSentinelCodaResponse;
/** @deprecated use SentinelCodaFindingActionRequest */
export type SentinelScrubFindingActionRequest = SentinelCodaFindingActionRequest;
/** @deprecated use SentinelCodaFindingWriteResponse */
export type SentinelScrubFindingWriteResponse = SentinelCodaFindingWriteResponse;
/** @deprecated use SentinelCodaFindingDismissResponse */
export type SentinelScrubFindingDismissResponse = SentinelCodaFindingDismissResponse;
/** @deprecated use SentinelCodaClient */
export type SentinelScrubberClient = SentinelCodaClient;
/** @deprecated use SentinelCodaChangedEvent */
export type SentinelScrubberChangedEvent = SentinelCodaChangedEvent;
/** @deprecated use SentinelOvertureBinding */
export type SentinelTodoTriggerBinding = SentinelOvertureBinding;
/** @deprecated use SentinelOvertureCapabilities */
export type SentinelTodoTriggerCapabilities = SentinelOvertureCapabilities;
/** @deprecated use SentinelOvertureInput */
export type SentinelTodoTriggerInput = SentinelOvertureInput;
/** @deprecated use SentinelOvertureEventInput */
export type SentinelTodoTriggerEventInput = SentinelOvertureEventInput;
/** @deprecated use CreateSentinelOvertureRequest */
export type CreateSentinelTodoTriggerRequest = CreateSentinelOvertureRequest;
/** @deprecated use EditSentinelOvertureRequest */
export type EditSentinelTodoTriggerRequest = EditSentinelOvertureRequest;
