import type { MesocycleState, DeloadReason } from '../types';
import { MIN_WEEKS_BEFORE_EARLY_DELOAD } from './progression';

export interface DeloadIndicators {
  e1rmDeclining: boolean;         // e1RM trend direction === 'down'
  plateauDetected: boolean;       // real plateau detected (from detectRealPlateau)
  volumeOverMRV: boolean;         // volume status === 'overreaching'
}

/**
 * Extended deload decision with autoregulated support.
 *
 * Precedence (highest to lowest):
 * 1. scheduled phase (mesocycle phase === 'deload')
 * 2. plateau (≥50% group exercises plateauing)
 * 3. rir_unreliable (≥50% group exercises with unreliable RIR)
 * 4. autoregulated (≥2 of 3 indicators: e1RM declining, plateau, volume over MRV)
 *
 * Early deload (non-scheduled) never triggers before MIN_WEEKS_BEFORE_EARLY_DELOAD.
 */
export function shouldTriggerDeload(
  mesocycleState: MesocycleState,
  plateauExercises: boolean[],
  rirUnreliableExercises: boolean[],
  indicators?: DeloadIndicators,
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

  // Autoregulated: need ≥2 concordant indicators
  if (indicators) {
    const triggeredCount = [
      indicators.e1rmDeclining,
      indicators.plateauDetected,
      indicators.volumeOverMRV,
    ].filter(Boolean).length;

    if (triggeredCount >= 2) {
      return { trigger: true, reason: 'autoregulated' };
    }
  }

  return { trigger: false, reason: 'scheduled' };
}
