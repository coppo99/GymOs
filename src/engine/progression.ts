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
    return {
      result: 'deload',
      suggestedLoad: deloadLoad,
      reason: `Fase deload programmata per ${exercise.muscleGroup} — carico ridotto del 10% a ${deloadLoad} kg.`,
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

/**
 * Calculates the volume load of a set: reps * load
 */
export function calculateVolumeLoad(sets: SetLog[]): number {
  return sets.reduce((sum, set) => sum + set.reps * set.load, 0);
}

/**
 * Returns rolling 7-day volume load for a muscle group.
 * Reference date defaults to today.
 */
export function getRolling7DayVolume(
  sessions: SessionLog[],
  exercises: Exercise[],
  muscleGroup: string,
  referenceDateStr: string = new Date().toISOString().slice(0, 10)
): { totalVolume: number; setCount: number } {
  const groupExerciseIds = new Set(
    exercises.filter((ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()).map((ex) => ex.id)
  );

  const refDate = new Date(referenceDateStr);
  const sevenDaysAgo = new Date(refDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  let totalVolume = 0;
  let setCount = 0;

  sessions.forEach((session) => {
    if (!groupExerciseIds.has(session.exerciseId)) return;

    const sessionDate = new Date(session.date);
    if (sessionDate >= sevenDaysAgo && sessionDate <= refDate) {
      totalVolume += calculateVolumeLoad(session.sets);
      setCount += session.sets.length;
    }
  });

  return { totalVolume, setCount };
}

/**
 * Generates historical weekly volume trend blocks going back N weeks.
 */
export function getWeeklyVolumeTrend(
  sessions: SessionLog[],
  exercises: Exercise[],
  muscleGroup: string,
  numWeeks: number = 4
): { weekStart: string; volume: number; setCount: number }[] {
  const trend: { weekStart: string; volume: number; setCount: number }[] = [];
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

    let volume = 0;
    let sets = 0;

    sessions.forEach((s) => {
      if (!groupExerciseIds.has(s.exerciseId)) return;
      const sDate = new Date(s.date);
      if (sDate >= weekStart && sDate < weekEnd) {
        volume += calculateVolumeLoad(s.sets);
        sets += s.sets.length;
      }
    });

    trend.push({ weekStart: weekStartStr, volume, setCount: sets });
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

export function getDefaultLoadIncrement(bodyPart: string): number {
  return bodyPart === 'lower' ? 5.0 : 2.5;
}

export function getDefaultMuscleGroup(bodyPart: string): string {
  switch (bodyPart) {
    case 'lower': return 'Gambe';
    case 'core': return 'Core';
    default: return 'Upper Body';
  }
}
