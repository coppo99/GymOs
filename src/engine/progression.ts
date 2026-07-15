import type {
  Exercise,
  SetLog,
  SessionLog,
  ProgressionEvaluation,
  ProgressionResult,
  MesocycleState,
  DeloadReason,
} from '../types';
import { detectRirInconsistency, detectGroupDecline } from './metrics';

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

// Minimum weeks into accumulation before early deload can trigger.
// Prevents false deload on noise from the first few sessions.
export const MIN_WEEKS_BEFORE_EARLY_DELOAD = 2;

// ─── Deload Decision ─────────────────────────────────────────────────────────

/**
 * Centralized deload decision based on scheduled phase, plateau, and RIR reliability.
 * Returns whether to trigger deload and the reason.
 *
 * Precedence: scheduled > plateau > rir_unreliable
 * - Scheduled deload always triggers (phase already set to 'deload').
 * - Plateau triggers early deload if >=50% of group exercises show plateau.
 * - RIR unreliable triggers early deload if >=50% of group exercises show it.
 * - If both plateau and RIR trigger, 'plateau' takes priority.
 * - Early deload never triggers before MIN_WEEKS_BEFORE_EARLY_DELOAD.
 */
export function shouldTriggerDeload(
  mesocycleState: MesocycleState,
  plateauExercises: boolean[],
  rirUnreliableExercises: boolean[],
  minWeeks: number = MIN_WEEKS_BEFORE_EARLY_DELOAD
): { trigger: boolean; reason: DeloadReason } {
  if (mesocycleState.phase === 'deload') {
    return { trigger: true, reason: mesocycleState.deloadReason ?? 'scheduled' };
  }

  if (mesocycleState.currentWeek < minWeeks) {
    return { trigger: false, reason: 'scheduled' };
  }

  const total = Math.max(1, plateauExercises.length);
  const hasPlateau = plateauExercises.filter(Boolean).length / total >= 0.5;
  const hasRirIssue = rirUnreliableExercises.filter(Boolean).length / total >= 0.5;

  if (hasPlateau) return { trigger: true, reason: 'plateau' };
  if (hasRirIssue) return { trigger: true, reason: 'rir_unreliable' };
  return { trigger: false, reason: 'scheduled' };
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
  mesoState?: MesocycleState,
  plateauAcrossGroup: boolean = false,
  rirUnreliableAcrossGroup: boolean = false
): ProgressionEvaluation {
  const { repsMin, repsMax, currentLoad, loadIncrement, rirTarget, targetSets } = exercise;

  if (mesoState) {
    const deloadDecision = shouldTriggerDeload(
      mesoState,
      [plateauAcrossGroup],
      [rirUnreliableAcrossGroup],
    );

    if (deloadDecision.trigger) {
      const deloadLoad = Math.max(
        roundToIncrement(currentLoad * 0.9, loadIncrement),
        loadIncrement
      );
      const deloadSets = Math.max(1, Math.round(targetSets * 0.6));

      if (deloadDecision.reason === 'scheduled') {
        return {
          result: 'deload',
          suggestedLoad: deloadLoad,
          reason: `Fase deload programmata per ${exercise.muscleGroup} — carico ridotto del 10% a ${deloadLoad} kg, serie target ridotte a ${deloadSets}.`,
          deloadReason: 'scheduled',
        };
      }

      const reasonLabel = deloadDecision.reason === 'plateau'
        ? 'plateau rilevato su piu esercizi del gruppo'
        : 'RIR dichiarato inaffidabile su piu esercizi del gruppo';
      return {
        result: 'deload',
        suggestedLoad: deloadLoad,
        reason: `Deload anticipato: ${reasonLabel} per ${exercise.muscleGroup}. Carico ridotto del 10% a ${deloadLoad} kg, serie target ridotte a ${deloadSets}.`,
        deloadReason: deloadDecision.reason,
      };
    }
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

  // 5. Reps below minimum -> maintain
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
export const DEFAULT_MEV = 6;   // minimum effective volume (hard sets/week)
export const DEFAULT_MRV = 25;  // maximum recoverable volume (hard sets/week)
export const OPTIMAL_MIN = 10;  // optimal range lower bound
export const OPTIMAL_MAX = 20;  // optimal range upper bound

/**
 * Returns true if a set is "hard" (close to failure), meaning RIR ≤ threshold.
 * Based on the RP/Israetel definition: hard sets = RIR 0-3.
 * threshold is exposed for future user configuration (default 3).
 */
export function isHardSet(rir: number | null, threshold = 3): boolean {
  if (rir === null) return false;
  return rir <= threshold;
}

/**
 * Counts the number of hard sets in a collection.
 * A hard set is one with RIR ≤ threshold.
 * This is the metric used for MEV/MRV comparisons per RP standards.
 */
export function countHardSets(sets: SetLog[], threshold = 3): number {
  return sets.filter(s => isHardSet(s.rir, threshold)).length;
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
 * Used for trend/PR display, NOT for MEV/MRV comparison.
 */
export function calculateVolumeLoad(sets: SetLog[]): number {
  return sets.reduce((sum, set) => sum + set.reps * set.load, 0);
}

/**
 * Returns rolling 7-day hard sets count and volume for a muscle group.
 * Reference date defaults to today.
 */
export function getRolling7DayVolume(
  sessions: SessionLog[],
  exercises: Exercise[],
  muscleGroup: string,
  referenceDateStr: string = new Date().toISOString().slice(0, 10)
): { totalVolume: number; hardSets: number; setCount: number } {
  const groupExerciseIds = new Set(
    exercises.filter((ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()).map((ex) => ex.id)
  );

  const refDate = new Date(referenceDateStr);
  const sevenDaysAgo = new Date(refDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  let totalVolume = 0;
  let hardSets = 0;
  let setCount = 0;

  sessions.forEach((session) => {
    if (!groupExerciseIds.has(session.exerciseId)) return;

    const sessionDate = new Date(session.date);
    if (sessionDate >= sevenDaysAgo && sessionDate <= refDate) {
      totalVolume += calculateVolumeLoad(session.sets);
      hardSets += countHardSets(session.sets);
      setCount += session.sets.length;
    }
  });

  return { totalVolume, hardSets, setCount };
}

/**
 * Generates historical weekly hard sets and volume trend blocks going back N weeks.
 */
export function getWeeklyVolumeTrend(
  sessions: SessionLog[],
  exercises: Exercise[],
  muscleGroup: string,
  numWeeks: number = 4
): { weekStart: string; volume: number; hardSets: number; setCount: number }[] {
  const trend: { weekStart: string; volume: number; hardSets: number; setCount: number }[] = [];
  const groupExerciseIds = new Set(
    exercises.filter((ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()).map((ex) => ex.id)
  );

  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const thisMonday = new Date(now.setDate(diff));
  thisMonday.setHours(0, 0, 0, 0);

  for (let i = 0; i < numWeeks; i++) {
    const weekStart = new Date(thisMonday.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekStartStr = weekStart.toISOString().slice(0, 10);

    let rawVolume = 0;
    let hardSets = 0;
    let sets = 0;

    sessions.forEach((s) => {
      if (!groupExerciseIds.has(s.exerciseId)) return;
      const sDate = new Date(s.date);
      if (sDate >= weekStart && sDate < weekEnd) {
        rawVolume += calculateVolumeLoad(s.sets);
        hardSets += countHardSets(s.sets);
        sets += s.sets.length;
      }
    });

    trend.push({ weekStart: weekStartStr, volume: rawVolume, hardSets, setCount: sets });
  }

  return trend.reverse();
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
  const result = detectGroupDecline(exercises, sessions, muscleGroup);
  if (result.declining) {
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
    .slice(-5);

  if (exSessions.length < 4) return false;

  const rirVals = exSessions
    .flatMap((s) => s.sets.map((set) => set.rir))
    .filter((r): r is number => r !== null);

  if (rirVals.length === 0) return false;

  const averageRir = rirVals.reduce((a, b) => a + b, 0) / rirVals.length;
  const loads = exSessions.map((s) => s.suggestedLoad);
  const slope = calculateSlope(loads);

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
 * based on the RIR deviation from target.
 *
 * Asymmetric: the cost of overshooting (too heavy, RIR too low) is greater
 * than the cost of undershooting (too light, RIR too high), so reductions
 * are more aggressive than increases.
 *
 * - |diff| >= 4 (extreme):  −10% se duro, +5% se facile
 * - |diff| = 3:              −5% se duro, +3% se facile
 * - |diff| = 2:              −2.5% se duro, +1.5% se facile
 * - |diff| <= 1:             invariato
 */
export function adjustLoadForNextSet(
  lastSetLoad: number,
  actualRir: number,
  rirTarget: number,
  loadIncrement: number
): { suggestedLoad: number; feedback: string | null } {
  const diff = actualRir - rirTarget;
  const absDiff = Math.abs(diff);

  let factor: number;
  if (absDiff >= 4) {
    factor = diff > 0 ? 1.05 : 0.90;
  } else if (absDiff === 3) {
    factor = diff > 0 ? 1.03 : 0.95;
  } else if (absDiff === 2) {
    factor = diff > 0 ? 1.015 : 0.975;
  } else {
    factor = 1;
  }

  if (factor === 1) {
    return { suggestedLoad: lastSetLoad, feedback: null };
  }

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


