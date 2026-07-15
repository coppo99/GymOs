import { describe, it, expect } from 'vitest';
import { estimateE1RM, calculateE1RMTrend, detectRirInconsistency, getVolumeThresholds, MUSCLE_GROUP_VOLUME_DEFAULTS, DEFAULT_FALLBACK_THRESHOLDS } from './metrics';

describe('estimateE1RM', () => {
  it('uses Epley on effective reps (reps + RIR)', () => {
    const result = estimateE1RM(100, 5, 3);
    // effectiveReps = 5+3 = 8; e1rm = 100 * (1 + 8/30) = 100 * 1.2667 = 126.67
    expect(result.effectiveReps).toBe(8);
    expect(result.value).toBeCloseTo(126.67, 0);
    expect(result.confidence).toBe('high');
  });

  it('falls back to raw reps when RIR is null', () => {
    const result = estimateE1RM(100, 5, null);
    expect(result.effectiveReps).toBe(5);
    expect(result.value).toBeCloseTo(116.67, 0);
    expect(result.confidence).toBe('low');
  });

  it('marks confidence low when effective reps > 12', () => {
    const result = estimateE1RM(100, 10, 5);
    expect(result.effectiveReps).toBe(15);
    expect(result.confidence).toBe('low');
  });

  it('handles edge case: 0 reps', () => {
    const result = estimateE1RM(100, 0, 2);
    expect(result.value).toBeCloseTo(100 * (1 + 2 / 30), 2);
    expect(result.effectiveReps).toBe(2);
  });

  it('handles 0 load', () => {
    const result = estimateE1RM(0, 10, 2);
    expect(result.value).toBe(0);
  });
});

describe('calculateE1RMTrend', () => {
  it('returns flat when fewer than 2 points', () => {
    const trend = calculateE1RMTrend([{ e1rm: { value: 100, confidence: 'high', effectiveReps: 8 }, date: '2025-01-01' }]);
    expect(trend.direction).toBe('flat');
    expect(trend.sampleConfidence).toBe('low');
  });

  it('detects upward trend', () => {
    const sessions = [
      { e1rm: { value: 100, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-01' },
      { e1rm: { value: 105, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-08' },
      { e1rm: { value: 110, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-15' },
    ];
    const trend = calculateE1RMTrend(sessions);
    expect(trend.direction).toBe('up');
    expect(trend.slope).toBeGreaterThan(0);
    expect(trend.sampleConfidence).toBe('high');
  });

  it('detects downward trend', () => {
    const sessions = [
      { e1rm: { value: 110, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-01' },
      { e1rm: { value: 105, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-08' },
      { e1rm: { value: 100, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-15' },
    ];
    const trend = calculateE1RMTrend(sessions);
    expect(trend.direction).toBe('down');
    expect(trend.slope).toBeLessThan(0);
    expect(trend.sampleConfidence).toBe('high');
  });

  it('marks sampleConfidence low when >50% points are low confidence', () => {
    const sessions = [
      { e1rm: { value: 100, confidence: 'low' as const, effectiveReps: 15 }, date: '2025-01-01' },
      { e1rm: { value: 105, confidence: 'low' as const, effectiveReps: 15 }, date: '2025-01-08' },
      { e1rm: { value: 110, confidence: 'high' as const, effectiveReps: 8 }, date: '2025-01-15' },
    ];
    const trend = calculateE1RMTrend(sessions);
    // 2 out of 3 are low → >50% → sampleConfidence 'low'
    expect(trend.sampleConfidence).toBe('low');
  });
});

describe('detectRirInconsistency', () => {
  it('detects RIR≤1 with reps≥repsMax (RIR understated)', () => {
    const result = detectRirInconsistency(
      [{ setNumber: 1, reps: 10, load: 60, rir: 1 }],
      6, 10
    );
    expect(result.inconsistent).toBe(true);
    expect(result.explanation).toContain('sottostimato');
  });

  it('detects RIR≥3 with reps<repsMin (RIR overstated)', () => {
    const result = detectRirInconsistency(
      [{ setNumber: 1, reps: 4, load: 60, rir: 3 }],
      6, 10
    );
    expect(result.inconsistent).toBe(true);
    expect(result.explanation).toContain('sovrastimato');
  });

  it('returns consistent when RIR aligns with performance', () => {
    const result = detectRirInconsistency(
      [{ setNumber: 1, reps: 8, load: 60, rir: 2 }],
      6, 10
    );
    expect(result.inconsistent).toBe(false);
    expect(result.explanation).toBeNull();
  });

  it('returns consistent when RIR is null', () => {
    const result = detectRirInconsistency(
      [{ setNumber: 1, reps: 8, load: 60, rir: null }],
      6, 10
    );
    expect(result.inconsistent).toBe(false);
  });
});

describe('getVolumeThresholds', () => {
  it('returns RP default for known muscle group', () => {
    const t = getVolumeThresholds('chest');
    expect(t.mev).toBe(6);
    expect(t.mrv).toBe(22);
    expect(t.source).toBe('rp_framework_approximate');
  });

  it('returns generic fallback for unknown group', () => {
    const t = getVolumeThresholds('forearms');
    expect(t.source).toBe('generic_fallback');
    expect(t.mev).toBe(6);
    expect(t.mrv).toBe(20);
  });

  it('is case-insensitive and handles spaces', () => {
    const t = getVolumeThresholds('Side Rear Delts');
    expect(t.mev).toBe(8);
    expect(t.mrv).toBe(26);
  });
});
