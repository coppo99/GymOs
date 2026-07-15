import type {
  Exercise,
  SetLog,
  SessionLog,
  MesocycleState,
  ProgressionEvaluation,
  ProgressionResult,
  E1RMTrend,
} from '../types';
import {
  roundToIncrement,
  countHardSets,
} from './progression';
import { estimateE1RM, calculateE1RMTrend, getVolumeThresholds } from './metrics';
import { detectRealPlateau } from './plateauDetection';
import { calculateProgressScore } from './progressScore';
import { shouldTriggerDeload as extendedShouldTriggerDeload } from './deloadLogic';
import type { DeloadIndicators } from './deloadLogic';

function computeE1RMTrend(recentSessions: SessionLog[]): E1RMTrend {
  if (recentSessions.length < 2) {
    return { slope: 0, direction: 'flat', sampleConfidence: 'low' };
  }
  const e1rmPoints = recentSessions.slice(0, 6).map((s) => {
    if (s.sets.length === 0) return { e1rm: { value: 0, confidence: 'low' as const, effectiveReps: 0 }, date: s.date };
    const lastSet = s.sets[s.sets.length - 1];
    return { e1rm: estimateE1RM(lastSet.load, lastSet.reps, lastSet.rir), date: s.date };
  });
  return calculateE1RMTrend(e1rmPoints);
}

function deloadResult(
  exercise: Exercise,
  reason: string,
  deloadReason: ProgressionEvaluation['deloadReason']
): ProgressionEvaluation {
  const deloadLoad = Math.max(
    roundToIncrement(exercise.currentLoad * 0.9, exercise.loadIncrement),
    exercise.loadIncrement
  );
  return {
    result: 'deload',
    suggestedLoad: deloadLoad,
    reason,
    deloadReason,
  };
}

export function evaluateSession(
  exercise: Exercise,
  sets: SetLog[],
  recentSessions: SessionLog[],
  mesoState?: MesocycleState,
  plateauAcrossGroup: boolean = false,
  rirUnreliableAcrossGroup: boolean = false
): ProgressionEvaluation {
  const { currentLoad, loadIncrement, targetSets } = exercise;

  if (mesoState) {
    const e1rmTrend = computeE1RMTrend(recentSessions);
    const realPlateau = detectRealPlateau(recentSessions, exercise);
    const thresholds = getVolumeThresholds(mesoState.muscleGroup);
    const volumeCount = countHardSets(sets);
    const volumeOverMRV = volumeCount > thresholds.mrv;

    const indicators: DeloadIndicators = {
      e1rmDeclining: e1rmTrend.direction === 'down' && e1rmTrend.sampleConfidence === 'high',
      plateauDetected: realPlateau.isPlateau,
      volumeOverMRV,
    };

    const deloadDecision = extendedShouldTriggerDeload(
      mesoState,
      [plateauAcrossGroup],
      [rirUnreliableAcrossGroup],
      indicators,
    );

    if (deloadDecision.trigger) {
      const reasonMap: Record<string, string> = {
        scheduled: `Fase deload programmata per ${exercise.muscleGroup}`,
        plateau: `Deload anticipato: plateau su piu esercizi del gruppo ${exercise.muscleGroup}`,
        rir_unreliable: `Deload anticipato: RIR inaffidabile su piu esercizi del gruppo ${exercise.muscleGroup}`,
        autoregulated: `Deload autoregolato: e1RM/plateau/volume per ${exercise.muscleGroup}`,
      };
      return deloadResult(exercise, reasonMap[deloadDecision.reason] ?? reasonMap.scheduled, deloadDecision.reason);
    }
  }

  const e1rmTrend = computeE1RMTrend(recentSessions);
  const score = calculateProgressScore(sets, exercise, recentSessions, e1rmTrend, mesoState);

  let result: ProgressionResult;
  let suggestedLoad = currentLoad;
  let reason: string;

  if (score.decision === 'increase') {
    result = 'increase';
    suggestedLoad = roundToIncrement(currentLoad + loadIncrement, loadIncrement);
    reason = `Progress Score ${score.total.toFixed(1)}: performance positiva, incrementa a ${suggestedLoad} kg.`;
  } else if (score.decision === 'deload') {
    return {
      ...deloadResult(exercise, `Progress Score ${score.total.toFixed(1)}: segnali di affaticamento, deload consigliato.`, undefined),
      breakdown: score,
    };
  } else {
    result = 'maintain';
    if (score.decision === 'reduce_volume') {
      reason = `Progress Score ${score.total.toFixed(1)}: mantieni carico, riduci volume.`;
    } else {
      reason = `Progress Score ${score.total.toFixed(1)}: performance nella media, mantieni carico.`;
    }
  }

  return { result, suggestedLoad, reason, breakdown: score };
}
