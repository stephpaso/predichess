export const PLAN_TIME_SEC_MIN = 10;
export const PLAN_TIME_SEC_MAX = 60;
export const PLAN_TIME_SEC_DEFAULT = 45;

export const PREDICTIVE_SLOTS_MIN = 2;
export const PREDICTIVE_SLOTS_MAX = 5;
export const PREDICTIVE_SLOTS_DEFAULT = 2;

/** Seconds allowed for one planning round. Missing or invalid values use the default. */
export function clampTurnTimeSec(value: unknown, fallback = PLAN_TIME_SEC_DEFAULT): number {
  const n = Math.floor(Number(value));
  const raw = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(PLAN_TIME_SEC_MAX, Math.max(PLAN_TIME_SEC_MIN, raw));
}

/** Predictive slots per round. Values below the minimum, including 1, become 2. */
export function clampPredictiveSlots(value: unknown, fallback = PREDICTIVE_SLOTS_DEFAULT): number {
  const n = Math.floor(Number(value));
  const raw = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(PREDICTIVE_SLOTS_MAX, Math.max(PREDICTIVE_SLOTS_MIN, raw));
}
