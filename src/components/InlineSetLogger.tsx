import React, { useState, useEffect, useRef } from 'react';
import type { Exercise, SessionLog, SetLog, MesocycleState } from '../types';
import {
  getDeloadTargetSets,
  roundToIncrement,
  getNextSessionLoad,
  validateSetValues,
  adjustLoadForNextSet,
  evaluateSession,
  calculateVolumeLoad,
  getProgressionColor,
  getProgressionLabel,
} from '../engine/progression';

export interface InlineLoggerProps {
  exercise: Exercise;
  lastSession: SessionLog | undefined;
  recentSessions: SessionLog[];
  mesoState: MesocycleState | undefined;
  onSaveSession: (sets: SetLog[]) => void;
  onCancel: () => void;
}

export default function InlineSetLogger({
  exercise,
  lastSession,
  recentSessions,
  mesoState,
  onSaveSession,
  onCancel,
}: InlineLoggerProps) {
  const isDeloadPhase = mesoState?.phase === 'deload';
  const targetSets = isDeloadPhase
    ? getDeloadTargetSets(exercise.targetSets)
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

    const warnings = validateSetValues(reps, load, rir);
    const warningMessages = [warnings.reps, warnings.load, warnings.rir]
      .filter(Boolean)
      .join('\n');
    if (warningMessages && !confirm(warningMessages + '\n\nProcedere comunque?')) return;

    const newSet: SetLog = {
      setNumber: loggedSets.length + 1,
      reps,
      load,
      rir,
    };
    const updated = [...loggedSets, newSet];
    setLoggedSets(updated);

    // RIR Autoregulation via progression engine
    let nextLoad = load;
    let feedback: string | null = null;

    if (rir !== null && exercise.rirTarget !== null) {
      const adjustment = adjustLoadForNextSet(load, rir, exercise.rirTarget, exercise.loadIncrement);
      nextLoad = adjustment.suggestedLoad;
      feedback = adjustment.feedback;
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

  function handleShare() {
    const dateStr = new Date().toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const setsSummary = loggedSets.map(s => {
      let text = `${s.reps}×${s.load} kg`;
      if (s.rir !== null) text += ` (RIR ${s.rir})`;
      return text;
    }).join(', ');

    const lines: string[] = [
      `\u{1F3CB}\uFE0F ${exercise.name} \u2014 ${dateStr}`,
      '',
      `\u{1F4CA} ${loggedSets.length} serie: ${setsSummary}`,
      `\u{1F4C8} Volume: ${celebrationData?.todayVolume.toFixed(0) ?? calculateVolumeLoad(loggedSets).toFixed(0)} kg\u00B7reps`,
    ];

    if (evaluationResult) {
      lines.push(`\u{1F3AF} Prossimo: ${getProgressionLabel(evaluationResult.result)} a ${evaluationResult.suggestedLoad} kg`);
    }
    if (celebrationData?.isLoadPR) lines.push('\u{1F3C6} NUOVO RECORD CARICO!');
    if (celebrationData?.isVolumePR) lines.push('\u{1F525} NUOVO RECORD VOLUME!');

    lines.push('', '#GymOS');

    const text = lines.join('\n');

    // Share text
    if (navigator.share) {
      navigator.share({ title: `GymOS \u2014 ${exercise.name}`, text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        alert('Riepilogo copiato negli appunti!');
      }).catch(() => {
        alert(text);
      });
    }
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
        <div style={{ fontSize: '32px', marginBottom: 'var(--space-2)' }}>{'\u{1F389}'}</div>
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
                {'\u{1F3C6}'} NUOVO RECORD DI CARICO: {todayMaxLoad} kg!
              </div>
            )}
            {isVolumePR && (
              <div className="badge badge-accent" style={{ padding: '6px', fontSize: '11px', justifyContent: 'center' }}>
                {'\u{1F525}'} NUOVO RECORD DI VOLUME: {todayVolume.toFixed(0)} kg*reps!
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
                {volDeltaPct >= 0 ? '\u25B2' : '\u25BC'} {Math.abs(volDeltaPct).toFixed(1)}% rispetto a prima
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

        <div className="flex gap-2">
          <button className="btn btn-primary btn-full" onClick={onCancel}>
            Chiudi e Continua
          </button>
          <button className="btn btn-outline btn-sm" onClick={handleShare} style={{ flexShrink: 0, padding: '12px' }} title="Condividi allenamento">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '18px', height: '18px' }}>
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--space-3)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: 'var(--space-3)', border: '1px solid rgba(255,255,255,0.05)' }}>
      {isDeloadPhase && (
        <div className="badge badge-danger mb-2 w-full" style={{ justifyContent: 'center', fontSize: '10px' }}>
          {'\u26A0\uFE0F'} Deload Attivo: target {targetSets} serie, carico consigliato -10%
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
                  {'\u2715'}
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
            {'\u2696\uFE0F'} {intraSessionFeedback}
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
                    placeholder="\u2014"
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
          {'\u2713'} Tutte le serie registrate!
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
