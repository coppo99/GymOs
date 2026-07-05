import type { AppState } from '../types';

const STORAGE_KEY = 'gymos_v1';

const DEFAULT_STATE: AppState = {
  exercises: [],
  sessions: [],
  mesocycleStates: [],
  weeklyVolumes: [],
  lastUpdated: new Date().toISOString(),
};

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw) as AppState;
    // Ensure all required fields exist (backwards compat)
    return {
      exercises: parsed.exercises ?? [],
      sessions: parsed.sessions ?? [],
      mesocycleStates: parsed.mesocycleStates ?? [],
      weeklyVolumes: parsed.weeklyVolumes ?? [],
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    };
  } catch {
    console.warn('[GymOS] Failed to load state from localStorage, using default.');
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState(state: AppState): void {
  try {
    const toSave: AppState = { ...state, lastUpdated: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.error('[GymOS] Failed to save state:', e);
  }
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Generate a simple unique ID */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Return today's date as YYYY-MM-DD */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
