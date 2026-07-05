// ─── Core Domain Types ───────────────────────────────────────────────────────

export type BodyPart = 'upper' | 'lower' | 'core';

export type ProgressionResult = 'increase' | 'maintain' | 'deload';

export type ExerciseType = 'compound' | 'accessory';

export interface Exercise {
  id: string;
  name: string;
  bodyPart: BodyPart;
  muscleGroup: string;    // e.g. "Petto", "Dorso", "Gambe", "Spalle", "Braccia", "Core"
  type: ExerciseType;     // 'compound' (multi-joint/main) or 'accessory' (isolation/secondary)
  targetSets: number;
  repsMin: number;        // lower bound of rep range (e.g. 6)
  repsMax: number;        // upper bound of rep range (e.g. 10)
  currentLoad: number;    // kg
  loadIncrement: number;  // kg per session
  rirTarget: number | null; // target RIR, null = not tracked
  createdAt: string;      // ISO date
  order: number;          // display order
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
  setCount: number;
}

export interface MesocycleState {
  muscleGroup: string;
  currentWeek: number;               // 0-based
  mesocycleLengthWeeks: number;      // default: 5
  phase: 'accumulation' | 'deload';
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
  bodyPart: BodyPart;
  muscleGroup: string;
  type: ExerciseType;
  targetSets: number;
  repsMin: number;
  repsMax: number;
  currentLoad: number;
  loadIncrement: number;
  rirTarget: number | null;
}
