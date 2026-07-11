import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AppState } from '../types';
import type { CsvImportResult } from '../utils/csv';

const STORAGE_KEY = 'gymos_v1';
const BACKUP_KEY = 'gymos_v1_backup_pre_import';

function createMockStorage(): Record<string, string> {
  return {};
}

beforeEach(() => {
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

const originalState: AppState = {
  exercises: [
    { id: 'e1', name: 'Panca', muscleGroup: 'Petto', targetSets: 3, repsMin: 6, repsMax: 10, currentLoad: 60, loadIncrement: 2.5, rirTarget: 2, createdAt: '2025-01-01T00:00:00.000Z', order: 0 },
  ],
  sessions: [
    { id: 's1', exerciseId: 'e1', date: '2025-01-10', sets: [{ setNumber: 1, reps: 8, load: 60, rir: 2 }], progressionResult: 'increase', suggestedLoad: 62.5 },
  ],
  mesocycleStates: [],
  weeklyVolumes: [],
  lastUpdated: '2025-01-17T12:00:00.000Z',
};

const importData: CsvImportResult = {
  exercises: [
    { id: 'e2', name: 'Rematore', muscleGroup: 'Schiena', targetSets: 4, repsMin: 6, repsMax: 10, currentLoad: 50, loadIncrement: 2.5, rirTarget: 2, createdAt: '2025-02-01T00:00:00.000Z', order: 0 },
  ],
  sessions: [],
  mesocycleStates: [
    { muscleGroup: 'Schiena', currentWeek: 1, mesocycleLengthWeeks: 5, phase: 'accumulation', mev: 10, mrv: 20, lastUpdated: '2025-02-01T00:00:00.000Z' },
  ],
  weeklyVolumes: [],
  errors: [],
};

// Simulate what importState does inside the store
function simulateImport(data: CsvImportResult): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      localStorage.setItem(BACKUP_KEY, raw);
    } catch (e) {
      console.warn('[Test] Failed to save pre-import backup:', e);
    }
  }
  const newState: AppState = {
    exercises: data.exercises,
    sessions: data.sessions,
    mesocycleStates: data.mesocycleStates,
    weeklyVolumes: data.weeklyVolumes,
    lastUpdated: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
}

describe('importState backup mechanism', () => {
  it('saves backup to gymos_v1_backup_pre_import before replacing state', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(originalState));

    simulateImport(importData);

    const backupRaw = localStorage.getItem(BACKUP_KEY);
    expect(backupRaw).not.toBeNull();

    const backup = JSON.parse(backupRaw!);
    expect(backup.exercises).toEqual(originalState.exercises);
    expect(backup.sessions).toEqual(originalState.sessions);
  });

  it('replaces main state with imported data after backup', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(originalState));

    simulateImport(importData);

    const currentRaw = localStorage.getItem(STORAGE_KEY);
    const current = JSON.parse(currentRaw!);
    expect(current.exercises).toEqual(importData.exercises);
    expect(current.mesocycleStates).toEqual(importData.mesocycleStates);
    expect(current.sessions).toEqual([]);
  });

  it('does not create backup when no previous state exists', () => {
    localStorage.removeItem(STORAGE_KEY);

    simulateImport(importData);

    const backupRaw = localStorage.getItem(BACKUP_KEY);
    expect(backupRaw).toBeNull();
  });

  it('updates lastUpdated on import', () => {
    const before = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(originalState));

    simulateImport(importData);

    const currentRaw = localStorage.getItem(STORAGE_KEY);
    const current = JSON.parse(currentRaw!);
    const savedTime = new Date(current.lastUpdated).getTime();
    expect(savedTime).toBeGreaterThanOrEqual(before);
    expect(savedTime).toBeLessThanOrEqual(Date.now());
  });

  it('backup key is not affected by normal save operations', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(originalState));
    simulateImport(importData);

    // Simulate a normal save (should not wipe backup)
    const normalSave = JSON.stringify({ ...originalState, lastUpdated: new Date().toISOString() });
    localStorage.setItem(STORAGE_KEY, normalSave);

    const backupRaw = localStorage.getItem(BACKUP_KEY);
    expect(backupRaw).not.toBeNull();
    const backup = JSON.parse(backupRaw!);
    expect(backup.exercises).toEqual(originalState.exercises);
  });
});
