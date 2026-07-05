import React, { useState, useEffect, useRef } from 'react';
import type {
  Exercise,
  SessionLog,
  SetLog,
  ExerciseFormData,
  MesocycleState,
  WeeklyVolumeLog,
} from '../types';
import {
  getNextSessionLoad,
  getProgressionColor,
  getProgressionLabel,
  getRolling7DayVolume,
  getWeeklyVolumeTrend,
  detectPlateau,
  checkEarlyOverloadWarning,
  checkRirReliability,
  roundToIncrement,
  evaluateSession,
  calculateVolumeLoad,
} from '../engine/progression';
import ExerciseForm from './ExerciseForm';

interface Props {
  exercises: Exercise[];
  sessions: SessionLog[];
  mesocycleStates: MesocycleState[];
  weeklyVolumes: WeeklyVolumeLog[];
  getLastSession: (id: string) => SessionLog | undefined;
  getSessionsForExercise: (id: string) => SessionLog[];
  getMesocycleState: (muscleGroup: string) => MesocycleState | undefined;
  forceWeekIncrement: (muscleGroup: string) => void;
  onAddExercise: (data: ExerciseFormData) => void;
  onUpdateExercise: (id: string, data: Partial<ExerciseFormData>) => void;
  onDeleteExercise: (id: string) => void;
  onSaveSession: (exerciseId: string, sets: SetLog[]) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'oggi';
  if (diff === 1) return 'ieri';
  if (diff < 7) return `${diff}g fa`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

function VolumeBarChart({ weeklyTrend }: { weeklyTrend: { weekStart: string; volume: number; setCount: number }[] }) {
  const maxVol = Math.max(...weeklyTrend.map(w => w.volume), 0) || 1;
  const height = 80;
  const width = 280;

  return (
    <div style={{ marginTop: 'var(--space-3)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: 'var(--space-3)' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '6px' }}>
        Trend Volume Ultimi 30 Giorni (kg * reps)
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: height, paddingTop: '10px' }}>
        {weeklyTrend.map((w, idx) => {
          const barHeight = w.volume > 0 ? (w.volume / maxVol) * (height - 25) : 4;
          const date = new Date(w.weekStart + 'T00:00:00');
          const dateLabel = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

          return (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              {w.volume > 0 && (
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {w.volume.toFixed(0)}
                </span>
              )}
              <div
                style={{
                  width: '28px',
                  height: `${barHeight}px`,
                  background: 'linear-gradient(to top, var(--accent) 30%, var(--accent-hover) 100%)',
                  borderRadius: '3px 3px 0 0',
                  boxShadow: '0 2px 8px var(--accent-glow)',
                  transition: 'height 0.4s ease',
                }}
              />
              <span style={{ fontSize: '8px', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'center' }}>
                {dateLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Inline Set Logger & Celebration Component ────────────────────────────────

interface InlineLoggerProps {
  exercise: Exercise;
  lastSession: SessionLog | undefined;
  recentSessions: SessionLog[];
  mesoState: MesocycleState | undefined;
  onSaveSession: (sets: SetLog[]) => void;
  onCancel: () => void;
}

function InlineSetLogger({
  exercise,
  lastSession,
  recentSessions,
  mesoState,
  onSaveSession,
  onCancel,
}: InlineLoggerProps) {
  const isDeloadPhase = mesoState?.phase === 'deload';
  const targetSets = isDeloadPhase
    ? Math.max(1, Math.round(exercise.targetSets * 0.6))
    : exercise.targetSets;

  const baseSuggestedLoad = getNextSessionLoad(exercise, lastSession);
  const initialLoad = isDeloadPhase
    ? roundToIncrement(baseSuggestedLoad * 0.9, exercise.loadIncrement)
    : baseSuggestedLoad;

  const [loggedSets, setLoggedSets] = useState<SetLog[]>([]);
  const [repsInput, setRepsInput] = useState(String(exercise.repsMax));
  const [loadInput, setLoadInput] = useState(String(initialLoad));
  const [rirInput, setRirInput] = useState(exercise.rirTarget !== null ? String(exercise.rirTarget) : '');
  const [intraSessionFeedback, setIntraSessionFeedback] = useState<string | null>(null);
  
  const [isFinished, setIsFinished] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<ReturnType<typeof evaluateSession> | null>(null);
  
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationData, setCelebrationData] = useState<{
    todayVolume: number;
    prevVolume: number;
    volDeltaPct: number;
    todayMaxLoad: number;
    prevMaxLoad: number;
    isLoadPR: boolean;
    isVolumePR: boolean;
  } | null>(null);

  const repsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showCelebration) {
      repsRef.current?.focus();
    }
  }, [loggedSets.length, showCelebration]);

  function handleAddSet() {
    const reps = parseInt(repsInput, 10);
    const load = parseFloat(loadInput);
    const rir = rirInput !== '' ? parseInt(rirInput, 10) : null;

    if (!reps || !load || reps < 1 || load < 0) return;

    const newSet: SetLog = {
      setNumber: loggedSets.length + 1,
      reps,
      load,
      rir,
    };
    const updated = [...loggedSets, newSet];
    setLoggedSets(updated);

    // RIR Autoregulation
    let nextLoad = load;
    let feedback: string | null = null;

    if (rir !== null && exercise.rirTarget !== null) {
      if (rir < exercise.rirTarget - 1) {
        const reductionPct = rir === 0 ? 0.10 : 0.05;
        nextLoad = roundToIncrement(load * (1 - reductionPct), exercise.loadIncrement);
        nextLoad = Math.max(nextLoad, exercise.loadIncrement);
        feedback = `RIR ${rir} < target ${exercise.rirTarget}. Carico serie succ. ridotto a ${nextLoad} kg.`;
      } else if (rir > exercise.rirTarget + 1) {
        nextLoad = roundToIncrement(load * 1.05, exercise.loadIncrement);
        feedback = `RIR ${rir} > target ${exercise.rirTarget}. Carico serie succ. aumentato a ${nextLoad} kg.`;
      }
    }

    setIntraSessionFeedback(feedback);

    setRepsInput(String(reps));
    setLoadInput(String(nextLoad));
    setRirInput(exercise.rirTarget !== null ? String(exercise.rirTarget) : '');
  }

  function handleRemoveLast() {
    setLoggedSets((s) => s.slice(0, -1));
    setIntraSessionFeedback(null);
  }

  function handleEvaluate() {
    const eval_ = evaluateSession(exercise, loggedSets, recentSessions, mesoState);
    setEvaluationResult(eval_);
    setIsFinished(true);
  }

  function handleConfirmSave() {
    const todayVolume = calculateVolumeLoad(loggedSets);
    const todayMaxLoad = Math.max(...loggedSets.map(s => s.load));

    let prevVolume = 0;
    let prevMaxLoad = 0;
    let maxHistoricalVolume = 0;
    let maxHistoricalLoad = 0;

    if (recentSessions.length > 0) {
      const prevSession = recentSessions[0];
      prevVolume = calculateVolumeLoad(prevSession.sets);
      prevMaxLoad = Math.max(...prevSession.sets.map(s => s.load));

      maxHistoricalVolume = Math.max(...recentSessions.map(s => calculateVolumeLoad(s.sets)));
      maxHistoricalLoad = Math.max(...recentSessions.flatMap(s => s.sets.map(x => x.load)));
    }

    const volDeltaPct = prevVolume > 0 ? ((todayVolume - prevVolume) / prevVolume) * 100 : 0;
    const isLoadPR = recentSessions.length > 0 && todayMaxLoad > maxHistoricalLoad;
    const isVolumePR = recentSessions.length > 0 && todayVolume > maxHistoricalVolume;

    setCelebrationData({
      todayVolume,
      prevVolume,
      volDeltaPct,
      todayMaxLoad,
      prevMaxLoad,
      isLoadPR,
      isVolumePR,
    });

    onSaveSession(loggedSets);
    setShowCelebration(true);
  }

  // Stepper utility functions
  const incrementReps = () => setRepsInput(prev => String(Math.max(1, (parseInt(prev, 10) || 0) + 1)));
  const decrementReps = () => setRepsInput(prev => String(Math.max(1, (parseInt(prev, 10) || 1) - 1)));

  const incrementLoad = () => setLoadInput(prev => String((parseFloat(prev) || 0) + exercise.loadIncrement));
  const decrementLoad = () => setLoadInput(prev => String(Math.max(0, (parseFloat(prev) || 0) - exercise.loadIncrement)));

  const incrementRir = () => setRirInput(prev => String(Math.min(10, (prev === '' ? 0 : parseInt(prev, 10)) + 1)));
  const decrementRir = () => setRirInput(prev => {
    if (prev === '') return '';
    const val = parseInt(prev, 10) - 1;
    return val < 0 ? '0' : String(val);
  });

  if (showCelebration && celebrationData) {
    const {
      todayVolume,
      volDeltaPct,
      todayMaxLoad,
      prevMaxLoad,
      isLoadPR,
      isVolumePR,
    } = celebrationData;

    return (
      <div style={{ marginTop: 'var(--space-3)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', border: '1px solid var(--success-border)', textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
        <div style={{ fontSize: '32px', marginBottom: 'var(--space-2)' }}>🎉</div>
        <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: '700', color: 'var(--success)', marginBottom: 'var(--space-1)' }}>
          Sessione Completata!
        </h3>
        <p className="text-secondary" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-4)' }}>
          Ottimo lavoro su {exercise.name}. Ecco i risultati di oggi:
        </p>

        {(isLoadPR || isVolumePR) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            {isLoadPR && (
              <div className="badge badge-success" style={{ padding: '6px', fontSize: '11px', justifyContent: 'center' }}>
                🏆 NUOVO RECORD DI CARICO: {todayMaxLoad} kg!
              </div>
            )}
            {isVolumePR && (
              <div className="badge badge-accent" style={{ padding: '6px', fontSize: '11px', justifyContent: 'center' }}>
                🔥 NUOVO RECORD DI VOLUME: {todayVolume.toFixed(0)} kg*reps!
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-5)', textAlign: 'left' }}>
          <div style={{ background: 'var(--bg-card)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
            <span className="text-muted" style={{ fontSize: '10px', textTransform: 'uppercase' }}>Volume Totale</span>
            <div className="fw-bold fs-md" style={{ color: 'var(--accent)', marginTop: '2px' }}>
              {todayVolume.toFixed(0)} <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>kg*reps</span>
            </div>
            {celebrationData.prevVolume > 0 && (
              <span className={`fw-600 fs-xs ${volDeltaPct >= 0 ? 'text-success' : 'text-danger'}`} style={{ display: 'block', marginTop: '4px' }}>
                {volDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(volDeltaPct).toFixed(1)}% rispetto a prima
              </span>
            )}
          </div>

          <div style={{ background: 'var(--bg-card)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
            <span className="text-muted" style={{ fontSize: '10px', textTransform: 'uppercase' }}>Carico Massimo</span>
            <div className="fw-bold fs-md" style={{ marginTop: '2px' }}>
              {todayMaxLoad} <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>kg</span>
            </div>
            {prevMaxLoad > 0 && (
              <span className="text-muted fs-xs" style={{ display: 'block', marginTop: '4px' }}>
                Prima: {prevMaxLoad} kg
              </span>
            )}
          </div>
        </div>

        {evaluationResult && (
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 'var(--space-4)', fontSize: 'var(--fs-xs)', textAlign: 'left' }}>
            <div className="fw-600" style={{ color: 'var(--text-primary)', marginBottom: '2px' }}>
              Prossimo allenamento consigliato:
            </div>
            <span className={`badge badge-${getProgressionColor(evaluationResult.result)}`} style={{ fontSize: '10px', marginRight: '6px' }}>
              {getProgressionLabel(evaluationResult.result)}
            </span>
            <strong className="text-accent">{evaluationResult.suggestedLoad} kg</strong>
          </div>
        )}

        <button className="btn btn-primary btn-full" onClick={onCancel}>
          Chiudi e Continua
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--space-3)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: 'var(--space-3)', border: '1px solid rgba(255,255,255,0.05)' }}>
      {isDeloadPhase && (
        <div className="badge badge-danger mb-2 w-full" style={{ justifyContent: 'center', fontSize: '10px' }}>
          ⚠️ Deload Attivo: target {targetSets} serie, carico consigliato -10%
        </div>
      )}

      {/* Progress Dots */}
      <div className="progress-dots" style={{ marginBottom: 'var(--space-3)' }}>
        {Array.from({ length: targetSets }).map((_, i) => (
          <div
            key={i}
            className={`progress-dot ${i < loggedSets.length ? 'done' : i === loggedSets.length ? 'current' : ''}`}
          />
        ))}
      </div>

      {/* Logged Sets list */}
      {loggedSets.length > 0 && (
        <div style={{ marginBottom: 'var(--space-3)' }}>
          {loggedSets.map((s) => (
            <div key={s.setNumber} className="logged-set" style={{ padding: '8px var(--space-3)', margin: '4px 0' }}>
              <div className="logged-set-num" style={{ fontSize: '11px' }}>#{s.setNumber}</div>
              <div className="logged-set-data">
                <span className="fw-600 fs-sm">{s.reps} <span className="text-muted fs-xs">reps</span></span>
                <span className="fw-600 fs-sm">{s.load} <span className="text-muted fs-xs">kg</span></span>
                {s.rir !== null && <span className="fw-600 fs-sm">{s.rir} <span className="text-muted fs-xs">RIR</span></span>}
              </div>
              {s.setNumber === loggedSets.length && !isFinished && (
                <button className="btn btn-ghost btn-sm" onClick={handleRemoveLast} style={{ padding: '2px 6px', minHeight: 'auto' }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Autoregulation feedback */}
      {!isFinished && intraSessionFeedback && (
        <div className="suggestion-banner warning" style={{ padding: '6px var(--space-2)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)' }}>
          <div className="suggestion-text" style={{ fontSize: '10px' }}>
            ⚖️ {intraSessionFeedback}
          </div>
        </div>
      )}

      {/* Active input row with Steppers */}
      {!isFinished && loggedSets.length < targetSets && (
        <div style={{ background: 'var(--bg-card)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text-muted)' }}>
            SERIE #{loggedSets.length + 1}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: exercise.rirTarget !== null ? '1fr 1.1fr 1fr' : '1fr 1fr', gap: 'var(--space-3)' }}>
            
            {/* Reps Stepper */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Reps</span>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <button 
                  type="button" 
                  onClick={decrementReps} 
                  style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                >
                  -
                </button>
                <input
                  ref={repsRef}
                  className="set-input"
                  style={{ flex: 1, border: 'none', background: 'transparent', textAlign: 'center', padding: 0, minHeight: '36px', fontWeight: '700' }}
                  type="number"
                  value={repsInput}
                  onChange={(e) => setRepsInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSet()}
                />
                <button 
                  type="button" 
                  onClick={incrementReps} 
                  style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Load Stepper */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Carico (kg)</span>
              <div style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                <button 
                  type="button" 
                  onClick={decrementLoad} 
                  style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                >
                  -
                </button>
                <input
                  className="set-input"
                  style={{ flex: 1, border: 'none', background: 'transparent', textAlign: 'center', padding: 0, minHeight: '36px', fontWeight: '700' }}
                  type="number"
                  step={0.25}
                  value={loadInput}
                  onChange={(e) => setLoadInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSet()}
                />
                <button 
                  type="button" 
                  onClick={incrementLoad} 
                  style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                >
                  +
                </button>
              </div>
            </div>

            {/* RIR Stepper (Optional) */}
            {exercise.rirTarget !== null && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '4px' }}>RIR Target</span>
                <div style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <button 
                    type="button" 
                    onClick={decrementRir} 
                    style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                  >
                    -
                  </button>
                  <input
                    className="set-input"
                    style={{ flex: 1, border: 'none', background: 'transparent', textAlign: 'center', padding: 0, minHeight: '36px', fontWeight: '700' }}
                    type="number"
                    value={rirInput}
                    placeholder="—"
                    onChange={(e) => setRirInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSet()}
                  />
                  <button 
                    type="button" 
                    onClick={incrementRir} 
                    style={{ width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

          </div>

          <button
            className="btn btn-primary btn-full"
            onClick={handleAddSet}
            disabled={!repsInput || !loadInput}
            style={{ minHeight: '40px', marginTop: 'var(--space-2)' }}
          >
            Registra Serie #{loggedSets.length + 1}
          </button>
        </div>
      )}

      {/* Done notification block */}
      {!isFinished && loggedSets.length >= targetSets && (
        <div style={{ padding: 'var(--space-2)', background: 'var(--success-bg)', border: '1px solid var(--success-border)', borderRadius: 'var(--radius)', color: 'var(--success)', fontSize: '11px', fontWeight: 600, textAlign: 'center', marginBottom: 'var(--space-2)' }}>
          ✓ Tutte le serie registrate!
        </div>
      )}

      {/* Chosing results block */}
      {isFinished && evaluationResult && (
        <div className={`suggestion-banner ${getProgressionColor(evaluationResult.result)}`} style={{ padding: '8px var(--space-2)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)' }}>
          <div className="suggestion-text" style={{ fontSize: 'var(--fs-xs)' }}>
            <strong>{getProgressionLabel(evaluationResult.result)}: {evaluationResult.suggestedLoad} kg</strong>
            <div className="text-secondary" style={{ marginTop: '2px', fontSize: '10px' }}>{evaluationResult.reason}</div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2" style={{ marginTop: 'var(--space-2)' }}>
        {!isFinished ? (
          <>
            {loggedSets.length > 0 && (
              <button className="btn btn-success btn-sm" style={{ flex: 1 }} onClick={handleEvaluate}>
                Concludi
              </button>
            )}
            <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={onCancel}>
              Annulla
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" style={{ flex: 2 }} onClick={handleConfirmSave}>
              Salva Sessione
            </button>
            <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => setIsFinished(false)}>
              Indietro
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard({
  exercises,
  sessions,
  mesocycleStates,
  weeklyVolumes,
  getLastSession,
  getSessionsForExercise,
  getMesocycleState,
  forceWeekIncrement,
  onAddExercise,
  onUpdateExercise,
  onDeleteExercise,
  onSaveSession,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [activeLoggingId, setActiveLoggingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedMesoTab, setSelectedMesoTab] = useState<string | null>(null);

  const uniqueMuscleGroups = Array.from(new Set(exercises.map((e) => e.muscleGroup)));

  function handleSaveExercise(data: ExerciseFormData) {
    if (editingExercise) {
      onUpdateExercise(editingExercise.id, data);
    } else {
      onAddExercise(data);
    }
    setShowForm(false);
    setEditingExercise(null);
  }

  function handleEdit(e: React.MouseEvent, exercise: Exercise) {
    e.stopPropagation();
    setEditingExercise(exercise);
    setShowForm(true);
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    if (confirm('Eliminare questo esercizio e tutti i dati storici?')) {
      onDeleteExercise(id);
    }
  }

  const sortedExercises = [...exercises].sort((a, b) => {
    if (a.type === 'compound' && b.type === 'accessory') return -1;
    if (a.type === 'accessory' && b.type === 'compound') return 1;
    return a.order - b.order;
  });

  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">GymOS</h1>
          <div className="page-subtitle" style={{ textTransform: 'capitalize' }}>{today}</div>
        </div>
      </div>

      {/* Section: Mesocycles and Volume Tracking */}
      {uniqueMuscleGroups.length > 0 && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="section-title">Stato Gruppi Muscolari</div>
          <div className="card" style={{ padding: 'var(--space-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 'var(--space-2)' }}>
              {uniqueMuscleGroups.map((group) => {
                const isSelected = selectedMesoTab === group || (!selectedMesoTab && uniqueMuscleGroups[0] === group);
                return (
                  <button
                    key={group}
                    className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setSelectedMesoTab(group)}
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    {group}
                  </button>
                );
              })}
            </div>

            {(() => {
              const activeGroup = selectedMesoTab || uniqueMuscleGroups[0];
              if (!activeGroup) return null;

              const meso = getMesocycleState(activeGroup);
              const weeklyTrend = getWeeklyVolumeTrend(sessions, exercises, activeGroup, 4);
              const currentWeekVol = weeklyTrend[3]?.volume ?? 0;
              const prevWeekVol = weeklyTrend[2]?.volume ?? 0;

              let deltaPct = 0;
              if (prevWeekVol > 0) {
                deltaPct = ((currentWeekVol - prevWeekVol) / prevWeekVol) * 100;
              }

              const overloadWarning = checkEarlyOverloadWarning(exercises, sessions, activeGroup);

              return (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  {meso && (
                    <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-3)' }}>
                      <div>
                        <span className="fw-bold fs-base" style={{ marginRight: 'var(--space-2)' }}>
                          Meso: {meso.phase === 'deload' ? '🔴 Deload' : '⚡ Accumulo'}
                        </span>
                        <span className="text-muted fs-sm">
                          Settimana {meso.currentWeek + 1} di {meso.mesocycleLengthWeeks}
                        </span>
                      </div>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ padding: '4px 8px', minHeight: 'auto', fontSize: '10px' }}
                        onClick={() => forceWeekIncrement(activeGroup)}
                      >
                        ⏩ +1 Settimana
                      </button>
                    </div>
                  )}

                  <div className="flex justify-between items-center" style={{ background: 'var(--bg-elevated)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
                    <div>
                      <div className="fs-xs text-muted">Volume Settimanale Corrente</div>
                      <div className="fw-bold fs-md" style={{ color: 'var(--accent)' }}>
                        {currentWeekVol.toFixed(0)} <span className="fs-xs text-muted">kg*reps</span>
                      </div>
                    </div>
                    {prevWeekVol > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div className="fs-xs text-muted">vs Settimana Scorsa</div>
                        <div className={`fw-bold fs-sm ${deltaPct >= 0 ? 'text-success' : 'text-danger'}`}>
                          {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>

                  <VolumeBarChart weeklyTrend={weeklyTrend} />

                  {overloadWarning.warning && (
                    <div className="suggestion-banner danger" style={{ marginTop: 'var(--space-3)', padding: '8px var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
                      <div className="suggestion-icon" style={{ fontSize: '18px' }}>⚠️</div>
                      <div className="suggestion-text" style={{ fontSize: 'var(--fs-xs)' }}>
                        {overloadWarning.message}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Section: Exercise List */}
      <div className="section-title">I Tuoi Esercizi</div>
      {sortedExercises.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🏋️</div>
          <div className="empty-state-title">Nessun esercizio</div>
          <div className="empty-state-text">
            Aggiungi il tuo primo esercizio per iniziare a tracciare i progressi
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            + Aggiungi esercizio
          </button>
        </div>
      ) : (
        <>
          {sortedExercises.map((ex) => {
            const last = getLastSession(ex.id);
            const suggestedLoad = getNextSessionLoad(ex, last);
            const color = last ? getProgressionColor(last.progressionResult) : null;
            const isExpanded = expandedId === ex.id;
            const isLogging = activeLoggingId === ex.id;

            const plateauReport = detectPlateau(ex, sessions);
            const rirOverestimated = checkRirReliability(ex, sessions);

            const isCompound = ex.type === 'compound';

            return (
              <div
                key={ex.id}
                className="card"
                style={{
                  cursor: 'default',
                  border: isLogging
                    ? '1px solid var(--accent)'
                    : isCompound
                      ? '1px solid rgba(124, 107, 255, 0.25)'
                      : '1px solid var(--border)',
                  borderLeft: isCompound
                    ? '4px solid var(--accent)'
                    : '1px solid var(--border)',
                  opacity: !isCompound && !isExpanded ? 0.85 : 1,
                  padding: isCompound ? 'var(--space-5)' : 'var(--space-4)',
                  boxShadow: isCompound && !isExpanded ? '0 4px 12px rgba(124, 107, 255, 0.04)' : 'none',
                }}
              >
                {/* Main Clickable Row */}
                <div
                  className="exercise-card"
                  onClick={() => {
                    setExpandedId(isExpanded ? null : ex.id);
                    if (isExpanded) {
                      setActiveLoggingId(null);
                    }
                  }}
                >
                  <div className="exercise-card-body">
                    <div
                      className="exercise-card-name"
                      style={{
                        fontWeight: isCompound ? '700' : '600',
                        fontSize: isCompound ? 'var(--fs-md)' : 'var(--fs-base)',
                        letterSpacing: isCompound ? '-0.3px' : 'none',
                      }}
                    >
                      {ex.name}
                      {isCompound && (
                        <span className="text-accent" style={{ fontSize: '10px', marginLeft: '6px', fontWeight: '500', verticalAlign: 'middle', background: 'var(--accent-glow)', padding: '2px 6px', borderRadius: '100px', border: '1px solid rgba(124,107,255,0.2)' }}>
                          ★ Principale
                        </span>
                      )}
                    </div>
                    <div className="exercise-card-meta" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                      <span className="badge badge-neutral" style={{ fontSize: '10px' }}>{ex.muscleGroup}</span>
                      <span>{ex.targetSets} × {ex.repsMin}–{ex.repsMax}</span>
                      {last && (
                        <>
                          <span>·</span>
                          <span className={`badge badge-${color}`}>
                            {getProgressionLabel(last.progressionResult)}
                          </span>
                          <span className="text-muted">{formatDate(last.date)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="exercise-card-load">
                      {suggestedLoad} <span>kg</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 2 }}>oggi</div>
                  </div>
                </div>

                {/* Badges indicators when collapsed */}
                {(plateauReport.isPlateau || rirOverestimated) && !isExpanded && (
                  <div className="flex gap-2" style={{ marginTop: '8px', paddingLeft: isCompound ? '2px' : '0' }}>
                    {plateauReport.isPlateau && (
                      <span className="badge badge-danger" style={{ fontSize: '10px', padding: '2px 6px' }}>
                        ⚠️ Plateau rilevato
                      </span>
                    )}
                    {rirOverestimated && (
                      <span className="badge badge-warning" style={{ fontSize: '10px', padding: '2px 6px' }}>
                        ⚖️ RIR Dubbio
                      </span>
                    )}
                  </div>
                )}

                {/* Expanded Block (In-Place Actions + Inline Logger) */}
                {isExpanded && (
                  <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
                    {/* Action buttons */}
                    {!isLogging && (
                      <div className="flex gap-2">
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ flex: 2 }}
                          onClick={() => setActiveLoggingId(ex.id)}
                        >
                          🏋️ Logga Esercizio
                        </button>
                        <button
                          className="btn btn-outline btn-sm btn-icon"
                          onClick={(e) => handleEdit(e, ex)}
                          title="Modifica"
                        >
                          ✏️
                        </button>
                        <button
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={(e) => handleDelete(e, ex.id)}
                          title="Elimina"
                        >
                          🗑️
                        </button>
                      </div>
                    )}

                    {/* Inline Logger with Celebration */}
                    {isLogging && (
                      <InlineSetLogger
                        exercise={ex}
                        lastSession={last}
                        recentSessions={getSessionsForExercise(ex.id)}
                        mesoState={getMesocycleState(ex.muscleGroup)}
                        onSaveSession={(sets) => {
                          onSaveSession(ex.id, sets);
                        }}
                        onCancel={() => {
                          setActiveLoggingId(null);
                          setExpandedId(null);
                        }}
                      />
                    )}

                    {/* Warning detail panels */}
                    {!isLogging && plateauReport.isPlateau && (
                      <div className="suggestion-banner danger" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)' }}>
                        <div className="suggestion-icon">🛑</div>
                        <div className="suggestion-text" style={{ fontSize: 'var(--fs-xs)' }}>
                          <div className="fw-bold">Esercizio in plateau:</div>
                          <ul style={{ paddingLeft: '16px', marginTop: '4px' }}>
                            {plateauReport.suggestions.map((s, idx) => (
                              <li key={idx} style={{ marginTop: '2px' }}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}

                    {!isLogging && rirOverestimated && (
                      <div className="suggestion-banner warning" style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)' }}>
                        <div className="suggestion-icon">⚖️</div>
                        <div className="suggestion-text" style={{ fontSize: 'var(--fs-xs)' }}>
                          <div className="fw-bold">RIR stimato non ottimale:</div>
                          Dichiari RIR alti ma il carico non sale da settimane. Prova ad allenarti più vicino al cedimento reale.
                        </div>
                      </div>
                    )}

                    {/* Quick stats (only if not logging) */}
                    {!isLogging && last && (
                      <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                        <div>
                          <div className="fs-xs text-muted">Ultima seduta</div>
                          <div className="fw-600 fs-sm">{last.sets.length} serie</div>
                        </div>
                        <div>
                          <div className="fs-xs text-muted">Carico usato</div>
                          <div className="fw-600 fs-sm">{last.sets[0]?.load ?? '—'} kg</div>
                        </div>
                        <div>
                          <div className="fs-xs text-muted">Prossima seduta</div>
                          <div className="fw-600 fs-sm text-accent">{last.suggestedLoad} kg</div>
                        </div>
                        {ex.rirTarget !== null && last.sets.some(s => s.rir !== null) && (
                          <div>
                            <div className="fs-xs text-muted">RIR medio</div>
                            <div className="fw-600 fs-sm">
                              {(last.sets.filter(s => s.rir !== null).reduce((a, s) => a + (s.rir ?? 0), 0) / last.sets.filter(s => s.rir !== null).length).toFixed(1)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* FAB */}
      {exercises.length > 0 && (
        <button className="fab" onClick={() => setShowForm(true)} aria-label="Aggiungi esercizio">
          +
        </button>
      )}

      {/* Exercise Form Modal */}
      {showForm && (
        <ExerciseForm
          initialData={editingExercise ?? undefined}
          onSave={handleSaveExercise}
          onCancel={() => { setShowForm(false); setEditingExercise(null); }}
          title={editingExercise ? 'Modifica esercizio' : 'Nuovo esercizio'}
        />
      )}
    </div>
  );
}
