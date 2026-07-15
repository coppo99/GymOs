import type { SessionLog, Exercise, EstimatedE1RM, PlateauAssessment } from '../types';
import { calculateSlope, calculateVolumeLoad, countHardSets } from './progression';
import { estimateE1RM, calculateE1RMTrend } from './metrics';

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function recentSessionsForExercise(
  sessions: SessionLog[],
  exerciseId: string,
  count: number
): SessionLog[] {
  return sessions
    .filter((s) => s.exerciseId === exerciseId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-count);
}

/**
 * Assesses whether an exercise is in a real plateau by checking
 * concordance across e1RM trend, reps trend, and volume trend.
 *
 * Rules (all must agree for isPlateau=true):
 * 1. e1RM trend is flat or down over 4-6 sessions
 * 2. Average reps trend is flat or down
 * 3. Volume (hard sets) trend is flat or down
 *
 * Explicitly excludes false plateau: a session with "maintain" result
 * but reps increasing vs the prior session is NOT a plateau
 * (double progression in progress).
 */
export function detectRealPlateau(
  sessions: SessionLog[],
  exercise: Exercise
): PlateauAssessment {
  const exSessions = recentSessionsForExercise(sessions, exercise.id, 6);
  if (exSessions.length < 4) {
    return { isPlateau: false, reasons: ['Dati insufficienti (servono almeno 4 sessioni).'] };
  }

  const reasons: string[] = [];

  // 1. e1RM trend
  const e1rmPoints = exSessions.map((s) => {
    if (s.sets.length === 0) return { e1rm: { value: 0, confidence: 'low' as const, effectiveReps: 0 }, date: s.date };
    const lastSet = s.sets[s.sets.length - 1];
    const e1rm = estimateE1RM(lastSet.load, lastSet.reps, lastSet.rir);
    return { e1rm, date: s.date };
  });
  const e1rmTrend = calculateE1RMTrend(e1rmPoints);
  const e1rmFlatOrDown = e1rmTrend.direction === 'flat' || e1rmTrend.direction === 'down';
  if (e1rmFlatOrDown) {
    reasons.push(`Trend e1RM: ${e1rmTrend.direction} (pendenza ${e1rmTrend.slope.toFixed(2)})`);
  } else {
    reasons.push(`Trend e1RM in salita — nessun plateau.`);
    return { isPlateau: false, reasons };
  }

  // 2. Reps trend
  const avgRepsPerSession = exSessions.map((s) => avg(s.sets.map((set) => set.reps)));
  const repsSlope = calculateSlope(avgRepsPerSession);

  // Check false plateau: if the latest session has higher avg reps than the previous one
  if (exSessions.length >= 2) {
    const lastAvg = avg(exSessions[exSessions.length - 1].sets.map((set) => set.reps));
    const prevAvg = avg(exSessions[exSessions.length - 2].sets.map((set) => set.reps));
    if (lastAvg > prevAvg) {
      reasons.push(`Reps in aumento (${prevAvg.toFixed(1)} → ${lastAvg.toFixed(1)}) — accumulo in corso, falso plateau escluso.`);
      return { isPlateau: false, reasons };
    }
  }

  const repsFlatOrDown = repsSlope <= 0;
  if (repsFlatOrDown) {
    reasons.push(`Trend reps: piatto/calo (pendenza ${repsSlope.toFixed(2)})`);
  } else {
    reasons.push(`Trend reps in salita — nessun plateau.`);
    return { isPlateau: false, reasons };
  }

  // 3. Volume (hard sets) trend
  const volumePerSession = exSessions.map((s) => countHardSets(s.sets));
  const volumeSlope = calculateSlope(volumePerSession);
  const volumeFlatOrDown = volumeSlope <= 0;
  if (volumeFlatOrDown) {
    reasons.push(`Trend volume (hard sets): piatto/calo (pendenza ${volumeSlope.toFixed(2)})`);
  } else {
    reasons.push(`Trend volume in salita — nessun plateau.`);
    return { isPlateau: false, reasons };
  }

  return { isPlateau: true, reasons };
}
