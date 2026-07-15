import { describe, it, expect } from 'vitest';
import type { Exercise, SetLog, SessionLog, MesocycleState } from '../types';
import { evaluateSession } from './decision';

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex-1',
    name: 'Panca Piana',
    muscleGroup: 'Petto',
    targetSets: 3,
    repsMin: 6,
    repsMax: 10,
    currentLoad: 60,
    loadIncrement: 2.5,
    rirTarget: 2,
    createdAt: '2025-01-01T00:00:00.000Z',
    order: 0,
    ...overrides,
  };
}

function makeSet(overrides: Partial<SetLog> = {}): SetLog {
  return { setNumber: 1, reps: 8, load: 60, rir: 2, ...overrides };
}

function makeSession(overrides: Partial<SessionLog> = {}): SessionLog {
  return {
    id: 's-1',
    exerciseId: 'ex-1',
    date: '2025-01-10',
    sets: [makeSet()],
    progressionResult: 'increase' as const,
    suggestedLoad: 62.5,
    ...overrides,
  };
}

function makeMesoState(overrides: Partial<MesocycleState> = {}): MesocycleState {
  return {
    muscleGroup: 'Petto',
    currentWeek: 2,
    mesocycleLengthWeeks: 5,
    phase: 'accumulation',
    mev: 6,
    mrv: 22,
    lastUpdated: '2025-01-01T00:00:00.000Z',
    deloadReason: null,
    ...overrides,
  };
}

describe('evaluateSession (decision.ts — Progress Score)', () => {
  it('returns deload when mesocycle phase is deload', () => {
    const ex = makeExercise({ currentLoad: 100, loadIncrement: 2.5 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 100, rir: 2 },
      { setNumber: 2, reps: 10, load: 100, rir: 2 },
      { setNumber: 3, reps: 10, load: 100, rir: 2 },
    ];
    const meso = makeMesoState({ phase: 'deload' });
    const result = evaluateSession(ex, sets, [], meso);
    expect(result.result).toBe('deload');
    expect(result.suggestedLoad).toBe(90);
    expect(result.deloadReason).toBe('scheduled');
  });

  it('returns increase for good performance with all reps at max', () => {
    const ex = makeExercise({ rirTarget: 2, repsMax: 10, repsMin: 6, currentLoad: 60, loadIncrement: 2.5 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 60, rir: 2 },
      { setNumber: 2, reps: 10, load: 60, rir: 2 },
      { setNumber: 3, reps: 10, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('increase');
    expect(result.suggestedLoad).toBe(62.5);
  });

  it('returns maintain for incomplete target sets', () => {
    const ex = makeExercise({ targetSets: 4, rirTarget: 2 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 2 },
      { setNumber: 2, reps: 8, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
    expect(result.suggestedLoad).toBe(60);
  });

  it('returns maintain for average performance within range', () => {
    const ex = makeExercise({ rirTarget: 2, repsMin: 6, repsMax: 10 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 2 },
      { setNumber: 2, reps: 8, load: 60, rir: 2 },
      { setNumber: 3, reps: 8, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
  });

  it('returns maintain when no mesocycle state provided', () => {
    const ex = makeExercise();
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 2 },
      { setNumber: 2, reps: 8, load: 60, rir: 2 },
      { setNumber: 3, reps: 8, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, []);
    expect(result.result).toBe('maintain');
  });

  it('triggers early deload when plateauAcrossGroup is true and min weeks passed', () => {
    const ex = makeExercise({ currentLoad: 80, loadIncrement: 2.5 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 80, rir: 2 },
      { setNumber: 2, reps: 8, load: 80, rir: 2 },
      { setNumber: 3, reps: 8, load: 80, rir: 2 },
    ];
    const meso = makeMesoState({ currentWeek: 3 });
    const result = evaluateSession(ex, sets, [], meso, true, false);
    expect(result.result).toBe('deload');
    expect(result.deloadReason).toBe('plateau');
  });

  it('preserves deloadReason from mesoState when in deload phase', () => {
    const ex = makeExercise();
    const sets: SetLog[] = [makeSet()];
    const meso = makeMesoState({ phase: 'deload', deloadReason: 'rir_unreliable' });
    const result = evaluateSession(ex, sets, [], meso);
    expect(result.deloadReason).toBe('rir_unreliable');
  });

  it('handles session with RIR inconsistency (RIR too low for performance)', () => {
    const ex = makeExercise({ rirTarget: 2, repsMin: 6, repsMax: 10 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 60, rir: 1 },
      { setNumber: 2, reps: 10, load: 60, rir: 1 },
      { setNumber: 3, reps: 10, load: 60, rir: 0 },
    ];
    // RIR ≤1 but reps at max — inconsistency should penalize but not dominate
    const result = evaluateSession(ex, sets, [], makeMesoState());
    // Performance is strong (all at repsMax), so should still be increase
    expect(result.result).toBe('increase');
  });
});

describe('shouldTriggerDeload extended (via decision.ts)', () => {
  it('triggers autoregulated deload when 2+ indicators are present (currentWeek >= 2)', () => {
    const ex = makeExercise({ currentLoad: 80, loadIncrement: 2.5 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 80, rir: 2 },
      { setNumber: 2, reps: 8, load: 80, rir: 2 },
      { setNumber: 3, reps: 8, load: 80, rir: 2 },
    ];
    // Create declining e1RM trend via recent sessions
    const decliningSessions: SessionLog[] = [
      makeSession({ id: 's5', suggestedLoad: 80, date: '2025-01-05', sets: [{ setNumber: 1, reps: 6, load: 80, rir: 3 }] }),
      makeSession({ id: 's4', suggestedLoad: 77.5, date: '2025-01-12', sets: [{ setNumber: 1, reps: 6, load: 77.5, rir: 3 }] }),
      makeSession({ id: 's3', suggestedLoad: 75, date: '2025-01-19', sets: [{ setNumber: 1, reps: 6, load: 75, rir: 3 }] }),
      makeSession({ id: 's2', suggestedLoad: 72.5, date: '2025-01-26', sets: [{ setNumber: 1, reps: 6, load: 72.5, rir: 3 }] }),
      makeSession({ id: 's1', suggestedLoad: 70, date: '2025-02-02', sets: [{ setNumber: 1, reps: 6, load: 70, rir: 3 }] }),
    ];
    const meso = makeMesoState({ currentWeek: 3 });
    const result = evaluateSession(ex, sets, decliningSessions, meso);
    // With declining e1RM trend + hard sets > 0 (proxy for volume at MRV)
    expect(result.result).toBe('deload');
    expect(result.deloadReason).toBe('autoregulated');
  });

  it('does NOT trigger autoregulated deload with only 1 indicator', () => {
    const ex = makeExercise({ currentLoad: 60, loadIncrement: 2.5 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 2 },
      { setNumber: 2, reps: 8, load: 60, rir: 2 },
      { setNumber: 3, reps: 8, load: 60, rir: 2 },
    ];
    const meso = makeMesoState({ currentWeek: 3 });
    // Flat e1RM trend (no decline), no plateau, volume normal
    const flatSessions: SessionLog[] = [
      makeSession({ id: 's3', suggestedLoad: 60, date: '2025-01-19', sets: [{ setNumber: 1, reps: 8, load: 60, rir: 2 }] }),
      makeSession({ id: 's2', suggestedLoad: 60, date: '2025-01-26', sets: [{ setNumber: 1, reps: 8, load: 60, rir: 2 }] }),
      makeSession({ id: 's1', suggestedLoad: 60, date: '2025-02-02', sets: [{ setNumber: 1, reps: 8, load: 60, rir: 2 }] }),
    ];
    const result = evaluateSession(ex, sets, flatSessions, meso);
    expect(result.result).toBe('maintain');
  });

  it('single maintain session with reps increasing vs previous is NOT plateau', () => {
    const ex = makeExercise({ repsMin: 6, repsMax: 10 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 9, load: 60, rir: 2 },
      { setNumber: 2, reps: 9, load: 60, rir: 2 },
      { setNumber: 3, reps: 9, load: 60, rir: 2 },
    ];
    // Previous session had lower reps (accumulating)
    const prevSessions: SessionLog[] = [
      makeSession({
        id: 's2', suggestedLoad: 60, date: '2025-01-26',
        progressionResult: 'maintain',
        sets: [
          { setNumber: 1, reps: 7, load: 60, rir: 2 },
          { setNumber: 2, reps: 7, load: 60, rir: 2 },
          { setNumber: 3, reps: 7, load: 60, rir: 2 },
        ],
      }),
    ];
    const result = evaluateSession(ex, sets, prevSessions, makeMesoState({ currentWeek: 3 }));
    // Reps increasing (7→9), so should be increase or at least maintain, not deload
    expect(result.result).not.toBe('deload');
  });
});
