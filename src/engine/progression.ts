import type {
  Exercise,
  SetLog,
  SessionLog,
  ProgressionEvaluation,
  ProgressionResult,
  MesocycleState,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

// ─── Regression Helper for Plateau Detection ─────────────────────────────────

/**
 * Fits a simple linear regression to data points and returns the slope.
 * x: indices (0, 1, 2, ... representing sessions chronologically oldest to newest)
 * y: average loads or estimated 1RM
 */
export function calculateSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

// ─── Core Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluates a completed session and determines the progression result, taking
 * the current mesocycle phase into account.
 *
 * Rules (in priority order):
 * 1. If mesocycle phase is 'deload' -> DELOAD (in load or volume)
 * 2. Not all target sets completed -> MAINTAIN
 * 3. Average RIR >> rirTarget by 2+ -> INCREASE early (easy session)
 * 4. All sets >= repsMax AND average RIR >= rirTarget -> INCREASE
 * 5. Reps within range -> MAINTAIN
 * 6. Reps below minimum -> MAINTAIN (deload is calendar-driven now, not reactive)
 * 7. Default -> MAINTAIN
 */
export function evaluateSession(
  exercise: Exercise,
  sets: SetLog[],
  recentSessions: SessionLog[],
  mesoState?: MesocycleState
): ProgressionEvaluation {
  const { repsMin, repsMax, currentLoad, loadIncrement, rirTarget, targetSets } = exercise;

  // 1. Scheduled Deload Phase check
  if (mesoState && mesoState.phase === 'deload') {
    const deloadLoad = Math.max(
      roundToIncrement(currentLoad * 0.9, loadIncrement),
      loadIncrement
    );
    const deloadSets = Math.max(1, Math.round(targetSets * 0.6));
    return {
      result: 'deload',
      suggestedLoad: deloadLoad,
      reason: `Fase deload programmata per ${exercise.muscleGroup} — carico ridotto del 10% a ${deloadLoad} kg, serie target ridotte a ${deloadSets}.`,
    };
  }

  // 2. Not enough sets completed
  if (sets.length < targetSets) {
    return {
      result: 'maintain',
      suggestedLoad: currentLoad,
      reason: `Completate ${sets.length}/${targetSets} serie — mantieni il carico.`,
    };
  }

  const avgReps = avg(sets.map((s) => s.reps));
  const allSetsAboveMax = sets.every((s) => s.reps >= repsMax);
  const allSetsBelowMin = sets.every((s) => s.reps < repsMin);

  // RIR analysis
  const rirValues = sets.map((s) => s.rir).filter((r): r is number => r !== null);
  const hasRir = rirValues.length > 0;
  const avgRir = hasRir ? avg(rirValues) : null;

  // 3. Session was too easy (high RIR) — anticipate progression
  if (
    hasRir &&
    rirTarget !== null &&
    avgRir !== null &&
    avgRir >= rirTarget + 2 &&
    avgReps >= repsMin
  ) {
    const suggestedLoad = roundToIncrement(currentLoad + loadIncrement, loadIncrement);
    return {
      result: 'increase',
      suggestedLoad,
      reason: `RIR medio ${avgRir.toFixed(1)} (target ${rirTarget}) — sessione molto facile, aumenta il carico.`,
    };
  }

  // 4. All reps at upper bound of range + RIR within acceptable range → INCREASE
  if (allSetsAboveMax) {
    const rirOk =
      !hasRir ||
      rirTarget === null ||
      (avgRir !== null && avgRir >= rirTarget);

    if (rirOk) {
      const suggestedLoad = roundToIncrement(currentLoad + loadIncrement, loadIncrement);
      return {
        result: 'increase',
        suggestedLoad,
        reason: `Tutte le serie a ${repsMax}+ reps — aumenta il carico a ${suggestedLoad} kg.`,
      };
    }
  }

  // 5. Reps below minimum -> maintain (not deload reattivo anymore)
  if (allSetsBelowMin) {
    return {
      result: 'maintain',
      suggestedLoad: currentLoad,
      reason: `Reps sotto al target minimo (${repsMin}) — mantieni il carico e punta ad accumulare reps.`,
    };
  }

  // 6. RIR too low (too hard) → definitely maintain
  if (hasRir && rirTarget !== null && avgRir !== null && avgRir < Math.max(rirTarget - 1, 0)) {
    return {
      result: 'maintain',
      suggestedLoad: currentLoad,
      reason: `RIR medio ${avgRir.toFixed(1)} troppo basso — mantieni il carico per recuperare meglio.`,
    };
  }

  // 7. Default: within range → maintain
  return {
    result: 'maintain',
    suggestedLoad: currentLoad,
    reason: `Reps nella fascia target (${repsMin}–${repsMax}) — mantieni il carico.`,
  };
}

// ─── Volume Helpers ──────────────────────────────────────────────────────────

// Default volume thresholds per muscle group (Schoenfeld 2017, Baz-Valle 2022)
export const DEFAULT_MEV = 6;   // minimum effective volume (sets/week)
export const DEFAULT_MRV = 25;  // maximum recoverable volume (sets/week)
export const OPTIMAL_MIN = 10;  // optimal range lower bound
export const OPTIMAL_MAX = 20;  // optimal range upper bound

/**
 * Effort factor based on RIR (Reps In Reserve).
 * Sets farther from failure contribute less to effective volume.
 * Based on Schoenfeld et al. 2021, Schoenfeld et al. 2016.
 */
export function effortFactorForRir(rir: number | null): number {
  if (rir === null) return 0.75;
  if (rir <= 1) return 1.0;
  if (rir <= 3) return 0.85;
  return 0.6;
}

/**
 * Calculates the RIR-weighted effective volume load of a set collection.
 * Effective volume = sum(reps * load * effort_factor) across all sets.
 * This replaces raw volume for progression tracking.
 */
export function calculateEffectiveVolume(sets: SetLog[]): number {
  return sets.reduce((sum, set) => {
    const raw = set.reps * set.load;
    const factor = effortFactorForRir(set.rir);
    return sum + raw * factor;
  }, 0);
}

/**
 * Evaluates weekly set volume against MEV/MRV thresholds.
 * Returns the volume status for display and advisory logic.
 */
export type VolumeStatus = 'low' | 'optimal' | 'caution' | 'overreaching';

export function getVolumeStatus(
  weeklySetCount: number,
  mev: number,
  mrv: number
): VolumeStatus {
  if (weeklySetCount < mev) return 'low';
  if (weeklySetCount >= OPTIMAL_MIN && weeklySetCount <= OPTIMAL_MAX) return 'optimal';
  if (weeklySetCount > mrv) return 'overreaching';
  if (weeklySetCount > OPTIMAL_MAX) return 'caution';
  return 'low'; // between MEV and OPTIMAL_MIN
}

/**
 * Calculates the volume load of a set: reps * load
 * (kept for raw display, use calculateEffectiveVolume for tracking)
 */
export function calculateVolumeLoad(sets: SetLog[]): number {
  return sets.reduce((sum, set) => sum + set.reps * set.load, 0);
}

/**
 * Returns rolling 7-day effective volume load for a muscle group.
 * Reference date defaults to today.
 */
export function getRolling7DayVolume(
  sessions: SessionLog[],
  exercises: Exercise[],
  muscleGroup: string,
  referenceDateStr: string = new Date().toISOString().slice(0, 10)
): { totalVolume: number; effectiveVolume: number; setCount: number } {
  const groupExerciseIds = new Set(
    exercises.filter((ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()).map((ex) => ex.id)
  );

  const refDate = new Date(referenceDateStr);
  const sevenDaysAgo = new Date(refDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  let totalVolume = 0;
  let effectiveVolume = 0;
  let setCount = 0;

  sessions.forEach((session) => {
    if (!groupExerciseIds.has(session.exerciseId)) return;

    const sessionDate = new Date(session.date);
    if (sessionDate >= sevenDaysAgo && sessionDate <= refDate) {
      totalVolume += calculateVolumeLoad(session.sets);
      effectiveVolume += calculateEffectiveVolume(session.sets);
      setCount += session.sets.length;
    }
  });

  return { totalVolume, effectiveVolume, setCount };
}

/**
 * Generates historical weekly effective volume trend blocks going back N weeks.
 */
export function getWeeklyVolumeTrend(
  sessions: SessionLog[],
  exercises: Exercise[],
  muscleGroup: string,
  numWeeks: number = 4
): { weekStart: string; volume: number; effectiveVolume: number; setCount: number }[] {
  const trend: { weekStart: string; volume: number; effectiveVolume: number; setCount: number }[] = [];
  const groupExerciseIds = new Set(
    exercises.filter((ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()).map((ex) => ex.id)
  );

  const now = new Date();
  // Find recent Monday
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const thisMonday = new Date(now.setDate(diff));
  thisMonday.setHours(0, 0, 0, 0);

  for (let i = 0; i < numWeeks; i++) {
    const weekStart = new Date(thisMonday.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    let rawVolume = 0;
    let effVolume = 0;
    let sets = 0;

    sessions.forEach((s) => {
      if (!groupExerciseIds.has(s.exerciseId)) return;
      const sDate = new Date(s.date);
      if (sDate >= weekStart && sDate < weekEnd) {
        rawVolume += calculateVolumeLoad(s.sets);
        effVolume += calculateEffectiveVolume(s.sets);
        sets += s.sets.length;
      }
    });

    trend.push({ weekStart: weekStartStr, volume: rawVolume, effectiveVolume: effVolume, setCount: sets });
  }

  return trend.reverse(); // return oldest to newest
}

// ─── Plateau & Early Warning Engine ──────────────────────────────────────────

export interface PlateauReport {
  isPlateau: boolean;
  slope: number;
  suggestions: string[];
}

/**
 * Analyzes the load trend of an exercise over the last 4-6 sessions.
 * Suggests actions if a plateau is detected.
 */
export function detectPlateau(
  exercise: Exercise,
  sessions: SessionLog[]
): PlateauReport {
  const exerciseSessions = sessions
    .filter((s) => s.exerciseId === exercise.id)
    .sort((a, b) => a.date.localeCompare(b.date)) // oldest to newest
    .slice(-6); // last 6 sessions

  if (exerciseSessions.length < 4) {
    return { isPlateau: false, slope: 0, suggestions: [] };
  }

  // Use the suggestedLoad or actual load used in the first set as the load metric
  const loads = exerciseSessions.map((s) => s.suggestedLoad);
  const slope = calculateSlope(loads);

  const isPlateau = slope <= 0;

  const suggestions: string[] = [];
  if (isPlateau) {
    suggestions.push(`Varia il range di reps target (es. se fai ${exercise.repsMin}–${exercise.repsMax}, prova a fare ${exercise.repsMin - 2}–${exercise.repsMin + 2} per forza, o incrementalo per endurance).`);
    suggestions.push(`Pianifica un deload anticipato per il gruppo muscolare ${exercise.muscleGroup}.`);
    suggestions.push(`Sostituisci questo esercizio con una variante simile (es. Panca con manubri invece di bilanciere).`);
  }

  return { isPlateau, slope, suggestions };
}

/**
 * Checks if multiple exercises in the same muscle group show a strongly negative load trend,
 * indicating systemic overreaching / overtraining.
 */
export function checkEarlyOverloadWarning(
  exercises: Exercise[],
  sessions: SessionLog[],
  muscleGroup: string
): { warning: boolean; message: string } {
  const groupExercises = exercises.filter(
    (ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()
  );

  if (groupExercises.length < 2) {
    return { warning: false, message: '' };
  }

  let decliningCount = 0;

  groupExercises.forEach((ex) => {
    const exSessions = sessions
      .filter((s) => s.exerciseId === ex.id)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-4);

    if (exSessions.length >= 3) {
      const loads = exSessions.map((s) => s.suggestedLoad);
      const slope = calculateSlope(loads);
      if (slope < -0.1) {
        decliningCount++;
      }
    }
  });

  // If more than 50% of exercises in the group are declining in load, warn the user.
  if (decliningCount >= Math.ceil(groupExercises.length / 2)) {
    return {
      warning: true,
      message: `Attenzione: diversi esercizi per ${muscleGroup} registrano cali consecutivi dei carichi. Valuta se il volume è eccessivo o anticipa la settimana di deload.`,
    };
  }

  return { warning: false, message: '' };
}

// ─── RIR Reliability Helper ──────────────────────────────────────────────────

/**
 * Returns true if RIR has been declared high (>=3) but load slope is flat or negative over 4+ weeks.
 */
export function checkRirReliability(
  exercise: Exercise,
  sessions: SessionLog[]
): boolean {
  const exSessions = sessions
    .filter((s) => s.exerciseId === exercise.id)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5); // last 5 sessions (around 4 weeks if trained weekly)

  if (exSessions.length < 4) return false;

  const rirVals = exSessions
    .flatMap((s) => s.sets.map((set) => set.rir))
    .filter((r): r is number => r !== null);

  if (rirVals.length === 0) return false;

  const averageRir = avg(rirVals);
  const loads = exSessions.map((s) => s.suggestedLoad);
  const slope = calculateSlope(loads);

  // If user says RIR is high (session is easy, plenty of reps in reserve)
  // but load slope is flat or negative, they are likely overestimating RIR.
  return averageRir >= 3 && slope <= 0.05;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getNextSessionLoad(
  exercise: Exercise,
  lastSession: SessionLog | undefined
): number {
  if (!lastSession) return exercise.currentLoad;
  return lastSession.suggestedLoad;
}

export function getProgressionColor(result: ProgressionResult): string {
  switch (result) {
    case 'increase': return 'success';
    case 'maintain': return 'warning';
    case 'deload':   return 'danger';
  }
}

export function getProgressionLabel(result: ProgressionResult): string {
  switch (result) {
    case 'increase': return '↑ Aumenta';
    case 'maintain': return '→ Mantieni';
    case 'deload':   return '↓ Deload';
  }
}

// ─── Deload ──────────────────────────────────────────────────────────────────

/**
 * Returns the multiplier for target sets during a deload week.
 * ~40% reduction from peak volume (0.6x).
 */
export function getDeloadSetMultiplier(): number {
  return 0.6;
}

/**
 * Calculates the reduced target sets for a deload week.
 *
 * Formula:   result = floorAt1( clamp( round(n · 0.6), to 40‑50% reduction ) )
 *
 * The 40‑50% reduction range is [ceil(n·0.5), floor(n·0.6)].
 * When a valid integer exists in that range, the rounded value is clamped to it.
 * Otherwise (empty range) the closest integer to 40% reduction is used via round.
 *
 * Low-input behaviour (n = 1‑6):
 *
 *   n  │ raw=n·0.6 │ range[50%..40%]  │ round │ clamp │ out │ reduction
 *   ───┼───────────┼──────────────────┼───────┼───────┼─────┼──────────
 *   1  │ 0.6       │ [1, 0] invalid   │ ❍     │ ❍     │  1  │  0%  (floor guard)
 *   2  │ 1.2       │ [1, 1] valid     │ 1     │ 1     │  1  │ 50%
 *   3  │ 1.8       │ [2, 1] invalid   │ 2     │ ❍     │  2  │ 33%* (see below)
 *   4  │ 2.4       │ [2, 2] valid     │ 2     │ 2     │  2  │ 50%
 *   5  │ 3.0       │ [3, 3] valid     │ 3     │ 3     │  3  │ 40%
 *   6  │ 3.6       │ [3, 3] valid     │ 4     │ 3     │  3  │ 50%
 *
 *   * n=3: no integer exists in [1.5, 1.8], so 40‑50% is impossible.
 *     round, floor, ceil all produce results outside the range (33% or 67%).
 *     This is a fundamental integer constraint, not a rounding choice issue.
 */
export function getDeloadTargetSets(normalTargetSets: number): number {
  const raw = normalTargetSets * getDeloadSetMultiplier(); // 60% of original (40% reduction)
  const minAcceptable = Math.ceil(normalTargetSets * 0.5); // 50% reduction
  const maxAcceptable = Math.floor(raw);                   // 40% reduction

  let result: number;
  if (minAcceptable <= maxAcceptable) {
    // Valid integer range exists → clamp rounded value within range
    result = Math.max(minAcceptable, Math.min(maxAcceptable, Math.round(raw)));
  } else {
    // No integer falls in 40–50% range → use closest to 40%
    result = Math.round(raw);
  }

  return Math.max(1, result);
}

// ─── Intra-Session Load Adjustment (RIR-based) ──────────────────────────────

/**
 * Adjusts the load for the next set within the same session
 * based on the absolute RIR deviation (|diff|) from target.
 *
 * - |diff| >= 3 → adjust by ±10%
 * - |diff| = 2  → adjust by ±5%
 * - |diff| <= 1 → no change
 * - Adjustment is symmetric: same |diff| gives same magnitude
 * - Output is always ≥ loadIncrement
 */
export function adjustLoadForNextSet(
  lastSetLoad: number,
  actualRir: number,
  rirTarget: number,
  loadIncrement: number
): { suggestedLoad: number; feedback: string | null } {
  const diff = actualRir - rirTarget;
  const absDiff = Math.abs(diff);

  if (absDiff >= 3) {
    const factor = diff > 0 ? 1.10 : 0.90;
    const suggestedLoad = Math.max(
      roundToIncrement(lastSetLoad * factor, loadIncrement),
      loadIncrement
    );
    const direction = diff > 0 ? 'aumentato' : 'ridotto';
    return {
      suggestedLoad,
      feedback: `RIR ${actualRir} vs target ${rirTarget}. Carico serie succ. ${direction} a ${suggestedLoad} kg.`,
    };
  }
  if (absDiff === 2) {
    const factor = diff > 0 ? 1.05 : 0.95;
    const suggestedLoad = Math.max(
      roundToIncrement(lastSetLoad * factor, loadIncrement),
      loadIncrement
    );
    const direction = diff > 0 ? 'aumentato' : 'ridotto';
    return {
      suggestedLoad,
      feedback: `RIR ${actualRir} vs target ${rirTarget}. Carico serie succ. ${direction} a ${suggestedLoad} kg.`,
    };
  }
  return { suggestedLoad: lastSetLoad, feedback: null };
}

// ─── Set Validation ──────────────────────────────────────────────────────────

export interface SetValidationWarnings {
  reps?: string;
  load?: string;
  rir?: string;
}

/**
 * Checks a set's values against reasonable ranges.
 * Returns warnings for anomalous values — the caller can confirm before proceeding.
 * PR-level values are never blocked, only flagged for confirmation.
 */
export function validateSetValues(
  reps: number,
  load: number,
  rir: number | null
): SetValidationWarnings {
  const warnings: SetValidationWarnings = {};

  if (reps < 3 && reps >= 1) {
    warnings.reps = `${reps} reps: valore molto basso. Sei sicuro?`;
  }
  if (reps > 25) {
    warnings.reps = `${reps} reps: valore molto alto (range tipico 3–25). Sei sicuro?`;
  }

  if (load > 0 && load < 1) {
    warnings.load = `${load} kg: carico molto basso. Confermi?`;
  }
  if (load > 300) {
    warnings.load = `${load} kg: carico eccezionale. Se è un PR procedi pure.`;
  }

  if (rir !== null && rir > 5) {
    warnings.rir = `RIR ${rir}: molto lontano dal cedimento. Confermi?`;
  }
  if (rir !== null && rir < 0) {
    warnings.rir = `RIR negativo non valido.`;
  }

  return warnings;
}


