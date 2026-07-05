import React, { useState } from 'react';
import type { ExerciseFormData, BodyPart, ExerciseType } from '../types';
import { getDefaultLoadIncrement, getDefaultMuscleGroup } from '../engine/progression';

interface Props {
  initialData?: Partial<ExerciseFormData>;
  onSave: (data: ExerciseFormData) => void;
  onCancel: () => void;
  title?: string;
}

const BODY_PART_OPTIONS: { value: BodyPart; label: string }[] = [
  { value: 'upper', label: '💪 Upper body' },
  { value: 'lower', label: '🦵 Lower body' },
  { value: 'core',  label: '🔥 Core' },
];

const MUSCLE_GROUP_SUGGESTIONS = [
  'Petto',
  'Dorso',
  'Gambe',
  'Spalle',
  'Braccia',
  'Core',
];

export default function ExerciseForm({ initialData, onSave, onCancel, title = 'Nuovo Esercizio' }: Props) {
  const [data, setData] = useState<ExerciseFormData>({
    name: initialData?.name ?? '',
    bodyPart: initialData?.bodyPart ?? 'upper',
    muscleGroup: initialData?.muscleGroup ?? getDefaultMuscleGroup(initialData?.bodyPart ?? 'upper'),
    type: initialData?.type ?? 'compound',
    targetSets: initialData?.targetSets ?? 3,
    repsMin: initialData?.repsMin ?? 6,
    repsMax: initialData?.repsMax ?? 10,
    currentLoad: initialData?.currentLoad ?? 20,
    loadIncrement: initialData?.loadIncrement ?? getDefaultLoadIncrement(initialData?.bodyPart ?? 'upper'),
    rirTarget: initialData?.rirTarget ?? 2,
  });

  const [customMuscleGroup, setCustomMuscleGroup] = useState(
    initialData?.muscleGroup && !MUSCLE_GROUP_SUGGESTIONS.includes(initialData.muscleGroup)
  );

  const [errors, setErrors] = useState<Partial<Record<keyof ExerciseFormData, string>>>({});

  function set<K extends keyof ExerciseFormData>(key: K, value: ExerciseFormData[K]) {
    setData((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'bodyPart') {
        if (prev.loadIncrement === getDefaultLoadIncrement(prev.bodyPart)) {
          next.loadIncrement = getDefaultLoadIncrement(value as string);
        }
        if (!customMuscleGroup) {
          next.muscleGroup = getDefaultMuscleGroup(value as string);
        }
      }
      return next;
    });
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!data.name.trim()) errs.name = 'Il nome è obbligatorio';
    if (!data.muscleGroup.trim()) errs.muscleGroup = 'Il gruppo muscolare è obbligatorio';
    if (data.repsMin >= data.repsMax) errs.repsMax = 'Max deve essere > Min';
    if (data.currentLoad < 0) errs.currentLoad = 'Carico non valido';
    if (data.loadIncrement <= 0) errs.loadIncrement = 'Incremento non valido';
    if (data.targetSets < 1) errs.targetSets = 'Minimo 1 serie';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validate()) onSave(data);
  }

  const num = (v: string) => parseFloat(v) || 0;
  const int = (v: string) => parseInt(v, 10) || 0;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-sheet">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          {/* Name */}
          <div className="form-group">
            <label className="form-label">Nome esercizio</label>
            <input
              className="form-input"
              type="text"
              placeholder="es. Squat, Panca piana…"
              value={data.name}
              onChange={(e) => set('name', e.target.value)}
              autoFocus
            />
            {errors.name && <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{errors.name}</span>}
          </div>

          {/* Exercise Importance Type */}
          <div className="form-group">
            <label className="form-label">Tipologia Esercizio</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className={`btn btn-sm ${data.type === 'compound' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => set('type', 'compound')}
                style={{ fontSize: 'var(--fs-sm)' }}
              >
                🏋️ Principale (Compound)
              </button>
              <button
                type="button"
                className={`btn btn-sm ${data.type === 'accessory' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => set('type', 'accessory')}
                style={{ fontSize: 'var(--fs-sm)' }}
              >
                💪 Accessorio (Isolamento)
              </button>
            </div>
          </div>

          {/* Body Part */}
          <div className="form-group">
            <label className="form-label">Distretto Corporeo</label>
            <select
              className="form-input"
              value={data.bodyPart}
              onChange={(e) => set('bodyPart', e.target.value as BodyPart)}
            >
              {BODY_PART_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Muscle Group */}
          <div className="form-group">
            <div className="flex justify-between items-center">
              <label className="form-label">Gruppo Muscolare</label>
              <button
                type="button"
                className="btn-ghost text-accent"
                style={{ fontSize: 'var(--fs-xs)', minHeight: 'auto', padding: 0 }}
                onClick={() => {
                  setCustomMuscleGroup(!customMuscleGroup);
                  if (customMuscleGroup) {
                    set('muscleGroup', getDefaultMuscleGroup(data.bodyPart));
                  } else {
                    set('muscleGroup', '');
                  }
                }}
              >
                {customMuscleGroup ? 'Usa suggeriti' : 'Scrivi personalizzato'}
              </button>
            </div>

            {customMuscleGroup ? (
              <input
                className="form-input"
                type="text"
                placeholder="es. Bicipiti, Femorali, Petto Alto..."
                value={data.muscleGroup}
                onChange={(e) => set('muscleGroup', e.target.value)}
              />
            ) : (
              <select
                className="form-input"
                value={data.muscleGroup}
                onChange={(e) => set('muscleGroup', e.target.value)}
              >
                {MUSCLE_GROUP_SUGGESTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
                {!MUSCLE_GROUP_SUGGESTIONS.includes(data.muscleGroup) && data.muscleGroup && (
                  <option value={data.muscleGroup}>{data.muscleGroup}</option>
                )}
              </select>
            )}
            {errors.muscleGroup && <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{errors.muscleGroup}</span>}
          </div>

          {/* Sets */}
          <div className="form-group">
            <label className="form-label">Serie target</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={10}
              value={data.targetSets}
              onChange={(e) => set('targetSets', int(e.target.value))}
            />
          </div>

          {/* Rep Range */}
          <div className="form-group">
            <label className="form-label">Range reps (min – max)</label>
            <div className="form-row">
              <div>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="Min"
                  value={data.repsMin}
                  onChange={(e) => set('repsMin', int(e.target.value))}
                />
              </div>
              <div>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  placeholder="Max"
                  value={data.repsMax}
                  onChange={(e) => set('repsMax', int(e.target.value))}
                />
                {errors.repsMax && <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{errors.repsMax}</span>}
              </div>
            </div>
          </div>

          {/* Load + Increment */}
          <div className="form-group">
            <label className="form-label">Carico attuale (kg)</label>
            <input
              className="form-input"
              type="number"
              min={0}
              step={0.25}
              value={data.currentLoad}
              onChange={(e) => set('currentLoad', num(e.target.value))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Incremento carico (kg)</label>
            <input
              className="form-input"
              type="number"
              min={0.25}
              step={0.25}
              value={data.loadIncrement}
              onChange={(e) => set('loadIncrement', num(e.target.value))}
            />
            {errors.loadIncrement && <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>{errors.loadIncrement}</span>}
          </div>

          {/* RIR Target */}
          <div className="form-group">
            <label className="form-label">
              RIR target{' '}
              <span className="text-muted fs-xs">(Reps In Reserve — opzionale)</span>
            </label>
            <select
              className="form-input"
              value={data.rirTarget ?? ''}
              onChange={(e) => set('rirTarget', e.target.value === '' ? null : int(e.target.value))}
            >
              <option value="">— Non tracciare —</option>
              <option value="0">0 — Al cedimento</option>
              <option value="1">1 — 1 rep dal cedimento</option>
              <option value="2">2 — 2 reps dal cedimento</option>
              <option value="3">3 — 3 reps dal cedimento</option>
              <option value="4">4 — 4 reps dal cedimento</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-2">
            <button type="button" className="btn btn-outline btn-full" onClick={onCancel}>
              Annulla
            </button>
            <button type="submit" className="btn btn-primary btn-full">
              Salva
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
