// ─── Core Domain Types ───────────────────────────────────────────────────────

export type ProgressionResult = 'increase' | 'maintain' | 'deload';

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  currentLoad: number;
  loadIncrement: number;
  rirTarget: number | null;
  createdAt: string;
  order: number;
}

export interface SetLog {
  setNumber: number;      // 1-based
  reps: number;
  load: number;           // kg used
  rir: number | null;     // perceived RIR, null = not logged
}

export interface SessionLog {
  id: string;
  exerciseId: string;
  date: string;                      // ISO date (YYYY-MM-DD)
  sets: SetLog[];
  progressionResult: ProgressionResult;
  suggestedLoad: number;             // load to use next session
  notes?: string;
}

// ─── Volume and Mesocycle Types ──────────────────────────────────────────────

export interface WeeklyVolumeLog {
  muscleGroup: string;
  weekStartDate: string;             // ISO date of Monday (YYYY-MM-DD)
  totalVolumeLoad: number;           // sum of (reps * load) for all sets
  effectiveVolumeLoad: number;       // RIR-weighted volume load
  setCount: number;
}

export interface MesocycleState {
  muscleGroup: string;
  currentWeek: number;               // 0-based
  mesocycleLengthWeeks: number;      // default: 5
  phase: 'accumulation' | 'deload';
  mev: number;                       // minimum effective volume (sets/week)
  mrv: number;                       // maximum recoverable volume (sets/week)
  lastUpdated: string;               // ISO date of last week change
}

// ─── App State ────────────────────────────────────────────────────────────────

export interface AppState {
  exercises: Exercise[];
  sessions: SessionLog[];
  mesocycleStates: MesocycleState[];
  weeklyVolumes: WeeklyVolumeLog[];
  lastUpdated: string;
}

// ─── Progression Engine ───────────────────────────────────────────────────────

export interface ProgressionEvaluation {
  result: ProgressionResult;
  suggestedLoad: number;
  reason: string;
}

// ─── UI Types ─────────────────────────────────────────────────────────────────

export type ActiveView = 'dashboard' | 'next-workout' | 'history' | 'exercises';

export interface ActiveSession {
  exerciseId: string;
  sets: SetLog[];
  startedAt: string;
}

// ─── Form Types ───────────────────────────────────────────────────────────────

export interface ExerciseFormData {
  name: string;
  muscleGroup: string;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  currentLoad: number;
  loadIncrement: number;
  rirTarget: number | null;
}
