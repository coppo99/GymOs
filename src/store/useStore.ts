import { useState, useCallback } from 'react';
import type {
  AppState,
  Exercise,
  SessionLog,
  SetLog,
  ExerciseFormData,
  MesocycleState,
  WeeklyVolumeLog,
} from '../types';
import { loadState, saveState, generateId, todayIso } from '../utils/storage';
import {
  evaluateSession,
  getDefaultLoadIncrement,
  getDefaultMuscleGroup,
  calculateVolumeLoad,
} from '../engine/progression';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MESO_LENGTH = 5; // 4 weeks accumulation, 1 week deload

// ─── Default Template (Push/Pull/Legs) for First-Time Experience ──────────────

const DEFAULT_TEMPLATE_EXERCISES = [
  // ─── Push Day Esercizi ───
  {
    name: 'Panca Piana Bilanciere',
    bodyPart: 'upper' as const,
    muscleGroup: 'Petto',
    type: 'compound' as const,
    targetSets: 3,
    repsMin: 6,
    repsMax: 10,
    currentLoad: 60,
    loadIncrement: 2.5,
    rirTarget: 2,
  },
  {
    name: 'Military Press Bilanciere',
    bodyPart: 'upper' as const,
    muscleGroup: 'Spalle',
    type: 'compound' as const,
    targetSets: 3,
    repsMin: 6,
    repsMax: 10,
    currentLoad: 35,
    loadIncrement: 2.5,
    rirTarget: 2,
  },
  {
    name: 'Alzate Laterali Manubri',
    bodyPart: 'upper' as const,
    muscleGroup: 'Spalle',
    type: 'accessory' as const,
    targetSets: 3,
    repsMin: 10,
    repsMax: 15,
    currentLoad: 10,
    loadIncrement: 1.25,
    rirTarget: 1,
  },
  {
    name: 'Pushdown Tricipiti Cavo',
    bodyPart: 'upper' as const,
    muscleGroup: 'Braccia',
    type: 'accessory' as const,
    targetSets: 3,
    repsMin: 10,
    repsMax: 15,
    currentLoad: 20,
    loadIncrement: 2.5,
    rirTarget: 1,
  },
  // ─── Pull Day Esercizi ───
  {
    name: 'Trazioni alla Sbarra',
    bodyPart: 'upper' as const,
    muscleGroup: 'Dorso',
    type: 'compound' as const,
    targetSets: 3,
    repsMin: 6,
    repsMax: 10,
    currentLoad: 0, // bodyweight default
    loadIncrement: 2.5,
    rirTarget: 2,
  },
  {
    name: 'Pulley Basso Cavo',
    bodyPart: 'upper' as const,
    muscleGroup: 'Dorso',
    type: 'accessory' as const,
    targetSets: 3,
    repsMin: 8,
    repsMax: 12,
    currentLoad: 45,
    loadIncrement: 2.5,
    rirTarget: 2,
  },
  {
    name: 'Curl Alternato Manubri',
    bodyPart: 'upper' as const,
    muscleGroup: 'Braccia',
    type: 'accessory' as const,
    targetSets: 3,
    repsMin: 10,
    repsMax: 15,
    currentLoad: 12,
    loadIncrement: 1.25,
    rirTarget: 1,
  },
  // ─── Legs Day Esercizi ───
  {
    name: 'Squat Bilanciere',
    bodyPart: 'lower' as const,
    muscleGroup: 'Gambe',
    type: 'compound' as const,
    targetSets: 3,
    repsMin: 6,
    repsMax: 10,
    currentLoad: 70,
    loadIncrement: 5.0,
    rirTarget: 2,
  },
  {
    name: 'Leg Curl Seduto',
    bodyPart: 'lower' as const,
    muscleGroup: 'Gambe',
    type: 'accessory' as const,
    targetSets: 3,
    repsMin: 10,
    repsMax: 15,
    currentLoad: 30,
    loadIncrement: 2.5,
    rirTarget: 1,
  },
  {
    name: 'Calf Raise In Piedi',
    bodyPart: 'lower' as const,
    muscleGroup: 'Gambe',
    type: 'accessory' as const,
    targetSets: 3,
    repsMin: 12,
    repsMax: 15,
    currentLoad: 40,
    loadIncrement: 2.5,
    rirTarget: 1,
  },
];

// ─── Helpers for Migration & Initialization ──────────────────────────────────

function initializeMissingStates(state: AppState): AppState {
  let modified = false;

  // 1. Ensure all exercises have a muscleGroup and type
  let exercises = state.exercises ? [...state.exercises] : [];
  exercises = exercises.map((ex) => {
    let updatedEx = { ...ex };
    let itemModified = false;

    if (!ex.muscleGroup) {
      updatedEx.muscleGroup = getDefaultMuscleGroup(ex.bodyPart);
      itemModified = true;
    }
    if (!ex.type) {
      updatedEx.type = 'compound';
      itemModified = true;
    }

    if (itemModified) {
      modified = true;
    }
    return updatedEx;
  });

  // Collect unique muscle groups
  const muscleGroups = Array.from(new Set(exercises.map((e) => e.muscleGroup)));

  // 2. Ensure mesocycleStates exist for all muscle groups
  const mesocycleStates = state.mesocycleStates ? [...state.mesocycleStates] : [];
  muscleGroups.forEach((group) => {
    const exists = mesocycleStates.some(
      (m) => m.muscleGroup.toLowerCase() === group.toLowerCase()
    );
    if (!exists) {
      modified = true;
      mesocycleStates.push({
        muscleGroup: group,
        currentWeek: 0,
        mesocycleLengthWeeks: DEFAULT_MESO_LENGTH,
        phase: 'accumulation',
        lastUpdated: new Date().toISOString(),
      });
    }
  });

  // 3. Ensure weeklyVolumes log is initialized
  const weeklyVolumes = state.weeklyVolumes ?? [];
  if (!state.weeklyVolumes) {
    modified = true;
  }

  // 4. Calendar-based Mesocycle week increment check
  const now = new Date();
  const updatedMesoStates = mesocycleStates.map((meso) => {
    const lastUpdate = new Date(meso.lastUpdated);
    const msDiff = now.getTime() - lastUpdate.getTime();
    const daysDiff = msDiff / (1000 * 60 * 60 * 24);

    if (daysDiff >= 7) {
      modified = true;
      const nextWeek = meso.currentWeek + 1;
      const length = meso.mesocycleLengthWeeks;

      let nextPhase: 'accumulation' | 'deload' = 'accumulation';
      let finalWeek = nextWeek;

      if (nextWeek === length - 1) {
        nextPhase = 'deload';
      } else if (nextWeek >= length) {
        finalWeek = 0;
        nextPhase = 'accumulation';
      } else {
        nextPhase = meso.phase;
      }

      return {
        ...meso,
        currentWeek: finalWeek,
        phase: nextPhase,
        lastUpdated: now.toISOString(),
      };
    }
    return meso;
  });

  if (modified) {
    const nextState = {
      ...state,
      exercises,
      mesocycleStates: updatedMesoStates,
      weeklyVolumes,
      lastUpdated: now.toISOString(),
    };
    saveState(nextState);
    return nextState;
  }

  return state;
}

// ─── Store Hook ───────────────────────────────────────────────────────────────

function useStore() {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadState();
    return initializeMissingStates(loaded);
  });

  // Persist and re-render
  const update = useCallback((updater: (prev: AppState) => AppState) => {
    setState((prev) => {
      const next = updater(prev);
      saveState(next);
      return next;
    });
  }, []);

  // ─── Exercise CRUD ──────────────────────────────────────────────────────────

  const addExercise = useCallback(
    (data: ExerciseFormData) => {
      update((prev) => {
        const exercise: Exercise = {
          id: generateId(),
          name: data.name.trim(),
          bodyPart: data.bodyPart,
          muscleGroup: data.muscleGroup.trim() || getDefaultMuscleGroup(data.bodyPart),
          type: data.type || 'compound',
          targetSets: data.targetSets,
          repsMin: data.repsMin,
          repsMax: data.repsMax,
          currentLoad: data.currentLoad,
          loadIncrement: data.loadIncrement || getDefaultLoadIncrement(data.bodyPart),
          rirTarget: data.rirTarget,
          createdAt: new Date().toISOString(),
          order: prev.exercises.length,
        };

        const existsMeso = prev.mesocycleStates.some(
          (m) => m.muscleGroup.toLowerCase() === exercise.muscleGroup.toLowerCase()
        );
        const nextMesoStates = [...prev.mesocycleStates];
        if (!existsMeso) {
          nextMesoStates.push({
            muscleGroup: exercise.muscleGroup,
            currentWeek: 0,
            mesocycleLengthWeeks: DEFAULT_MESO_LENGTH,
            phase: 'accumulation',
            lastUpdated: new Date().toISOString(),
          });
        }

        return {
          ...prev,
          exercises: [...prev.exercises, exercise],
          mesocycleStates: nextMesoStates,
        };
      });
    },
    [update]
  );

  const updateExercise = useCallback(
    (id: string, data: Partial<ExerciseFormData>) => {
      update((prev) => {
        const nextExercises = prev.exercises.map((ex) =>
          ex.id === id ? { ...ex, ...data } : ex
        );

        const oldEx = prev.exercises.find((ex) => ex.id === id);
        const newGroup = data.muscleGroup;
        const nextMesoStates = [...prev.mesocycleStates];

        if (oldEx && newGroup && oldEx.muscleGroup !== newGroup) {
          const groupUsedElsewhere = nextExercises.some(
            (e) => e.muscleGroup.toLowerCase() === oldEx.muscleGroup.toLowerCase()
          );

          if (!groupUsedElsewhere) {
            const index = nextMesoStates.findIndex(
              (m) => m.muscleGroup.toLowerCase() === oldEx.muscleGroup.toLowerCase()
            );
            if (index !== -1) {
              nextMesoStates.splice(index, 1);
            }
          }

          const newGroupExists = nextMesoStates.some(
            (m) => m.muscleGroup.toLowerCase() === newGroup.toLowerCase()
          );
          if (!newGroupExists) {
            nextMesoStates.push({
              muscleGroup: newGroup,
              currentWeek: 0,
              mesocycleLengthWeeks: DEFAULT_MESO_LENGTH,
              phase: 'accumulation',
              lastUpdated: new Date().toISOString(),
            });
          }
        }

        return {
          ...prev,
          exercises: nextExercises,
          mesocycleStates: nextMesoStates,
        };
      });
    },
    [update]
  );

  const deleteExercise = useCallback(
    (id: string) => {
      update((prev) => {
        const exToDelete = prev.exercises.find((ex) => ex.id === id);
        const nextExercises = prev.exercises.filter((ex) => ex.id !== id);

        const nextMesoStates = [...prev.mesocycleStates];
        if (exToDelete) {
          const groupStillUsed = nextExercises.some(
            (e) => e.muscleGroup.toLowerCase() === exToDelete.muscleGroup.toLowerCase()
          );
          if (!groupStillUsed) {
            const idx = nextMesoStates.findIndex(
              (m) => m.muscleGroup.toLowerCase() === exToDelete.muscleGroup.toLowerCase()
            );
            if (idx !== -1) nextMesoStates.splice(idx, 1);
          }
        }

        return {
          ...prev,
          exercises: nextExercises,
          sessions: prev.sessions.filter((s) => s.exerciseId !== id),
          mesocycleStates: nextMesoStates,
        };
      });
    },
    [update]
  );

  // ─── Session Save (direct) ──────────────────────────────────────────────────

  const saveSessionDirect = useCallback(
    (exerciseId: string, sets: SetLog[]) => {
      update((prev) => {
        const exercise = prev.exercises.find((ex) => ex.id === exerciseId);
        if (!exercise) return prev;

        const mesoState = prev.mesocycleStates.find(
          (m) => m.muscleGroup.toLowerCase() === exercise.muscleGroup.toLowerCase()
        );

        const exerciseSessions = prev.sessions
          .filter((s) => s.exerciseId === exerciseId)
          .sort((a, b) => b.date.localeCompare(a.date));

        const evaluation = evaluateSession(exercise, sets, exerciseSessions, mesoState);

        const sessionVolume = calculateVolumeLoad(sets);

        const session: SessionLog = {
          id: generateId(),
          exerciseId,
          date: todayIso(),
          sets,
          progressionResult: evaluation.result,
          suggestedLoad: evaluation.suggestedLoad,
        };

        const today = todayIso();
        const dateObj = new Date(today + 'T00:00:00');
        const day = dateObj.getDay();
        const diff = dateObj.getDate() - day + (day === 0 ? -6 : 1);
        const mondayStr = new Date(dateObj.setDate(diff)).toISOString().slice(0, 10);

        const nextWeeklyVolumes = [...(prev.weeklyVolumes ?? [])];
        const matchIdx = nextWeeklyVolumes.findIndex(
          (v) =>
            v.muscleGroup.toLowerCase() === exercise.muscleGroup.toLowerCase() &&
            v.weekStartDate === mondayStr
        );

        if (matchIdx !== -1) {
          nextWeeklyVolumes[matchIdx] = {
            ...nextWeeklyVolumes[matchIdx],
            totalVolumeLoad: nextWeeklyVolumes[matchIdx].totalVolumeLoad + sessionVolume,
            setCount: nextWeeklyVolumes[matchIdx].setCount + sets.length,
          };
        } else {
          nextWeeklyVolumes.push({
            muscleGroup: exercise.muscleGroup,
            weekStartDate: mondayStr,
            totalVolumeLoad: sessionVolume,
            setCount: sets.length,
          });
        }

        const updatedExercises = prev.exercises.map((ex) =>
          ex.id === exerciseId
            ? { ...ex, currentLoad: evaluation.suggestedLoad }
            : ex
        );

        return {
          ...prev,
          exercises: updatedExercises,
          sessions: [...prev.sessions, session],
          weeklyVolumes: nextWeeklyVolumes,
        };
      });
    },
    [update]
  );

  // ─── Selectors ──────────────────────────────────────────────────────────────

  const getLastSession = useCallback(
    (exerciseId: string): SessionLog | undefined => {
      return state.sessions
        .filter((s) => s.exerciseId === exerciseId)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
    },
    [state.sessions]
  );

  const getSessionsForExercise = useCallback(
    (exerciseId: string): SessionLog[] => {
      return state.sessions
        .filter((s) => s.exerciseId === exerciseId)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    [state.sessions]
  );

  const getMesocycleState = useCallback(
    (muscleGroup: string): MesocycleState | undefined => {
      return state.mesocycleStates.find(
        (m) => m.muscleGroup.toLowerCase() === groupNameClean(muscleGroup)
      );
    },
    [state.mesocycleStates]
  );

  function groupNameClean(name: string): string {
    return name.trim().toLowerCase();
  }

  const forceWeekIncrement = useCallback(
    (muscleGroup: string) => {
      update((prev) => {
        const nextMesoStates = prev.mesocycleStates.map((meso) => {
          if (meso.muscleGroup.toLowerCase() === muscleGroup.toLowerCase()) {
            const nextWeek = meso.currentWeek + 1;
            const length = meso.mesocycleLengthWeeks;

            let nextPhase: 'accumulation' | 'deload' = 'accumulation';
            let finalWeek = nextWeek;

            if (nextWeek === length - 1) {
              nextPhase = 'deload';
            } else if (nextWeek >= length) {
              finalWeek = 0;
              nextPhase = 'accumulation';
            } else {
              nextPhase = meso.phase;
            }

            return {
              ...meso,
              currentWeek: finalWeek,
              phase: nextPhase,
              lastUpdated: new Date().toISOString(),
            };
          }
          return meso;
        });

        return { ...prev, mesocycleStates: nextMesoStates };
      });
    },
    [update]
  );

  return {
    exercises: state.exercises,
    sessions: state.sessions,
    mesocycleStates: state.mesocycleStates,
    weeklyVolumes: state.weeklyVolumes ?? [],
    addExercise,
    updateExercise,
    deleteExercise,
    saveSessionDirect,
    getLastSession,
    getSessionsForExercise,
    getMesocycleState,
    forceWeekIncrement,
  };
}

export default useStore;
