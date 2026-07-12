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
import { evaluateSession, calculateVolumeLoad, countHardSets, DEFAULT_MEV, DEFAULT_MRV, isHardSet } from '../engine/progression';
import type { CsvImportResult } from '../utils/csv';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MESO_LENGTH = 5; // 4 weeks accumulation, 1 week deload

// ─── Helpers for Migration & Initialization ──────────────────────────────────

function initializeMissingStates(state: AppState): AppState {
  let modified = false;

  // 1. Ensure all exercises have a muscleGroup (backward compat)
  let exercises = state.exercises ? [...state.exercises] : [];
  exercises = exercises.map((ex) => {
    if (!ex.muscleGroup) {
      modified = true;
      return { ...ex, muscleGroup: 'Altro' };
    }
    return ex;
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
        mev: DEFAULT_MEV,
        mrv: DEFAULT_MRV,
        deloadReason: null,
        lastUpdated: new Date().toISOString(),
      });
    }
  });

  // 3. Ensure weeklyVolumes log is initialized
  const weeklyVolumes = state.weeklyVolumes ?? [];
  if (!state.weeklyVolumes) {
    modified = true;
  }

  // 4. Backward compat: ensure all meso states have mev/mrv
  const mesoWithDefaults = mesocycleStates.map((meso) => {
    const updated = { ...meso };
    if (updated.mev === undefined) { modified = true; updated.mev = DEFAULT_MEV; }
    if (updated.mrv === undefined) { modified = true; updated.mrv = DEFAULT_MRV; }
    if (updated.deloadReason === undefined) {
      modified = true;
      updated.deloadReason = updated.phase === 'deload' ? 'scheduled' as const : null;
    }
    return updated;
  });

  // 5. Calendar-based Mesocycle week increment check
  const now = new Date();
  const updatedMesoStates = mesoWithDefaults.map((meso) => {
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
        deloadReason: nextPhase === 'deload' ? 'scheduled' as const : null,
        lastUpdated: now.toISOString(),
      };
    }
    return meso;
  });

  if (modified) {
    const nextState: AppState = {
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
          muscleGroup: data.muscleGroup.trim() || 'Altro',
          targetSets: data.targetSets,
          repsMin: data.repsMin,
          repsMax: data.repsMax,
          currentLoad: data.currentLoad,
          loadIncrement: data.loadIncrement,
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
            mev: DEFAULT_MEV,
            mrv: DEFAULT_MRV,
            deloadReason: null,
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
              mev: DEFAULT_MEV,
              mrv: DEFAULT_MRV,
              deloadReason: null,
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

        // Compute group-level plateau and RIR unreliability flags
        const groupExercises = prev.exercises.filter(
          (e) => e.muscleGroup.toLowerCase() === exercise.muscleGroup.toLowerCase()
        );

        const plateauFlags: boolean[] = [];
        const rirUnreliableFlags: boolean[] = [];

        groupExercises.forEach((ex) => {
          const exSessions = prev.sessions
            .filter((s) => s.exerciseId === ex.id)
            .sort((a, b) => b.date.localeCompare(a.date));

          // Plateau: last 2+ sessions are 'maintain' with no 'increase' in between
          const recentResults = exSessions.slice(0, 2).map((s) => s.progressionResult);
          plateauFlags.push(recentResults.length >= 2 && recentResults.every((r) => r === 'maintain'));

          // RIR unreliable: RIR contradicts performance
          const lastSession = exSessions[0];
          if (lastSession && lastSession.sets.length > 0) {
            const rirVals = lastSession.sets.map((s) => s.rir).filter((r): r is number => r !== null);
            if (rirVals.length > 0) {
              const avgRir = rirVals.reduce((a, b) => a + b, 0) / rirVals.length;
              const avgReps = lastSession.sets.reduce((a, b) => a + b.reps, 0) / lastSession.sets.length;
              const repsOk = avgReps >= ex.repsMin && avgReps <= ex.repsMax;
              rirUnreliableFlags.push(
                (avgRir <= 1 && avgReps >= ex.repsMax) || // very hard but crushing reps
                (avgRir >= 3 && avgReps < ex.repsMin)      // very easy but failing reps
              );
            } else {
              rirUnreliableFlags.push(false);
            }
          } else {
            rirUnreliableFlags.push(false);
          }
        });

        const plateauAcrossGroup = plateauFlags.filter(Boolean).length / Math.max(1, plateauFlags.length) >= 0.5;
        const rirUnreliableAcrossGroup = rirUnreliableFlags.filter(Boolean).length / Math.max(1, rirUnreliableFlags.length) >= 0.5;

        const evaluation = evaluateSession(exercise, sets, [], mesoState, plateauAcrossGroup, rirUnreliableAcrossGroup);

        const sessionVolume = calculateVolumeLoad(sets);
        const sessionHardSets = countHardSets(sets);

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
            hardSets: nextWeeklyVolumes[matchIdx].hardSets + sessionHardSets,
            setCount: nextWeeklyVolumes[matchIdx].setCount + sets.length,
          };
        } else {
          nextWeeklyVolumes.push({
            muscleGroup: exercise.muscleGroup,
            weekStartDate: mondayStr,
            totalVolumeLoad: sessionVolume,
            hardSets: sessionHardSets,
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

  // ─── Bulk import ────────────────────────────────────────────────────────────

  const importState = useCallback(
    (data: CsvImportResult) => {
      update((prev) => {
        try {
          localStorage.setItem('gymos_v1_backup_pre_import', JSON.stringify(prev));
        } catch (e) {
          console.warn('[GymOS] Failed to save pre-import backup:', e);
        }
        return {
          exercises: data.exercises,
          sessions: data.sessions,
          mesocycleStates: data.mesocycleStates,
          weeklyVolumes: data.weeklyVolumes,
          lastUpdated: new Date().toISOString(),
        };
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
    importState,
  };
}

export default useStore;
