import { describe, it, expect } from 'vitest';
import { exportToCsv, importFromCsv } from './csv';
import type { AppState, Exercise, SessionLog, MesocycleState, WeeklyVolumeLog } from '../types';

function makeSampleState(): AppState {
  return {
    exercises: [
      {
        id: 'ex1', name: 'Panca Piana', muscleGroup: 'Petto',
        targetSets: 3, repsMin: 6, repsMax: 10,
        currentLoad: 60, loadIncrement: 2.5, rirTarget: 2,
        createdAt: '2025-01-01T00:00:00.000Z', order: 0,
      },
      {
        id: 'ex2', name: 'Pettorali è à ò ù ì', muscleGroup: 'Petto',
        targetSets: 4, repsMin: 8, repsMax: 12,
        currentLoad: 40, loadIncrement: 1.25, rirTarget: 1,
        createdAt: '2025-01-15T00:00:00.000Z', order: 1,
      },
    ],
    sessions: [
      {
        id: 's1', exerciseId: 'ex1', date: '2025-01-10',
        sets: [
          { setNumber: 1, reps: 8, load: 60, rir: 2 },
          { setNumber: 2, reps: 8, load: 62.5, rir: 1 },
        ],
        progressionResult: 'increase' as const, suggestedLoad: 62.5,
      },
      {
        id: 's2', exerciseId: 'ex1', date: '2025-01-17',
        sets: [{ setNumber: 1, reps: 7, load: 62.5, rir: 2 }],
        progressionResult: 'increase' as const, suggestedLoad: 65,
      },
      {
        id: 's3', exerciseId: 'ex2', date: '2025-01-12',
        sets: [
          { setNumber: 1, reps: 10, load: 40, rir: 1 },
          { setNumber: 2, reps: 9, load: 40, rir: 2 },
        ],
        progressionResult: 'maintain' as const, suggestedLoad: 40,
      },
    ],
    mesocycleStates: [
      {
        muscleGroup: 'Petto', currentWeek: 2, mesocycleLengthWeeks: 5,
        phase: 'accumulation' as const, mev: 12, mrv: 25,
        lastUpdated: '2025-01-17T00:00:00.000Z',
        deloadReason: null,
      },
    ],
    weeklyVolumes: [
      {
        muscleGroup: 'Petto', weekStartDate: '2025-01-13',
        totalVolumeLoad: 1000, hardSets: 5, setCount: 8,
      },
    ],
    lastUpdated: '2025-01-17T12:00:00.000Z',
  };
}

function compareAppState(
  original: AppState,
  reconstructed: { exercises: Exercise[]; sessions: SessionLog[]; mesocycleStates: MesocycleState[]; weeklyVolumes: WeeklyVolumeLog[] }
): void {
  expect(reconstructed.exercises).toEqual(original.exercises);
  expect(reconstructed.sessions).toEqual(original.sessions);
  expect(reconstructed.mesocycleStates).toEqual(original.mesocycleStates);
  expect(reconstructed.weeklyVolumes).toEqual(original.weeklyVolumes);
}

// ─── Round-trip ─────────────────────────────────────────────────────────────

describe('exportToCsv + importFromCsv round-trip', () => {
  it('reproduces exercises, sessions, mesocycles, volumes identically', () => {
    const original = makeSampleState();
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    compareAppState(original, result);
  });

  it('handles empty AppState', () => {
    const original: AppState = {
      exercises: [], sessions: [], mesocycleStates: [], weeklyVolumes: [],
      lastUpdated: '2025-01-01T00:00:00.000Z',
    };
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    compareAppState(original, result);
  });

  it('preserves rirTarget=null exercises', () => {
    const original = makeSampleState();
    original.exercises[0].rirTarget = null;
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].rirTarget).toBeNull();
  });

  it('preserves rir=null in sets', () => {
    const original = makeSampleState();
    original.sessions[0].sets[0].rir = null;
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.sessions[0].sets[0].rir).toBeNull();
  });
});

// ─── importFromCsv edge cases ───────────────────────────────────────────────

describe('importFromCsv', () => {
  it('parses comma inside quoted exercise name', () => {
    const original = makeSampleState();
    original.exercises[0].name = 'Panca, presa larga';
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].name).toBe('Panca, presa larga');
  });

  it('preserves accented Italian characters', () => {
    const original = makeSampleState();
    original.exercises[0].name = 'Pettorali è à ò ù ì';
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].name).toBe('Pettorali è à ò ù ì');
  });

  it('skips empty lines in the middle of the file', () => {
    const original = makeSampleState();
    const csv = exportToCsv(original);
    const lines = csv.split('\n');
    lines.splice(5, 0, '', '   ', '');
    const modified = lines.join('\n');
    const result = importFromCsv(modified);
    expect(result.errors).toEqual([]);
    compareAppState(original, result);
  });

  it('returns error for truncated file (incomplete last line)', () => {
    const csv = exportToCsv(makeSampleState());
    const lines = csv.split('\n');
    const exIdx = lines.findIndex(l => l.startsWith('ex'));
    lines[exIdx] = lines[exIdx].slice(0, Math.floor(lines[exIdx].length / 2));
    const truncated = lines.join('\n');
    const result = importFromCsv(truncated);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(() => importFromCsv(truncated)).not.toThrow();
  });

  it('handles missing MESOCYCLESTATES section gracefully', () => {
    const original = makeSampleState();
    const csv = exportToCsv(original);
    const lines = csv.split('\n').filter(l => !l.startsWith('# MESOCYCLESTATES'));
    const modified = lines.join('\n');
    const result = importFromCsv(modified);
    expect(result.mesocycleStates).toEqual([]);
    expect(result.exercises.length).toBeGreaterThan(0);
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.weeklyVolumes.length).toBeGreaterThan(0);
  });

  it('handles missing WEEKLYVOLUMES section gracefully', () => {
    const original = makeSampleState();
    const csv = exportToCsv(original);
    const lines = csv.split('\n').filter(l => !l.startsWith('# WEEKLYVOLUMES'));
    const modified = lines.join('\n');
    const result = importFromCsv(modified);
    expect(result.weeklyVolumes).toEqual([]);
  });

  it('returns error and empty data for empty string, no throw', () => {
    const result = importFromCsv('');
    expect(result.exercises).toEqual([]);
    expect(result.sessions).toEqual([]);
    expect(result.mesocycleStates).toEqual([]);
    expect(result.weeklyVolumes).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Nessun dato valido');
    expect(() => importFromCsv('')).not.toThrow();
  });

  it('returns error and empty data for completely invalid content, no throw', () => {
    const result = importFromCsv('not a csv file at all\nfoo,bar,baz');
    expect(result.exercises).toEqual([]);
    expect(result.sessions).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Nessun dato valido');
    expect(() => importFromCsv('totally random stuff')).not.toThrow();
  });

  it('handles quotes inside quoted field (double-double-quote)', () => {
    const original = makeSampleState();
    original.exercises[0].name = 'Panca "presa" larga';
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].name).toBe('Panca "presa" larga');
  });

  it('handles newline inside quoted field', () => {
    const original = makeSampleState();
    original.exercises[0].name = 'Panca\nPiana';
    const csv = exportToCsv(original);
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.exercises[0].name).toBe('Panca\nPiana');
  });

  it('reports error for row with too few columns', () => {
    const csv = '# EXERCISES\nid,name\n123,foo,bar\n';
    const result = importFromCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('expected 11 columns');
  });

  it('reports error for invalid number in a numeric field', () => {
    const original = makeSampleState();
    const csv = exportToCsv(original);
    const lines = csv.split('\n');
    const exIdx = lines.findIndex(l => l.startsWith('ex1'));
    lines[exIdx] = lines[exIdx].replace(',3,', ',abc,');
    const modified = lines.join('\n');
    const result = importFromCsv(modified);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('invalid number');
  });

  it('reports error for set referencing unknown sessionId', () => {
    const csv = '# SESSIONS\nid,exerciseId,date,progressionResult,suggestedLoad,notes\ns1,ex1,2025-01-01,increase,60,\n\n# SETS\nsessionId,setNumber,reps,load,rir\nunknown-session,1,10,60,2\n';
    const result = importFromCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('references unknown session');
  });
});

// ─── exportToCsv in isolation ───────────────────────────────────────────────

describe('exportToCsv', () => {
  it('produces valid CSV with section headers for empty state', () => {
    const state: AppState = {
      exercises: [], sessions: [], mesocycleStates: [], weeklyVolumes: [],
      lastUpdated: '2025-01-01T00:00:00.000Z',
    };
    const csv = exportToCsv(state);
    expect(csv).toContain('# GYMOS CSV v1');
    expect(csv).toContain('# EXERCISES');
    expect(csv).toContain('# SESSIONS');
    expect(csv).toContain('# SETS');
    expect(csv).toContain('# MESOCYCLESTATES');
    expect(csv).toContain('# WEEKLYVOLUMES');
    const result = importFromCsv(csv);
    expect(result.errors).toEqual([]);
  });

  it('preserves decimal values exactly', () => {
    const state = makeSampleState();
    state.exercises[0].currentLoad = 62.5;
    state.exercises[0].loadIncrement = 1.25;
    const csv = exportToCsv(state);
    expect(csv).toContain('62.5');
    expect(csv).toContain('1.25');
    const result = importFromCsv(csv);
    expect(result.exercises[0].currentLoad).toBe(62.5);
    expect(result.exercises[0].loadIncrement).toBe(1.25);
  });

  it('preserves negative or zero values', () => {
    const state = makeSampleState();
    state.exercises[0].order = 0;
    state.exercises[0].repsMin = 0;
    const csv = exportToCsv(state);
    const result = importFromCsv(csv);
    expect(result.exercises[0].order).toBe(0);
    expect(result.exercises[0].repsMin).toBe(0);
  });
});
