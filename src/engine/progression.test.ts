import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  calculateEffectiveVolume,
  effortFactorForRir,
  calculateVolumeLoad,
  evaluateSession,
  calculateSlope,
  detectPlateau,
  getNextSessionLoad,
  validateSetValues,
  roundToIncrement,
  getVolumeStatus,
  getDeloadTargetSets,
  adjustLoadForNextSet,
  DEFAULT_MEV,
  DEFAULT_MRV,
} from './progression';
import type { Exercise, SetLog, SessionLog, MesocycleState, ProgressionEvaluation } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    progressionResult: 'increase',
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
    mev: DEFAULT_MEV,
    mrv: DEFAULT_MRV,
    lastUpdated: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Effective Volume with RIR Coefficient
// ══════════════════════════════════════════════════════════════════════════════

describe('effortFactorForRir', () => {
  it('returns 1.0 for RIR 0 (failure)', () => {
    expect(effortFactorForRir(0)).toBe(1.0);
  });

  it('returns 1.0 for RIR 1', () => {
    expect(effortFactorForRir(1)).toBe(1.0);
  });

  it('returns 0.85 for RIR 2 and 3', () => {
    expect(effortFactorForRir(2)).toBe(0.85);
    expect(effortFactorForRir(3)).toBe(0.85);
  });

  it('returns 0.6 for RIR 4+', () => {
    expect(effortFactorForRir(4)).toBe(0.6);
    expect(effortFactorForRir(5)).toBe(0.6);
    expect(effortFactorForRir(10)).toBe(0.6);
  });

  it('returns 0.75 for null RIR (conservative default)', () => {
    expect(effortFactorForRir(null)).toBe(0.75);
  });
});

describe('calculateEffectiveVolume', () => {
  it('matches raw volume when all sets are RIR 0-1', () => {
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 0 },
      { setNumber: 2, reps: 7, load: 60, rir: 1 },
    ];
    const raw = calculateVolumeLoad(sets); // 8*60 + 7*60 = 900
    const effective = calculateEffectiveVolume(sets);
    expect(effective).toBe(raw); // each set has factor 1.0
  });

  it('applies 0.85 factor for RIR 2-3 sets', () => {
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 50, rir: 2 },
    ];
    const expected = 10 * 50 * 0.85;
    expect(calculateEffectiveVolume(sets)).toBe(expected);
  });

  it('applies 0.6 factor for RIR 4+ sets', () => {
    const sets: SetLog[] = [
      { setNumber: 1, reps: 12, load: 40, rir: 5 },
    ];
    const expected = 12 * 40 * 0.6;
    expect(calculateEffectiveVolume(sets)).toBe(expected);
  });

  it('applies 0.75 factor for sets without RIR logged', () => {
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 50, rir: null },
    ];
    const expected = 10 * 50 * 0.75;
    expect(calculateEffectiveVolume(sets)).toBe(expected);
  });

  it('handles mixed RIR values correctly', () => {
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 1 },    // factor 1.0  → 480
      { setNumber: 2, reps: 8, load: 60, rir: 3 },    // factor 0.85 → 408
      { setNumber: 3, reps: 6, load: 60, rir: 5 },    // factor 0.6  → 216
    ];
    const raw = calculateVolumeLoad(sets); // (8+8+6)*60 = 1320
    const effective = calculateEffectiveVolume(sets); // 480+408+216 = 1104
    expect(effective).toBe(1104);
    expect(effective).toBeLessThan(raw);
  });

  it('returns 0 for empty sets', () => {
    expect(calculateEffectiveVolume([])).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Deload Trigger at End of Mesocycle
// ══════════════════════════════════════════════════════════════════════════════

describe('evaluateSession — deload phase', () => {
  it('returns deload result when mesocycle phase is deload, regardless of performance', () => {
    const exercise = makeExercise({ currentLoad: 100, loadIncrement: 2.5 });
    // Even a perfect session should still trigger deload
    const sets: SetLog[] = [
      { setNumber: 1, reps: 12, load: 100, rir: 0 },
      { setNumber: 2, reps: 12, load: 100, rir: 0 },
      { setNumber: 3, reps: 12, load: 100, rir: 0 },
    ];
    const meso = makeMesoState({ phase: 'deload' });
    const result = evaluateSession(exercise, sets, [], meso);
    expect(result.result).toBe('deload');
    expect(result.suggestedLoad).toBe(90); // 100 * 0.9
  });

  it('deload reduces load to 90% rounded to nearest increment', () => {
    const exercise = makeExercise({ currentLoad: 80, loadIncrement: 2.5 });
    const meso = makeMesoState({ phase: 'deload' });
    const result = evaluateSession(exercise, [makeSet()], [], meso);
    // 80 * 0.9 = 72; roundToIncrement(72, 2.5) = 72.5
    expect(result.suggestedLoad).toBe(72.5);
  });

  it('deload load never falls below loadIncrement', () => {
    const exercise = makeExercise({ currentLoad: 1, loadIncrement: 2.5 });
    const meso = makeMesoState({ phase: 'deload' });
    const result = evaluateSession(exercise, [makeSet()], [], meso);
    expect(result.suggestedLoad).toBeGreaterThanOrEqual(2.5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Plateau Detection via Linear Regression
// ══════════════════════════════════════════════════════════════════════════════

describe('calculateSlope', () => {
  it('returns positive slope for increasing values', () => {
    const values = [50, 52.5, 55, 57.5, 60];
    expect(calculateSlope(values)).toBeGreaterThan(0);
  });

  it('returns negative slope for decreasing values', () => {
    const values = [60, 57.5, 55, 52.5, 50];
    expect(calculateSlope(values)).toBeLessThan(0);
  });

  it('returns ~0 for flat/no-growth values', () => {
    const values = [50, 50, 50, 50, 50];
    const slope = calculateSlope(values);
    expect(slope).toBeCloseTo(0, 5);
  });

  it('returns 0 for fewer than 2 points', () => {
    expect(calculateSlope([42])).toBe(0);
    expect(calculateSlope([])).toBe(0);
  });
});

describe('detectPlateau', () => {
  it('detects plateau when load slope is flat (no growth over 6 sessions)', () => {
    const ex = makeExercise();
    const sessions: SessionLog[] = Array.from({ length: 6 }, (_, i) => ({
      id: `s-${i}`,
      exerciseId: 'ex-1',
      date: `2025-01-${String(10 + i).padStart(2, '0')}`,
      sets: [makeSet({ reps: 8, load: 60 })],
      progressionResult: 'maintain' as const,
      suggestedLoad: 60,
    }));
    const result = detectPlateau(ex, sessions);
    expect(result.isPlateau).toBe(true);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('returns no plateau when load is clearly increasing', () => {
    const ex = makeExercise();
    const sessions: SessionLog[] = Array.from({ length: 6 }, (_, i) => ({
      id: `s-${i}`,
      exerciseId: 'ex-1',
      date: `2025-01-${String(10 + i).padStart(2, '0')}`,
      sets: [makeSet({ reps: 10, load: 60 + i * 2.5 })],
      progressionResult: 'increase' as const,
      suggestedLoad: 60 + i * 2.5,
    }));
    const result = detectPlateau(ex, sessions);
    expect(result.isPlateau).toBe(false);
  });

  it('returns no plateau with fewer than 4 sessions (insufficient data)', () => {
    const ex = makeExercise();
    const sessions: SessionLog[] = Array.from({ length: 3 }, (_, i) => ({
      id: `s-${i}`,
      exerciseId: 'ex-1',
      date: `2025-01-${String(10 + i).padStart(2, '0')}`,
      sets: [makeSet()],
      progressionResult: 'maintain' as const,
      suggestedLoad: 60,
    }));
    const result = detectPlateau(ex, sessions);
    expect(result.isPlateau).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Intra-Session RIR Modulation
// ══════════════════════════════════════════════════════════════════════════════

describe('evaluateSession — RIR modulation', () => {
  it('returns increase when RIR is well above target (easy session)', () => {
    const ex = makeExercise({ rirTarget: 2, repsMax: 10, repsMin: 6 });
    // Average RIR = 4, target = 2, diff = +2 → increase
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 4 },
      { setNumber: 2, reps: 8, load: 60, rir: 4 },
      { setNumber: 3, reps: 8, load: 60, rir: 4 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('increase');
    expect(result.suggestedLoad).toBeGreaterThan(ex.currentLoad);
  });

  it('returns increase when all sets hit repsMax and RIR meets target', () => {
    const ex = makeExercise({ rirTarget: 2, repsMax: 10, repsMin: 6 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 60, rir: 2 },
      { setNumber: 2, reps: 10, load: 60, rir: 2 },
      { setNumber: 3, reps: 10, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('increase');
  });

  it('returns maintain when RIR is below target (too hard)', () => {
    const ex = makeExercise({ rirTarget: 2, repsMax: 10, repsMin: 6 });
    // RIR = 0, much lower than target 2 → maintain (too hard)
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 0 },
      { setNumber: 2, reps: 8, load: 60, rir: 0 },
      { setNumber: 3, reps: 8, load: 60, rir: 0 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
  });

  it('returns maintain when not all target sets are completed', () => {
    const ex = makeExercise({ targetSets: 3 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 60, rir: 1 },
      { setNumber: 2, reps: 10, load: 60, rir: 1 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
  });

  it('returns maintain when all reps are below the minimum', () => {
    const ex = makeExercise({ repsMin: 6, repsMax: 10 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 4, load: 60, rir: 2 },
      { setNumber: 2, reps: 4, load: 60, rir: 2 },
      { setNumber: 3, reps: 4, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
  });

  it('progression is suggested at loadIncrement increments', () => {
    const ex = makeExercise({ loadIncrement: 5, repsMax: 10, repsMin: 6 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 10, load: 60, rir: 2 },
      { setNumber: 2, reps: 10, load: 60, rir: 2 },
      { setNumber: 3, reps: 10, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('increase');
    expect(result.suggestedLoad).toBe(65); // 60 + 5
  });

  it('defaults to maintain when reps are within range and RIR is on target', () => {
    const ex = makeExercise({ repsMin: 6, repsMax: 10, rirTarget: 2 });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: 2 },
      { setNumber: 2, reps: 8, load: 60, rir: 2 },
      { setNumber: 3, reps: 8, load: 60, rir: 2 },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
  });

  it('returns maintain by default when no RIR data is available', () => {
    const ex = makeExercise({ rirTarget: null });
    const sets: SetLog[] = [
      { setNumber: 1, reps: 8, load: 60, rir: null },
      { setNumber: 2, reps: 8, load: 60, rir: null },
      { setNumber: 3, reps: 8, load: 60, rir: null },
    ];
    const result = evaluateSession(ex, sets, [], makeMesoState());
    expect(result.result).toBe('maintain');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Validation — Anomalous Inputs
// ══════════════════════════════════════════════════════════════════════════════

describe('validateSetValues', () => {
  it('returns no warnings for normal values (reps=10, load=60, RIR=2)', () => {
    const w = validateSetValues(10, 60, 2);
    expect(w.reps).toBeUndefined();
    expect(w.load).toBeUndefined();
    expect(w.rir).toBeUndefined();
  });

  it('warns on very low reps (< 3)', () => {
    const w = validateSetValues(1, 60, 2);
    expect(w.reps).toBeDefined();
  });

  it('warns on very high reps (> 25)', () => {
    const w = validateSetValues(30, 60, 2);
    expect(w.reps).toBeDefined();
  });

  it('does not warn on reps=3 or reps=25 (boundaries)', () => {
    expect(validateSetValues(3, 60, 2).reps).toBeUndefined();
    expect(validateSetValues(25, 60, 2).reps).toBeUndefined();
  });

  it('warns on very low load (< 1 kg)', () => {
    const w = validateSetValues(10, 0.5, 2);
    expect(w.load).toBeDefined();
  });

  it('warns on very high load (> 300 kg)', () => {
    const w = validateSetValues(10, 350, 2);
    expect(w.load).toBeDefined();
  });

  it('does not warn on normal loads (1–300 kg)', () => {
    expect(validateSetValues(10, 1, 2).load).toBeUndefined();
    expect(validateSetValues(10, 300, 2).load).toBeUndefined();
    expect(validateSetValues(10, 150, 2).load).toBeUndefined();
  });

  it('warns on RIR > 5', () => {
    const w = validateSetValues(10, 60, 7);
    expect(w.rir).toBeDefined();
  });

  it('warns on negative RIR', () => {
    const w = validateSetValues(10, 60, -1);
    expect(w.rir).toBeDefined();
  });

  it('does not warn on RIR 0–5', () => {
    expect(validateSetValues(10, 60, 0).rir).toBeUndefined();
    expect(validateSetValues(10, 60, 3).rir).toBeUndefined();
    expect(validateSetValues(10, 60, 5).rir).toBeUndefined();
  });

  it('handles null RIR without warning', () => {
    const w = validateSetValues(10, 60, null);
    expect(w.rir).toBeUndefined();
    expect(Object.keys(w).length).toBe(0);
  });

  it('does not crash on zero reps', () => {
    const w = validateSetValues(0, 60, 2);
    expect(typeof w).toBe('object');
  });

  it('does not crash on zero load', () => {
    const w = validateSetValues(10, 0, 2);
    expect(typeof w).toBe('object');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. RoundToIncrement
// ══════════════════════════════════════════════════════════════════════════════

describe('roundToIncrement', () => {
  it('rounds 61.2 to 60 at increment 2.5', () => {
    expect(roundToIncrement(61.2, 2.5)).toBe(60);
  });

  it('rounds 61.3 to 62.5 at increment 2.5', () => {
    expect(roundToIncrement(61.3, 2.5)).toBe(62.5);
  });

  it('rounds 43 to 45 at increment 5', () => {
    expect(roundToIncrement(43, 5)).toBe(45);
  });

  it('rounds 42 to 40 at increment 5', () => {
    expect(roundToIncrement(42, 5)).toBe(40);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. getNextSessionLoad
// ══════════════════════════════════════════════════════════════════════════════

describe('getNextSessionLoad', () => {
  it('returns currentLoad when no last session', () => {
    expect(getNextSessionLoad(makeExercise({ currentLoad: 60 }), undefined)).toBe(60);
  });

  it('returns suggestedLoad from last session when available', () => {
    const lastSession = makeSession({ suggestedLoad: 62.5 });
    expect(getNextSessionLoad(makeExercise({ currentLoad: 60 }), lastSession)).toBe(62.5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. getVolumeStatus
// ══════════════════════════════════════════════════════════════════════════════

describe('getVolumeStatus', () => {
  it('returns "low" when set count is below MEV', () => {
    expect(getVolumeStatus(4, 6, 25)).toBe('low');
  });

  it('returns "optimal" when set count is between 10 and 20', () => {
    expect(getVolumeStatus(15, 6, 25)).toBe('optimal');
  });

  it('returns "caution" when set count is above 20 but at or below MRV', () => {
    expect(getVolumeStatus(22, 6, 25)).toBe('caution');
  });

  it('returns "overreaching" when set count exceeds MRV', () => {
    expect(getVolumeStatus(26, 6, 25)).toBe('overreaching');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Property-Based: calculateSlope with random monotonic sequences
// ══════════════════════════════════════════════════════════════════════════════

describe('calculateSlope (property-based)', () => {
  it('returns positive slope for strictly increasing sequences', () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: 1, max: 200, noNaN: true }), { minLength: 2, maxLength: 20 }), (base) => {
        // Build a strictly increasing sequence
        const sorted = [...base].sort((a, b) => a - b);
        const slope = calculateSlope(sorted);
        expect(slope).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it('returns negative slope for strictly decreasing sequences', () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: 1, max: 200, noNaN: true }), { minLength: 2, maxLength: 20 }), (base) => {
        const sorted = [...base].sort((a, b) => b - a);
        const slope = calculateSlope(sorted);
        expect(slope).toBeLessThanOrEqual(0);
      })
    );
  });

  it('returns ~0 for constant sequences', () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 500, noNaN: true }), (val) => {
        const seq = Array.from({ length: 5 }, () => val);
        expect(calculateSlope(seq)).toBeCloseTo(0, 5);
      })
    );
  });

  it('never crashes on random arrays of any length (including 0, 1, or huge values)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -1e6, max: 1e6, noNaN: true }), { minLength: 0, maxLength: 100 }),
        (values) => {
          const slope = calculateSlope(values);
          expect(typeof slope).toBe('number');
          expect(Number.isNaN(slope)).toBe(false);
        }
      )
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. getDeloadTargetSets
// ══════════════════════════════════════════════════════════════════════════════

describe('getDeloadTargetSets', () => {
  // Inputs 1‑6: exhaustive to document low-volume integer constraints
  // Refer to the doc comment in progression.ts for the full table.

  it('n=1 → 1 (floor guard: 0% reduction, can\'t go below 1 set)', () => {
    expect(getDeloadTargetSets(1)).toBe(1);
  });

  it('n=2 → 1 (50% reduction, within 40‑50% range)', () => {
    expect(getDeloadTargetSets(2)).toBe(1);
  });

  it('n=3 → 2 (33% reduction — no integer in [1.5, 1.8], unavoidable)', () => {
    expect(getDeloadTargetSets(3)).toBe(2);
  });

  it('n=4 → 2 (50% reduction, within 40‑50% range)', () => {
    expect(getDeloadTargetSets(4)).toBe(2);
  });

  it('n=5 → 3 (40% reduction, within 40‑50% range)', () => {
    expect(getDeloadTargetSets(5)).toBe(3);
  });

  it('n=6 → 3 (50% reduction, clamped from round(3.6)=4 to 3)', () => {
    expect(getDeloadTargetSets(6)).toBe(3);
  });

  it('n=10 → 6 (40% reduction)', () => {
    expect(getDeloadTargetSets(10)).toBe(6);
  });

  it('n=15 → 9 (40% reduction)', () => {
    expect(getDeloadTargetSets(15)).toBe(9);
  });

  it('n=0 → 1 (floor guard)', () => {
    expect(getDeloadTargetSets(0)).toBe(1);
  });

  // ── Regression guard: reduction percentage must stay ≥ 35% for n ≥ 4 ──

  it('GUARD: reduction does NOT fall below 35% for any input n ≥ 4', () => {
    for (let n = 4; n <= 30; n++) {
      const result = getDeloadTargetSets(n);
      const reduction = (n - result) / n;
      expect(
        reduction,
        `n=${n}: result=${result}, reduction=${(reduction * 100).toFixed(1)}%`
      ).toBeGreaterThanOrEqual(0.35);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. adjustLoadForNextSet (intra-session RIR modulation)
// ══════════════════════════════════════════════════════════════════════════════

describe('adjustLoadForNextSet', () => {
  // ── |diff| = 2 → 5% adjustment (symmetric) ────────────────────────────

  it('returns 5% reduction when RIR=0 and target=2 (|diff|=2 below)', () => {
    const result = adjustLoadForNextSet(100, 0, 2, 2.5);
    expect(result.suggestedLoad).toBe(95); // 100 * 0.95
    expect(result.feedback).toContain('ridotto');
  });

  it('returns 5% reduction when RIR=1 and target=3 (|diff|=2 below)', () => {
    const result = adjustLoadForNextSet(100, 1, 3, 2.5);
    expect(result.suggestedLoad).toBe(95); // 100 * 0.95
    expect(result.feedback).toContain('ridotto');
  });

  it('returns 5% increase when RIR=4 and target=2 (|diff|=2 above)', () => {
    const result = adjustLoadForNextSet(100, 4, 2, 2.5);
    expect(result.suggestedLoad).toBe(105); // 100 * 1.05
    expect(result.feedback).toContain('aumentato');
  });

  it('symmetric: same |diff|=2 gives same magnitude both directions', () => {
    // diff=-2 (RIR=0 target=2) → 5% reduction
    const below = adjustLoadForNextSet(100, 0, 2, 1);
    expect(below.suggestedLoad).toBe(95);
    // diff=+2 (RIR=4 target=2) → 5% increase
    const above = adjustLoadForNextSet(100, 4, 2, 1);
    expect(above.suggestedLoad).toBe(105);
  });

  // ── |diff| >= 3 → 10% adjustment (symmetric) ──────────────────────────

  it('returns 10% reduction when RIR=0 and target=3 (|diff|=3 below)', () => {
    const result = adjustLoadForNextSet(100, 0, 3, 2.5);
    expect(result.suggestedLoad).toBe(90); // 100 * 0.9
    expect(result.feedback).toContain('ridotto');
  });

  it('returns 10% increase when RIR=5 and target=2 (|diff|=3 above)', () => {
    const result = adjustLoadForNextSet(100, 5, 2, 2.5);
    expect(result.suggestedLoad).toBe(110); // 100 * 1.1
    expect(result.feedback).toContain('aumentato');
  });

  it('symmetric: same |diff|=3 gives same magnitude both directions', () => {
    // diff=-3 (RIR=0 target=3) → 10% reduction
    const below = adjustLoadForNextSet(100, 0, 3, 1);
    expect(below.suggestedLoad).toBe(90);
    // diff=+3 (RIR=5 target=2) → 10% increase
    const above = adjustLoadForNextSet(100, 5, 2, 1);
    expect(above.suggestedLoad).toBe(110);
  });

  // ── |diff| <= 1 → no change ────────────────────────────────────────────

  it('returns no change when RIR equals target', () => {
    const result = adjustLoadForNextSet(100, 2, 2, 2.5);
    expect(result.suggestedLoad).toBe(100);
    expect(result.feedback).toBeNull();
  });

  it('returns no change when RIR is within ±1 of target', () => {
    expect(adjustLoadForNextSet(100, 1, 2, 2.5).feedback).toBeNull();
    expect(adjustLoadForNextSet(100, 3, 2, 2.5).feedback).toBeNull();
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it('floors load at loadIncrement for tiny loads', () => {
    const result = adjustLoadForNextSet(1, 0, 2, 2.5);
    expect(result.suggestedLoad).toBeGreaterThanOrEqual(2.5);
  });

  it('rounds to nearest increment with 10% adjustment', () => {
    const result = adjustLoadForNextSet(60, 5, 2, 2.5);
    // |diff|=3 → 10% increase → 60 * 1.1 = 66; roundToIncrement(66, 2.5) = 65
    expect(result.suggestedLoad).toBe(65);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Integration: deload phase + RIR below target + set count near MRV
// ══════════════════════════════════════════════════════════════════════════════

describe('evaluateSession — integration: deload has priority', () => {
  it('returns deload even when RIR is below target and volume is near MRV', () => {
    const exercise = makeExercise({ currentLoad: 80, rirTarget: 2, targetSets: 15 });
    // RIR=0 (far below target, would normally → maintain because too hard)
    // 15 sets (within optimal range, would be fine normally)
    // But deload phase should override everything
    const sets: SetLog[] = Array.from({ length: 15 }, (_, i) => ({
      setNumber: i + 1,
      reps: 6,
      load: 80,
      rir: 0,
    }));
    const meso = makeMesoState({ phase: 'deload', mrv: 25 });

    const result = evaluateSession(exercise, sets, [], meso);

    // Deload has top priority regardless of RIR or volume
    expect(result.result).toBe('deload');
    // 80 * 0.9 = 72; roundToIncrement(72, 2.5) = 72.5
    expect(result.suggestedLoad).toBe(72.5);
  });

  it('returns deload even with perfect RIR and max reps', () => {
    const exercise = makeExercise({ currentLoad: 80, rirTarget: 2, repsMax: 10 });
    // Best possible performance: all sets at repsMax with RIR on target
    const sets: SetLog[] = Array.from({ length: 3 }, (_, i) => ({
      setNumber: i + 1,
      reps: 10,
      load: 80,
      rir: 2,
    }));
    const meso = makeMesoState({ phase: 'deload' });

    const result = evaluateSession(exercise, sets, [], meso);

    // Even a perfect session in deload phase → deload
    expect(result.result).toBe('deload');
    expect(result.reason).toContain('deload');
  });
});
