import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadState, saveState, clearState, generateId } from './storage';
import type { AppState } from '../types';

function createMockStorage(): Record<string, string> {
  return {};
}

const STORAGE_KEY = 'gymos_v1';

beforeAll(() => {
  const store = createMockStorage();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  });
});

beforeEach(() => {
  localStorage.clear();
});

const sampleState: AppState = {
  exercises: [
    { id: 'e1', name: 'Panca', muscleGroup: 'Petto', targetSets: 3, repsMin: 6, repsMax: 10, currentLoad: 60, loadIncrement: 2.5, rirTarget: 2, createdAt: '2025-01-01T00:00:00.000Z', order: 0 },
  ],
  sessions: [
    { id: 's1', exerciseId: 'e1', date: '2025-01-10', sets: [{ setNumber: 1, reps: 8, load: 60, rir: 2 }], progressionResult: 'increase', suggestedLoad: 62.5 },
  ],
  mesocycleStates: [
    { muscleGroup: 'Petto', currentWeek: 2, mesocycleLengthWeeks: 5, phase: 'accumulation', mev: 12, mrv: 25, lastUpdated: '2025-01-17T00:00:00.000Z' },
  ],
  weeklyVolumes: [
    { muscleGroup: 'Petto', weekStartDate: '2025-01-13', totalVolumeLoad: 500, effectiveVolumeLoad: 400, setCount: 4 },
  ],
  lastUpdated: '2025-01-17T12:00:00.000Z',
};

// ─── loadState ──────────────────────────────────────────────────────────────

describe('loadState', () => {
  it('returns default state when localStorage is empty', () => {
    const state = loadState();
    expect(state.exercises).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.mesocycleStates).toEqual([]);
    expect(state.weeklyVolumes).toEqual([]);
    expect(typeof state.lastUpdated).toBe('string');
  });

  it('returns default state when key is missing', () => {
    localStorage.removeItem(STORAGE_KEY);
    const state = loadState();
    expect(state.exercises).toEqual([]);
  });

  it('falls back to default when JSON is corrupted', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json{{{');
    const state = loadState();
    expect(state.exercises).toEqual([]);
    expect(state.sessions).toEqual([]);
  });

  it('does not throw on corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(() => loadState()).not.toThrow();
  });

  it('fills missing weeklyVolumes with empty array (backward compat)', () => {
    const partial = {
      exercises: sampleState.exercises,
      sessions: sampleState.sessions,
      mesocycleStates: sampleState.mesocycleStates,
      lastUpdated: sampleState.lastUpdated,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const state = loadState();
    expect(state.weeklyVolumes).toEqual([]);
    expect(state.exercises).toEqual(sampleState.exercises);
  });

  it('fills missing mesocycleStates with empty array', () => {
    const partial = {
      exercises: sampleState.exercises,
      sessions: sampleState.sessions,
      weeklyVolumes: sampleState.weeklyVolumes,
      lastUpdated: sampleState.lastUpdated,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const state = loadState();
    expect(state.mesocycleStates).toEqual([]);
    expect(state.exercises).toEqual(sampleState.exercises);
  });

  it('fills missing lastUpdated with current timestamp string', () => {
    const partial = {
      exercises: [],
      sessions: [],
      mesocycleStates: [],
      weeklyVolumes: [],
    } as any;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const state = loadState();
    expect(typeof state.lastUpdated).toBe('string');
    expect(state.lastUpdated.length).toBeGreaterThan(0);
  });

  it('returns valid data when localStorage contains well-formed state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleState));
    const state = loadState();
    expect(state.exercises).toEqual(sampleState.exercises);
    expect(state.sessions).toEqual(sampleState.sessions);
    expect(state.mesocycleStates).toEqual(sampleState.mesocycleStates);
    expect(state.weeklyVolumes).toEqual(sampleState.weeklyVolumes);
  });
});

// ─── saveState + loadState (round-trip) ─────────────────────────────────────

describe('saveState + loadState round-trip', () => {
  it('returns the same data after save then load', () => {
    saveState(sampleState);
    const loaded = loadState();
    expect(loaded.exercises).toEqual(sampleState.exercises);
    expect(loaded.sessions).toEqual(sampleState.sessions);
    expect(loaded.mesocycleStates).toEqual(sampleState.mesocycleStates);
    expect(loaded.weeklyVolumes).toEqual(sampleState.weeklyVolumes);
  });

  it('overwrites previous data on second save', () => {
    const state1: AppState = { ...sampleState, lastUpdated: '2025-01-01T00:00:00.000Z' };
    const state2: AppState = { ...sampleState, lastUpdated: '2025-01-02T00:00:00.000Z' };
    state2.exercises = [];
    saveState(state1);
    saveState(state2);
    const loaded = loadState();
    expect(loaded.exercises).toEqual([]);
  });

  it('updates lastUpdated on each save', () => {
    const before = Date.now();
    saveState(sampleState);
    const after = Date.now();
    const loaded = loadState();
    const savedTime = new Date(loaded.lastUpdated).getTime();
    expect(savedTime).toBeGreaterThanOrEqual(before);
    expect(savedTime).toBeLessThanOrEqual(after);
  });
});

// ─── clearState ─────────────────────────────────────────────────────────────

describe('clearState', () => {
  it('removes the gymos_v1 key from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleState));
    clearState();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not throw when nothing to clear', () => {
    expect(() => clearState()).not.toThrow();
  });
});

// ─── generateId ─────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('produces unique IDs over 1000 consecutive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });

  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
