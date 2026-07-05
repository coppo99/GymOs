import React, { useState } from 'react';
import type { Exercise, SessionLog } from '../types';
import {
  getProgressionColor,
  getProgressionLabel,
  calculateVolumeLoad,
  detectPlateau,
  checkRirReliability,
} from '../engine/progression';

interface Props {
  exercises: Exercise[];
  sessions: SessionLog[];
  getSessionsForExercise: (id: string) => SessionLog[];
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

interface ChartProps {
  sessions: SessionLog[];
  metric: 'load' | 'volume';
}

function InteractiveChart({ sessions, metric }: ChartProps) {
  // Show last 8 sessions, chronological (oldest to newest)
  const data = [...sessions].reverse().slice(-8);
  if (data.length < 2) {
    return (
      <div style={{
        height: 160,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: 'var(--fs-sm)',
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
      }}>
        Registra almeno 2 sessioni per visualizzare il grafico di progresso
      </div>
    );
  }

  const values = data.map(s =>
    metric === 'load'
      ? s.suggestedLoad
      : calculateVolumeLoad(s.sets)
  );

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const valRange = maxVal - minVal || 1;

  // Add padding to range for aesthetics
  const padMin = minVal - valRange * 0.15;
  const padMax = maxVal + valRange * 0.15;
  const activeRange = padMax - padMin;

  const width = 500;
  const height = 180;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const points = data.map((s, i) => {
    const x = paddingLeft + (i / (data.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - ((values[i] - padMin) / activeRange) * chartHeight;
    return { x, y, value: values[i], date: formatDate(s.date) };
  });

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');

  // Grid lines
  const gridLines = [0, 0.5, 1];

  return (
    <div style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: 'var(--space-3) var(--space-2) var(--space-2) var(--space-2)' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', fontWeight: 600, paddingLeft: paddingLeft, marginBottom: 'var(--space-2)' }}>
        {metric === 'load' ? 'Carico Consigliato (kg)' : 'Volume Load di Sessione (kg * reps)'}
      </div>

      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
        {/* Definitions for gradients */}
        <defs>
          <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines */}
        {gridLines.map((ratio, idx) => {
          const y = paddingTop + chartHeight * ratio;
          const val = padMax - ratio * activeRange;
          return (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={y}
                x2={width - paddingRight}
                y2={y}
                stroke="var(--border)"
                strokeDasharray="4 4"
              />
              <text
                x={paddingLeft - 8}
                y={y + 4}
                fill="var(--text-muted)"
                fontSize="10"
                textAnchor="end"
              >
                {val.toFixed(metric === 'load' ? 1 : 0)}
              </text>
            </g>
          );
        })}

        {/* Area under the line */}
        {points.length > 1 && (
          <path
            d={`M ${points[0].x} ${paddingTop + chartHeight} L ${polylinePoints} L ${points[points.length - 1].x} ${paddingTop + chartHeight} Z`}
            fill="url(#chartGlow)"
          />
        )}

        {/* Trend Line */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points & labels */}
        {points.map((p, idx) => (
          <g key={idx}>
            {/* Hover circle indicator */}
            <circle
              cx={p.x}
              cy={p.y}
              r="4.5"
              fill="var(--bg-elevated)"
              stroke="var(--accent)"
              strokeWidth="2.5"
            />
            {/* Value Label above point */}
            <text
              x={p.x}
              y={p.y - 8}
              fill="var(--text-primary)"
              fontSize="9"
              fontWeight="700"
              textAnchor="middle"
            >
              {p.value.toFixed(metric === 'load' ? 1 : 0)}
            </text>
            {/* Date Label under point */}
            <text
              x={p.x}
              y={height - 8}
              fill="var(--text-muted)"
              fontSize="9"
              textAnchor="middle"
            >
              {p.date}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function History({ exercises, sessions, getSessionsForExercise }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    exercises[0]?.id ?? null
  );
  const [metricTab, setMetricTab] = useState<'load' | 'volume'>('load');

  const selectedExercise = exercises.find(e => e.id === selectedId);
  const exerciseSessions = selectedId ? getSessionsForExercise(selectedId) : [];

  if (exercises.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Storico</h1>
            <div className="page-subtitle">Cronologia allenamenti per esercizio</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-title">Nessun dato</div>
          <div className="empty-state-text">Inizia ad allenarti per vedere lo storico</div>
        </div>
      </div>
    );
  }

  const plateauReport = selectedExercise ? detectPlateau(selectedExercise, sessions) : null;
  const rirWarning = selectedExercise ? checkRirReliability(selectedExercise, sessions) : false;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Storico</h1>
          <div className="page-subtitle">Cronologia allenamenti per esercizio</div>
        </div>
      </div>

      {/* Exercise Selector */}
      <div style={{ marginBottom: 'var(--space-4)', overflowX: 'auto', display: 'flex', gap: 'var(--space-2)', paddingBottom: 'var(--space-2)' }}>
        {exercises.map((ex) => (
          <button
            key={ex.id}
            className={`btn btn-sm ${selectedId === ex.id ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setSelectedId(ex.id)}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {ex.name}
          </button>
        ))}
      </div>

      {selectedExercise && (
        <>
          {/* Expanded Charts Panel */}
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2)' }}>
              <span className="section-title" style={{ margin: 0 }}>Grafico di Progresso</span>
              <div className="flex gap-1">
                <button
                  className={`btn btn-sm`}
                  style={{ fontSize: '11px', padding: '4px 10px', minHeight: '30px', background: metricTab === 'load' ? 'var(--accent)' : 'var(--bg-card)', color: 'white', border: '1px solid var(--border)' }}
                  onClick={() => setMetricTab('load')}
                >
                  Carico (Kg)
                </button>
                <button
                  className={`btn btn-sm`}
                  style={{ fontSize: '11px', padding: '4px 10px', minHeight: '30px', background: metricTab === 'volume' ? 'var(--accent)' : 'var(--bg-card)', color: 'white', border: '1px solid var(--border)' }}
                  onClick={() => setMetricTab('volume')}
                >
                  Volume
                </button>
              </div>
            </div>

            <InteractiveChart sessions={exerciseSessions} metric={metricTab} />
          </div>

          {/* Exercise Info Card */}
          <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{selectedExercise.name}</div>
                <div className="fs-sm text-secondary">
                  {selectedExercise.targetSets} × {selectedExercise.repsMin}–{selectedExercise.repsMax} reps
                  {' · '}{selectedExercise.currentLoad} kg attuale
                </div>
                <div style={{ marginTop: '4px' }}>
                  <span className="badge badge-neutral" style={{ fontSize: '10px' }}>{selectedExercise.muscleGroup}</span>
                </div>
              </div>
            </div>

            {/* Plateau and RIR Warners inside Card */}
            {plateauReport?.isPlateau && (
              <div className="suggestion-banner danger" style={{ padding: '8px var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)' }}>
                <div className="suggestion-icon" style={{ fontSize: '16px' }}>🛑</div>
                <div className="suggestion-text" style={{ fontSize: 'var(--fs-xs)' }}>
                  <strong>Plateau rilevato.</strong> Suggerimento: {plateauReport.suggestions[0]}
                </div>
              </div>
            )}

            {rirWarning && (
              <div className="suggestion-banner warning" style={{ padding: '8px var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)' }}>
                <div className="suggestion-icon" style={{ fontSize: '16px' }}>⚖️</div>
                <div className="suggestion-text" style={{ fontSize: 'var(--fs-xs)' }}>
                  <strong>RIR Dubbio.</strong> I carichi non aumentano ma segnali RIR alti. Prova ad allenarti più vicino al cedimento reale.
                </div>
              </div>
            )}

            {/* Trend stats */}
            {exerciseSessions.length >= 2 && (() => {
              const first = exerciseSessions[exerciseSessions.length - 1];
              const latest = exerciseSessions[0];
              const loadDiff = latest.suggestedLoad - first.suggestedLoad;

              const latestVol = calculateVolumeLoad(latest.sets);
              const firstVol = calculateVolumeLoad(first.sets);
              const volDiff = latestVol - firstVol;

              return (
                <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <div className="fs-xs text-muted">Carico Attuale</div>
                    <div className="fw-600 fs-sm">{latest.suggestedLoad} kg</div>
                  </div>
                  <div>
                    <div className="fs-xs text-muted">Delta Carico</div>
                    <div className={`fw-600 fs-sm ${loadDiff > 0 ? 'text-success' : loadDiff < 0 ? 'text-danger' : 'text-secondary'}`}>
                      {loadDiff >= 0 ? '+' : ''}{loadDiff} kg
                    </div>
                  </div>
                  <div>
                    <div className="fs-xs text-muted">Volume Attuale</div>
                    <div className="fw-600 fs-sm">{latestVol.toFixed(0)} kg*reps</div>
                  </div>
                  <div>
                    <div className="fs-xs text-muted">Delta Volume</div>
                    <div className={`fw-600 fs-sm ${volDiff > 0 ? 'text-success' : volDiff < 0 ? 'text-danger' : 'text-secondary'}`}>
                      {volDiff >= 0 ? '+' : ''}{volDiff.toFixed(0)}
                    </div>
                  </div>
                </div>
              );
            })()}

            {exerciseSessions.length === 0 && (
              <div className="text-muted fs-sm">Nessuna sessione registrata ancora.</div>
            )}
          </div>

          {/* Session History */}
          {exerciseSessions.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}>
                <div className="fw-600 fs-sm">Cronologia sessioni</div>
              </div>

              <div className="history-row" style={{
                background: 'var(--bg-elevated)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-muted)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                <div>Data</div>
                <div style={{ textAlign: 'right' }}>Reps Totali</div>
                <div style={{ textAlign: 'right' }}>Volume Load</div>
                <div style={{ textAlign: 'right' }}>Risultato</div>
              </div>

              {exerciseSessions.map((session) => {
                const color = getProgressionColor(session.progressionResult);
                const totalReps = session.sets.reduce((a, s) => a + s.reps, 0);
                const volume = calculateVolumeLoad(session.sets);

                return (
                  <div key={session.id} className="history-row">
                    <div>
                      <div className="history-date">{formatDate(session.date)}</div>
                      <div className="fs-xs text-muted">{session.sets.length} serie @ {session.sets[0]?.load ?? '—'} kg</div>
                    </div>

                    <div className="history-stat">
                      <div className="history-stat-value">{totalReps}</div>
                      <div className="history-stat-label">reps</div>
                    </div>

                    <div className="history-stat">
                      <div className="history-stat-value">{volume.toFixed(0)}</div>
                      <div className="history-stat-label">kg*reps</div>
                    </div>

                    <div>
                      <span className={`badge badge-${color}`} style={{ fontSize: '0.65rem' }}>
                        {getProgressionLabel(session.progressionResult)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Per-set breakdown for last session */}
          {exerciseSessions.length > 0 && (
            <>
              <div className="section-title">Ultima sessione — dettaglio serie</div>
              <div className="card" style={{ padding: 0 }}>
                {exerciseSessions[0].sets.map((set) => (
                  <div key={set.setNumber} className="logged-set" style={{
                    margin: 0,
                    borderRadius: 0,
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <div className="logged-set-num">#{set.setNumber}</div>
                    <div className="logged-set-data">
                      <div className="logged-set-item">
                        <div className="logged-set-value">{set.reps}</div>
                        <div className="logged-set-unit">reps</div>
                      </div>
                      <div className="logged-set-item">
                        <div className="logged-set-value">{set.load}</div>
                        <div className="logged-set-unit">kg</div>
                      </div>
                      {set.rir !== null && (
                        <div className="logged-set-item">
                          <div className="logged-set-value">{set.rir}</div>
                          <div className="logged-set-unit">RIR</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
