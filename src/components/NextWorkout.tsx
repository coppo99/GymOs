import React from 'react';
import type { Exercise, SessionLog, MesocycleState } from '../types';
import { getNextSessionLoad, getProgressionColor, getProgressionLabel } from '../engine/progression';

interface Props {
  exercises: Exercise[];
  getLastSession: (id: string) => SessionLog | undefined;
  getMesocycleState: (muscleGroup: string) => MesocycleState | undefined;
}

export default function NextWorkout({ exercises, getLastSession, getMesocycleState }: Props) {
  if (exercises.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Prossima Seduta</h1>
            <div className="page-subtitle">Piano per il prossimo allenamento</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">Nessun esercizio</div>
          <div className="empty-state-text">Aggiungi esercizi dalla dashboard per vedere il piano</div>
        </div>
      </div>
    );
  }

  // Group by muscleGroup
  const byGroup: Record<string, Exercise[]> = {};
  exercises.forEach((ex) => {
    if (!byGroup[ex.muscleGroup]) {
      byGroup[ex.muscleGroup] = [];
    }
    byGroup[ex.muscleGroup].push(ex);
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Prossima Seduta</h1>
          <div className="page-subtitle">Carichi e reps per il prossimo workout</div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="flex gap-4" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--accent)' }}>
              {exercises.length}
            </div>
            <div className="fs-xs text-muted">Esercizi</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--success)' }}>
              {exercises.filter(ex => {
                const l = getLastSession(ex.id);
                return l?.progressionResult === 'increase';
              }).length}
            </div>
            <div className="fs-xs text-muted">Aumento carico</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--warning)' }}>
              {exercises.filter(ex => {
                const l = getLastSession(ex.id);
                return !l || l?.progressionResult === 'maintain';
              }).length}
            </div>
            <div className="fs-xs text-muted">Mantieni</div>
          </div>
          <div>
            <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: 'var(--danger)' }}>
              {exercises.filter(ex => {
                const l = getLastSession(ex.id);
                const meso = getMesocycleState(ex.muscleGroup);
                return l?.progressionResult === 'deload' || meso?.phase === 'deload';
              }).length}
            </div>
            <div className="fs-xs text-muted">Deload</div>
          </div>
        </div>
      </div>

      {/* By muscle group */}
      {Object.entries(byGroup).map(([group, exs]) => {
        if (exs.length === 0) return null;
        const meso = getMesocycleState(group);
        const isDeload = meso?.phase === 'deload';

        return (
          <div key={group}>
            <div className="section-title flex justify-between items-center" style={{ textTransform: 'none' }}>
              <span>{group}</span>
              {meso && (
                <span className="text-muted fs-xs" style={{ fontWeight: 'normal' }}>
                  {isDeload ? '🔴 Deload' : '⚡ Accumulo'} (W{meso.currentWeek + 1}/{meso.mesocycleLengthWeeks})
                </span>
              )}
            </div>
            <div className="card" style={{ padding: 0 }}>
              {exs.map((ex) => {
                const last = getLastSession(ex.id);
                // If deload, apply 10% reduction to target load recommendation shown
                const suggestedLoad = isDeload
                  ? Math.max(ex.loadIncrement, Math.round((ex.currentLoad * 0.9) / ex.loadIncrement) * ex.loadIncrement)
                  : getNextSessionLoad(ex, last);
                const color = last ? getProgressionColor(last.progressionResult) : null;
                const targetSets = isDeload
                  ? Math.max(1, Math.round(ex.targetSets * 0.6))
                  : ex.targetSets;

                return (
                  <div key={ex.id} className="nw-row">
                    <div>
                      <div className="nw-exercise-name">{ex.name}</div>
                      <div className="nw-meta">
                        {targetSets} serie × {ex.repsMin}–{ex.repsMax} reps
                        {ex.rirTarget !== null && ` · RIR ${ex.rirTarget}`}
                      </div>
                      {isDeload && (
                        <div style={{ marginTop: 'var(--space-1)' }}>
                          <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>
                            Deload volume (-40%) e carico (-10%)
                          </span>
                        </div>
                      )}
                      {!isDeload && color && (
                        <div style={{ marginTop: 'var(--space-1)' }}>
                          <span className={`badge badge-${color}`} style={{ fontSize: '0.65rem' }}>
                            {getProgressionLabel(last!.progressionResult)}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="nw-load" style={{ color: isDeload ? 'var(--danger)' : color ? `var(--${color})` : 'var(--text-primary)' }}>
                      {suggestedLoad} <span>kg</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div className="section-title" style={{ marginTop: 'var(--space-8)' }}>Legenda progressione</div>
      <div className="card">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="badge badge-success">↑ Aumenta</span>
            <span className="fs-sm text-secondary">Tutte le serie nel range alto — aumenta il carico</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="badge badge-warning">→ Mantieni</span>
            <span className="fs-sm text-secondary">Reps nella fascia target — mantieni il carico</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="badge badge-danger">↓ Deload</span>
            <span className="fs-sm text-secondary">Volume / carichi ridotti pianificati per la settimana di scarico del mesociclo</span>
          </div>
        </div>
      </div>
    </div>
  );
}
