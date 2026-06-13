// Alarms are structured events emitted when a harness limit is breached or an
// integrity check fails. Distinct from OTel spans: spans record what happened;
// alarms signal something went wrong and prescribe a response.

export enum AlarmType {
  TURN_LIMIT_EXCEEDED        = "TURN_LIMIT_EXCEEDED",
  TOKEN_BUDGET_EXCEEDED      = "TOKEN_BUDGET_EXCEEDED",
  TIMEOUT                    = "TIMEOUT",
  SCHEMA_VALIDATION_FAILED   = "SCHEMA_VALIDATION_FAILED",
  SECRET_DETECTED            = "SECRET_DETECTED",
  HALLUCINATED_FILE_CITATION = "HALLUCINATED_FILE_CITATION",
  REPEATED_TOOL_CALL         = "REPEATED_TOOL_CALL",
  SCOPE_BUDGET_EXCEEDED      = "SCOPE_BUDGET_EXCEEDED",
  TOOL_TIMEOUT               = "TOOL_TIMEOUT",
  CHECKPOINT_FAILED          = "CHECKPOINT_FAILED",
  PR_TOO_LARGE               = "PR_TOO_LARGE",
  PR_NOT_FOUND               = "PR_NOT_FOUND",
}

export type AlarmSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface Alarm {
  alarmType: AlarmType;
  severity: AlarmSeverity;
  context: Record<string, unknown>;
  recommendedAction: string;
  timestamp: string;
  reviewId?: string;
}

const SEVERITIES: Record<AlarmType, AlarmSeverity> = {
  [AlarmType.TURN_LIMIT_EXCEEDED]:        "HIGH",
  [AlarmType.TOKEN_BUDGET_EXCEEDED]:      "HIGH",
  [AlarmType.TIMEOUT]:                    "HIGH",
  [AlarmType.SCHEMA_VALIDATION_FAILED]:   "CRITICAL",
  [AlarmType.SECRET_DETECTED]:            "CRITICAL",
  [AlarmType.HALLUCINATED_FILE_CITATION]: "HIGH",
  [AlarmType.REPEATED_TOOL_CALL]:         "MEDIUM",
  [AlarmType.SCOPE_BUDGET_EXCEEDED]:      "MEDIUM",
  [AlarmType.TOOL_TIMEOUT]:               "MEDIUM",
  [AlarmType.CHECKPOINT_FAILED]:          "HIGH",
  [AlarmType.PR_TOO_LARGE]:               "LOW",
  [AlarmType.PR_NOT_FOUND]:               "HIGH",
};

const RECOMMENDED_ACTIONS: Record<AlarmType, string> = {
  [AlarmType.TURN_LIMIT_EXCEEDED]:        "Retry with --quick mode; report partial results",
  [AlarmType.TOKEN_BUDGET_EXCEEDED]:      "Retry with a smaller PR or --quick mode",
  [AlarmType.TIMEOUT]:                    "Retry; check for slow tool calls in observability",
  [AlarmType.SCHEMA_VALIDATION_FAILED]:   "Discard run; surface raw model output for debugging",
  [AlarmType.SECRET_DETECTED]:            "Discard run; do not write to disk; alert engineer",
  [AlarmType.HALLUCINATED_FILE_CITATION]: "Strip finding; flag for quality review",
  [AlarmType.REPEATED_TOOL_CALL]:         "Abort loop; likely confused agent state",
  [AlarmType.SCOPE_BUDGET_EXCEEDED]:      "Continue with gathered context; log for tuning",
  [AlarmType.TOOL_TIMEOUT]:               "Return error-as-data; agent decides how to proceed",
  [AlarmType.CHECKPOINT_FAILED]:          "Stop run at that stage; surface checkpoint error to caller",
  [AlarmType.PR_TOO_LARGE]:               "Warn user; proceed only on explicit confirmation",
  [AlarmType.PR_NOT_FOUND]:               "Verify PR URL and GitHub token scope",
};

// SSE emitter injected from the web layer — null in CLI mode.
let _sseEmitter: ((reviewId: string, event: unknown) => void) | null = null;

export function setSseEmitter(
  emitter: (reviewId: string, event: unknown) => void,
): void {
  _sseEmitter = emitter;
}

export function createAlarm(
  alarmType: AlarmType,
  context: Record<string, unknown>,
  reviewId?: string,
): Alarm {
  return {
    alarmType,
    severity: SEVERITIES[alarmType],
    context,
    recommendedAction: RECOMMENDED_ACTIONS[alarmType],
    timestamp: new Date().toISOString(),
    reviewId,
  };
}

export function fireAlarm(alarm: Alarm): void {
  // Always write structured JSON to stderr so both CLI and server logs capture it.
  console.error(JSON.stringify({ harness_alarm: alarm }));

  // Push to SSE stream so the web approval UI can surface alarms in real time.
  if (_sseEmitter && alarm.reviewId) {
    _sseEmitter(alarm.reviewId, { type: "alarm", alarm });
  }
}
