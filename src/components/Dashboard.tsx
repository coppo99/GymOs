import React, { useState, useRef } from 'react';
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
  getWeeklyVolumeTrend,
  detectPlateau,
  checkEarlyOverloadWarning,
  checkRirReliability,
  getVolumeStatus,
  calculateVolumeLoad,
  DEFAULT_MEV,
  DEFAULT_MRV,
} from '../engine/progression';
import ExerciseForm from './ExerciseForm';
import VolumeBarChart from './VolumeBarChart';
import InlineSetLogger from './InlineSetLogger';
import { exportToCsv, downloadCsv, importFromCsv } from '../utils/csv';
import type { CsvImportResult } from '../utils/csv';
import { buildDailySummary, drawDailySummaryToBlob } from '../utils/dailySummaryImage';

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
  importState: (data: CsvImportResult) => void;
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
  importState,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [activeLoggingId, setActiveLoggingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedMesoTab, setSelectedMesoTab] = useState<string | null>(null);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleExport() {
    const csv = exportToCsv({
      exercises,
      sessions,
      mesocycleStates,
      weeklyVolumes,
      lastUpdated: new Date().toISOString(),
    });
    downloadCsv(csv);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = importFromCsv(text);
      if (result.exercises.length === 0 && result.errors.length > 0) {
        setImportFeedback(`Errore: ${result.errors[0]}`);
        return;
      }
      const msg = `Importati: ${result.exercises.length} esercizi, ${result.sessions.length} sessioni, ${result.mesocycleStates.length} stati mesociclo, ${result.weeklyVolumes.length} volumi settimanali.`;
      if (!confirm(`Sostituire tutti i dati attuali con quelli importati?\n\n${msg}`)) return;
      importState(result);
      setImportFeedback(`Dati importati con successo. ${msg}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleShareDaily(summary: ReturnType<typeof buildDailySummary>, dateStr: string) {
    const doShare = (blob: Blob | null) => {
      const text = [
        `🏋️ GymOS — Riepilogo Allenamento`,
        dateStr.charAt(0).toUpperCase() + dateStr.slice(1),
        '',
        ...summary.groups.flatMap((g) => [
          `${g.muscleGroup}: ${g.totalVolume.toFixed(0)} kg·reps (${g.totalSets} serie)`,
          ...g.exercises.map((ex) => `  • ${ex.name}: ${ex.setsCount} serie, ${ex.volume.toFixed(0)} kg·reps`),
        ]),
        '',
        `Totale: ${summary.totalVolume.toFixed(0)} kg·reps · ${summary.totalSets} serie`,
        '#GymOS',
      ].join('\n');

      if (blob && navigator.canShare && navigator.canShare({ files: [new File([blob], 'riepilogo.png', { type: 'image/png' })] })) {
        navigator.share({
          title: 'GymOS — Riepilogo Allenamento',
          text,
          files: [new File([blob], 'riepilogo.png', { type: 'image/png' })],
        }).catch(() => {});
      } else if (navigator.share) {
        navigator.share({ title: 'GymOS — Riepilogo Allenamento', text }).catch(() => {});
      } else {
        navigator.clipboard.writeText(text).then(() => {
          alert('Riepilogo copiato negli appunti!');
        }).catch(() => {
          alert(text);
        });
      }
    };

    drawDailySummaryToBlob(dateStr, summary.groups, summary.totalVolume, summary.totalSets).then(doShare);
  }

  const sortedExercises = [...exercises].sort((a, b) => a.order - b.order);

  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">GymOS</h1>
          <div className="page-subtitle" style={{ textTransform: 'capitalize' }}>{today}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>
          Impostazioni
        </button>
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
              const currentWeekEffVol = weeklyTrend[3]?.effectiveVolume ?? 0;
              const currentWeekRawVol = weeklyTrend[3]?.volume ?? 0;
              const prevWeekEffVol = weeklyTrend[2]?.effectiveVolume ?? 0;
              const currentWeekSetCount = weeklyTrend[3]?.setCount ?? 0;

              let deltaPct = 0;
              if (prevWeekEffVol > 0) {
                deltaPct = ((currentWeekEffVol - prevWeekEffVol) / prevWeekEffVol) * 100;
              }

              const volStatus = meso ? getVolumeStatus(currentWeekSetCount, meso.mev, meso.mrv) : 'low';
              const volStatusColors: Record<string, string> = { low: 'var(--warning)', optimal: 'var(--success)', caution: 'var(--warning)', overreaching: 'var(--danger)' };
              const volStatusLabels: Record<string, string> = { low: 'Sotto MEV', optimal: 'Ottimale', caution: 'Oltre range ottimale', overreaching: 'Sopra MRV' };

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
                      <div className="fs-xs text-muted">Volume Effettivo Settimanale</div>
                      <div className="fw-bold fs-md" style={{ color: 'var(--accent)' }}>
                        {currentWeekEffVol.toFixed(0)} <span className="fs-xs text-muted">kg*reps</span>
                      </div>
                      {meso && (
                        <div style={{ marginTop: '2px' }}>
                          <span style={{ fontSize: '10px', color: volStatusColors[volStatus], fontWeight: 600 }}>
                            {volStatusLabels[volStatus]} ({currentWeekSetCount} serie)
                          </span>
                        </div>
                      )}
                    </div>
                    {prevWeekEffVol > 0 && (
                      <div style={{ textAlign: 'right' }}>
                        <div className="fs-xs text-muted">vs Settimana Scorsa</div>
                        <div className={`fw-bold fs-sm ${deltaPct >= 0 ? 'text-success' : 'text-danger'}`}>
                          {deltaPct >= 0 ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
                        </div>
                      </div>
                    )}
                  </div>

                  <VolumeBarChart weeklyTrend={weeklyTrend} mev={meso?.mev ?? DEFAULT_MEV} mrv={meso?.mrv ?? DEFAULT_MRV} />

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

            return (
              <div
                key={ex.id}
                className="card"
                style={{
                  cursor: 'default',
                  border: isLogging ? '1px solid var(--accent)' : '1px solid var(--border)',
                  padding: 'var(--space-5)',
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
                    <div className="exercise-card-name">
                      {ex.name}
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
                  <div className="flex gap-2" style={{ marginTop: '8px' }}>
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

      {/* Daily Summary */}
      {(() => {
        const summary = buildDailySummary(sessions, exercises);
        if (summary.groups.length === 0) return null;
        const dateStr = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        return (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div className="section-title">Riepilogo Oggi</div>
            <div className="card" style={{ padding: 'var(--space-5)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', textTransform: 'capitalize' }}>
                {dateStr}
              </div>
              {summary.groups.map((g) => (
                <div key={g.muscleGroup} style={{ marginBottom: 'var(--space-4)' }}>
                  <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2)' }}>
                    <span className="fw-bold fs-sm" style={{ color: 'var(--accent)' }}>{g.muscleGroup}</span>
                    <span className="text-secondary fs-xs">{g.totalVolume.toFixed(0)} kg·reps · {g.totalSets} serie</span>
                  </div>
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    {g.exercises.map((ex, i) => (
                      <div key={i} className="flex justify-between items-center" style={{ padding: '8px var(--space-3)', borderBottom: i < g.exercises.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <span className="fs-sm">{ex.name}</span>
                        <span className="text-muted fs-xs">{ex.setsCount} serie · {ex.volume.toFixed(0)} kg·reps</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <span className="fw-bold fs-md">Totale</span>
                <span className="fw-bold fs-md text-accent">{summary.totalVolume.toFixed(0)} kg·reps · {summary.totalSets} serie</span>
              </div>
              <button className="btn btn-primary btn-full" onClick={() => handleShareDaily(summary, dateStr)}>
                Condividi Riepilogo
              </button>
            </div>
          </div>
        );
      })()}

      {/* Exercise Form Modal */}
      {showForm && (
        <ExerciseForm
          initialData={editingExercise ?? undefined}
          onSave={handleSaveExercise}
          onCancel={() => { setShowForm(false); setEditingExercise(null); }}
          title={editingExercise ? 'Modifica esercizio' : 'Nuovo esercizio'}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Impostazioni</h2>
              <button className="modal-close" onClick={() => setShowSettings(false)}>×</button>
            </div>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div className="section-title" style={{ marginTop: 0 }}>Gestione Dati</div>
              <p className="text-secondary fs-sm" style={{ marginBottom: 'var(--space-3)' }}>
                Esporta tutti i dati in CSV per un backup, o importa un file CSV precedentemente esportato.
                L'importazione sostituisce completamente i dati correnti.
              </p>
              <div className="flex gap-2">
                <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={handleExport}>
                  Esporta CSV
                </button>
                <button className="btn btn-outline btn-sm" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}>
                  Importa CSV
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              {importFeedback && (
                <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-sm)', color: importFeedback.startsWith('Dati importati') ? 'var(--success)' : 'var(--danger)' }}>
                  {importFeedback}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
