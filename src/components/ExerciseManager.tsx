import React, { useState } from 'react';
import { Exercise, ExerciseFormData } from '../types';
import ExerciseForm from './ExerciseForm';

interface Props {
  exercises: Exercise[];
  onAdd: (data: ExerciseFormData) => void;
  onUpdate: (id: string, data: Partial<ExerciseFormData>) => void;
  onDelete: (id: string) => void;
}

export default function ExerciseManager({ exercises, onAdd, onUpdate, onDelete }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

  function handleSave(data: ExerciseFormData) {
    if (editingExercise) {
      onUpdate(editingExercise.id, data);
    } else {
      onAdd(data);
    }
    setShowForm(false);
    setEditingExercise(null);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Esercizi</h1>
          <div className="page-subtitle">Gestisci la tua lista di esercizi</div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => { setEditingExercise(null); setShowForm(true); }}
        >
          + Aggiungi
        </button>
      </div>

      {exercises.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📝</div>
          <div className="empty-state-title">Nessun esercizio</div>
          <div className="empty-state-text">Crea il tuo primo esercizio per iniziare</div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + Crea esercizio
          </button>
        </div>
      ) : (
        <div>
          {exercises.map((ex) => (
            <div key={ex.id} className="card">
              <div className="flex items-center justify-between">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>{ex.name}</div>
                  <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
                    <span className="fs-xs text-muted">
                      {ex.targetSets} × {ex.repsMin}–{ex.repsMax} reps
                    </span>
                    <span className="fs-xs text-muted">·</span>
                    <span className="fs-xs text-muted">{ex.currentLoad} kg</span>
                    <span className="fs-xs text-muted">·</span>
                    <span className="fs-xs text-muted">+{ex.loadIncrement} kg/step</span>
                    {ex.rirTarget !== null && (
                      <>
                        <span className="fs-xs text-muted">·</span>
                        <span className="fs-xs text-muted">RIR {ex.rirTarget}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-2" style={{ flexShrink: 0, marginLeft: 'var(--space-3)' }}>
                  <button
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => { setEditingExercise(ex); setShowForm(true); }}
                    title="Modifica"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-danger btn-sm btn-icon"
                    onClick={() => {
                      if (confirm(`Eliminare "${ex.name}" e tutto lo storico?`)) {
                        onDelete(ex.id);
                      }
                    }}
                    title="Elimina"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ExerciseForm
          initialData={editingExercise ?? undefined}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingExercise(null); }}
          title={editingExercise ? 'Modifica esercizio' : 'Nuovo esercizio'}
        />
      )}
    </div>
  );
}
