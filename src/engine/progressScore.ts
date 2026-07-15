import type {
  Exercise,
  SetLog,
  SessionLog,
  MesocycleState,
  E1RMTrend,
  ProgressScoreBreakdown,
  ProgressScoreConfig,
} from '../types';
import { calculateVolumeLoad, countHardSets } from './progression';
import { detectRirInconsistency, getVolumeThresholds, OPTIMAL_MIN, OPTIMAL_MAX } from './metrics';

// ─── Default Configuration ────────────────────────────────────────────────────

export const DEFAULT_SCORE_CONFIG: ProgressScoreConfig = {
  increaseThreshold: 18,
  reduceThreshold: 5,
  deloadThreshold: 2,
};

// ─── Component Patterns ────────────────────────────────────────────────────
// Each component is a pure function returning { score, explanation }.
// To add a new factor: write a function with this signature and call it
// inside calculateProgressScore.

interface ComponentResult {
  score: number;
  explanation: string;
}

// ─── 1. Performance Component (dominant) ──────────────────────────────────────

function performanceComponent(sets: SetLog[], exercise: Exercise): ComponentResult {
  const { repsMin, repsMax, targetSets, currentLoad, loadIncrement } = exercise;
  if (sets.length < targetSets) {
    return {
      score: 0,
      explanation: `Serie completate ${sets.length}/${targetSets} — performance insufficiente.`,
    };
  }

  const avgReps = sets.reduce((a, s) => a + s.reps, 0) / sets.length;
  const repsRatio = (avgReps - repsMin) / Math.max(1, repsMax - repsMin);
  const repsScore = Math.max(0, Math.min(10, repsRatio * 10));

  let loadScore = 0;
  if (currentLoad > 0 && loadIncrement > 0) {
    const allAboveMax = sets.every((s) => s.reps >= repsMax);
    if (allAboveMax) loadScore = 3;
  }

  const total = repsScore + loadScore;
  return {
    score: Math.min(10, total),
    explanation: `Reps: ${avgReps.toFixed(1)} (range ${repsMin}-${repsMax}), score=${repsScore.toFixed(1)}. Carico: ${loadScore > 0 ? 'pronto per incremento' : 'da valutare'}.`,
  };
}

// ─── 2. Trend Component (e1RM + reps trend) ──────────────────────────────────

function trendComponent(
  recentSessions: SessionLog[],
  e1rmTrend: E1RMTrend
): ComponentResult {
  if (recentSessions.length < 2) {
    return { score: 5, explanation: `Dati insufficienti per trend — score neutrale.` };
  }

  let score = 5;

  if (e1rmTrend.direction === 'up') {
    score += 3;
  } else if (e1rmTrend.direction === 'down') {
    score -= 3;
  }

  if (e1rmTrend.sampleConfidence === 'low') {
    score -= 1;
  }

  const sessionRepsAverages = recentSessions.slice(0, 3).map((s) =>
    s.sets.reduce((a, set) => a + set.reps, 0) / Math.max(1, s.sets.length)
  );
  if (sessionRepsAverages.length >= 2) {
    const last = sessionRepsAverages[0];
    const prev = sessionRepsAverages[1];
    if (last > prev) score += 1;
    else if (last < prev) score -= 1;
  }

  return {
    score: Math.max(-5, Math.min(10, score)),
    explanation: `e1RM trend: ${e1rmTrend.direction} (confidenza ${e1rmTrend.sampleConfidence}). Reps trend: ${sessionRepsAverages.length >= 2 ? (sessionRepsAverages[0] > sessionRepsAverages[1] ? 'in miglioramento' : 'in calo') : 'N/D'}.`,
  };
}

// ─── 3. RIR Component (corrective, not driver) ───────────────────────────────

function rirComponent(sets: SetLog[], exercise: Exercise): ComponentResult {
  const { rirTarget, repsMin, repsMax } = exercise;
  if (sets.length === 0) {
    return { score: 0, explanation: `Nessun set — RIR non valutabile.` };
  }

  let score = 0;

  // Use last set RIR (most informative — Helms et al.)
  const lastSet = sets[sets.length - 1];
  if (lastSet.rir !== null && rirTarget !== null) {
    const rirDiff = lastSet.rir - rirTarget;
    // RIR aligned with target → positive
    if (Math.abs(rirDiff) <= 1) {
      score += 2;
    }
    // RIR too low (too hard) → slight penalty
    if (rirDiff < -1) {
      score -= 1;
    }
    // RIR too high (too easy) → slight penalty (wasted set)
    if (rirDiff > 1) {
      score -= 1;
    }
  }

  // Check RIR vs performance inconsistency
  const inconsistency = detectRirInconsistency(sets, repsMin, repsMax);
  if (inconsistency.inconsistent) {
    score -= 2;
    return {
      score: Math.max(-5, score),
      explanation: `${inconsistency.explanation} Penalità -2.`,
    };
  }

  return {
    score: Math.max(-5, Math.min(5, score)),
    explanation: `RIR ultima serie: ${lastSet.rir ?? 'N/D'} (target ${rirTarget ?? 'N/D'}). Allineamento: ${score >= 0 ? 'ok' : 'da correggere'}.`,
  };
}

// ─── 4. Fatigue Component (volume / intra-session drop) ──────────────────────

function fatigueComponent(
  sets: SetLog[],
  mesocycleState: MesocycleState | undefined
): ComponentResult {
  let score = 0;
  const explanations: string[] = [];

  // Intra-session fatigue: % drop between first and last set
  if (sets.length >= 2) {
    const first = sets[0];
    const last = sets[sets.length - 1];
    const firstEffort = first.reps * first.load;
    const lastEffort = last.reps * last.load;
    if (firstEffort > 0) {
      const dropPct = ((firstEffort - lastEffort) / firstEffort) * 100;
      if (dropPct > 20) {
        score -= 2;
        explanations.push(`Calo intra-sessione del ${dropPct.toFixed(0)}% (prima→ultima serie).`);
      } else if (dropPct > 10) {
        score -= 1;
        explanations.push(`Calo intra-sessione del ${dropPct.toFixed(0)}% — lieve.`);
      }
    }
  }

  // Volume vs MRV (session-level proxy — weekly check handled in deloadLogic)
  if (mesocycleState) {
    const thresholds = getVolumeThresholds(mesocycleState.muscleGroup);
    const sessionHardSets = countHardSets(sets);
    // Per-session hard sets exceeding half of MRV is a rough fatigue signal
    if (sessionHardSets > thresholds.mrv * 0.5) {
      score -= 1;
      explanations.push(`Volume sessione (${sessionHardSets} hard sets) elevato per MRV ${thresholds.mrv}.`);
    }
  }

  return {
    score: Math.max(-5, Math.min(5, score)),
    explanation: explanations.length > 0 ? explanations.join(' ') : 'Nessun segnale di fatica eccessiva.',
  };
}

// ─── Composer ────────────────────────────────────────────────────────────────

export function calculateProgressScore(
  sets: SetLog[],
  exercise: Exercise,
  recentSessions: SessionLog[],
  e1rmTrend: E1RMTrend,
  mesocycleState: MesocycleState | undefined,
  config: ProgressScoreConfig = DEFAULT_SCORE_CONFIG
): ProgressScoreBreakdown {
  const perf = performanceComponent(sets, exercise);
  const trend = trendComponent(recentSessions, e1rmTrend);
  const rir = rirComponent(sets, exercise);
  const fatigue = fatigueComponent(sets, mesocycleState);

  // Performance dominant, trend second, RIR/fatigue corrective
  const total = perf.score * 2 + trend.score + rir.score + fatigue.score;

  let decision: ProgressScoreBreakdown['decision'];
  if (total >= config.increaseThreshold) {
    decision = 'increase';
  } else if (total >= config.reduceThreshold) {
    decision = 'maintain';
  } else if (total >= config.deloadThreshold) {
    decision = 'reduce_volume';
  } else {
    decision = 'deload';
  }

  const explanation = [
    `Performance: ${perf.score.toFixed(1)}/10 — ${perf.explanation}`,
    `Trend: ${trend.score.toFixed(1)}/10 — ${trend.explanation}`,
    `RIR: ${rir.score.toFixed(1)}/5 — ${rir.explanation}`,
    `Fatica: ${fatigue.score.toFixed(1)}/5 — ${fatigue.explanation}`,
    `Totale: ${total.toFixed(1)} (soglie: increase≥${config.increaseThreshold}, reduce≥${config.reduceThreshold}, deload<${config.deloadThreshold}) → ${decision}.`,
  ];

  return {
    performanceComponent: perf.score,
    trendComponent: trend.score,
    rirComponent: rir.score,
    fatigueComponent: fatigue.score,
    total,
    decision,
    threshold: config,
    explanation,
  };
}
