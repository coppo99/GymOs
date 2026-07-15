import type {
  SetLog,
  SessionLog,
  Exercise,
  EstimatedE1RM,
  E1RMTrend,
  VolumeThresholds,
} from '../types';
import { calculateSlope, countHardSets, calculateVolumeLoad } from './progression';

// ─── e1RM Estimation ──────────────────────────────────────────────────────────

export function estimateE1RM(
  load: number,
  reps: number,
  rir: number | null
): EstimatedE1RM {
  const effectiveReps = rir !== null ? reps + rir : reps;
  const value = load * (1 + effectiveReps / 30);
  const confidence = rir !== null && effectiveReps <= 12 ? 'high' : 'low';
  return { value, confidence, effectiveReps };
}

// ─── e1RM Trend ───────────────────────────────────────────────────────────────

export function calculateE1RMTrend(
  sessions: { e1rm: EstimatedE1RM; date: string }[]
): E1RMTrend {
  if (sessions.length < 2) {
    return { slope: 0, direction: 'flat', sampleConfidence: 'low' };
  }
  const values = sessions.map((s) => s.e1rm.value);
  const slope = calculateSlope(values);
  const direction = slope > 0.5 ? 'up' : slope < -0.5 ? 'down' : 'flat';
  const lowCount = sessions.filter((s) => s.e1rm.confidence === 'low').length;
  const sampleConfidence = lowCount > sessions.length / 2 ? 'low' : 'high';
  return { slope, direction, sampleConfidence };
}

// ─── Detection Logic (extracted, shared between legacy wrappers and new engine) ──

export function detectRirInconsistency(
  sets: SetLog[],
  repsMin: number,
  repsMax: number
): { inconsistent: boolean; explanation: string | null } {
  if (sets.length === 0) return { inconsistent: false, explanation: null };
  const lastSet = sets[sets.length - 1];
  if (lastSet.rir === null) return { inconsistent: false, explanation: null };
  const lastReps = lastSet.reps;
  if (lastSet.rir <= 1 && lastReps >= repsMax) {
    return {
      inconsistent: true,
      explanation: `RIR dichiarato ≤1 (molto vicino al cedimento) ma reps ${lastReps} al massimo del range ${repsMax}. Possibile RIR sottostimato.`,
    };
  }
  if (lastSet.rir >= 3 && lastReps < repsMin) {
    return {
      inconsistent: true,
      explanation: `RIR dichiarato ≥3 (lontano dal cedimento) ma reps ${lastReps} sotto il minimo ${repsMin}. Possibile RIR sovrastimato o sessione compromessa.`,
    };
  }
  return { inconsistent: false, explanation: null };
}

export function detectGroupDecline(
  exercises: Exercise[],
  sessions: SessionLog[],
  muscleGroup: string
): { declining: boolean; count: number; total: number } {
  const groupExercises = exercises.filter(
    (ex) => ex.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()
  );
  let decliningCount = 0;
  groupExercises.forEach((ex) => {
    const exSessions = sessions
      .filter((s) => s.exerciseId === ex.id)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-4);
    if (exSessions.length >= 3) {
      const loads = exSessions.map((s) => s.suggestedLoad);
      const slope = calculateSlope(loads);
      if (slope < -0.1) decliningCount++;
    }
  });
  return {
    declining: decliningCount >= Math.ceil(Math.max(1, groupExercises.length) / 2),
    count: decliningCount,
    total: groupExercises.length,
  };
}

// ─── Volume Thresholds by Muscle Group ────────────────────────────────────────

export const MUSCLE_GROUP_VOLUME_DEFAULTS: Record<string, VolumeThresholds> = {
  chest:         { mev: 6,  mrv: 22, source: 'rp_framework_approximate' },
  back:          { mev: 10, mrv: 25, source: 'rp_framework_approximate' },
  biceps:        { mev: 8,  mrv: 26, source: 'rp_framework_approximate' },
  triceps:       { mev: 6,  mrv: 18, source: 'rp_framework_approximate' },
  quads:         { mev: 8,  mrv: 20, source: 'rp_framework_approximate' },
  hamstrings:    { mev: 6,  mrv: 20, source: 'rp_framework_approximate' },
  glutes:        { mev: 4,  mrv: 16, source: 'rp_framework_approximate' },
  calves:        { mev: 8,  mrv: 20, source: 'rp_framework_approximate' },
  front_delts:   { mev: 4,  mrv: 12, source: 'rp_framework_approximate' },
  side_rear_delts: { mev: 8, mrv: 26, source: 'rp_framework_approximate' },
  abs:           { mev: 4,  mrv: 25, source: 'rp_framework_approximate' },
};

export const DEFAULT_FALLBACK_THRESHOLDS: VolumeThresholds = {
  mev: 6, mrv: 20, source: 'generic_fallback',
};

export function getVolumeThresholds(muscleGroup: string): VolumeThresholds {
  const key = muscleGroup.toLowerCase().replace(/\s+/g, '_');
  return MUSCLE_GROUP_VOLUME_DEFAULTS[key] ?? DEFAULT_FALLBACK_THRESHOLDS;
}

export const OPTIMAL_MIN = 10;
export const OPTIMAL_MAX = 20;
