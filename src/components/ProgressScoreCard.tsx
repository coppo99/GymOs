import React, { useState } from 'react';
import type { ProgressScoreBreakdown } from '../types';
import { getProgressionColor, getProgressionLabel } from '../engine/progression';

interface Props {
  breakdown: ProgressScoreBreakdown;
  suggestedLoad: number;
}

const componentMeta: { key: keyof ProgressScoreBreakdown; label: string; max: number; color: string }[] = [
  { key: 'performanceComponent', label: 'Performance', max: 10, color: '#4fc3f7' },
  { key: 'trendComponent', label: 'Trend', max: 10, color: '#66bb6a' },
  { key: 'rirComponent', label: 'RIR', max: 5, color: '#ffa726' },
  { key: 'fatigueComponent', label: 'Fatica', max: 5, color: '#ab47bc' },
];

function ProgressBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, ((value + max) / (max * 2)) * 100));
  const displayVal = value >= 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  return (
    <div style={{ marginBottom: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{displayVal}</span>
      </div>
      <div style={{ height: '4px', background: 'var(--bg-card)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

export default function ProgressScoreCard({ breakdown, suggestedLoad }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const { total, threshold, decision } = breakdown;
  const maxPossible = 10 * 2 + 10 + 5 + 5;
  const totalPct = Math.max(0, Math.min(100, ((total + maxPossible) / (maxPossible * 2)) * 100));

  const thresholdBars = [
    { label: 'Increase', value: threshold.increaseThreshold, color: '#66bb6a' },
    { label: 'Mantieni', value: threshold.reduceThreshold, color: '#ffa726' },
    { label: 'Riduci', value: threshold.deloadThreshold, color: '#ef5350' },
  ];

  const colorMap: Record<string, string> = {
    increase: 'var(--success)',
    maintain: 'var(--accent)',
    reduce_volume: 'var(--warning)',
    deload: 'var(--danger)',
  };

  const labelMap: Record<string, string> = {
    increase: 'INCREMENTA',
    maintain: 'MANTIENI',
    reduce_volume: 'RIDURRE VOLUME',
    deload: 'DELOAD',
  };

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', border: '1px solid var(--border)', fontSize: '11px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Progress Score
        </span>
        <span style={{ color: colorMap[decision] ?? 'var(--text-primary)', fontWeight: 700, fontSize: '14px' }}>
          {labelMap[decision]}
        </span>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '2px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Totale</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
            {total.toFixed(1)} <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>/ {maxPossible.toFixed(0)}</span>
          </span>
        </div>
        <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
          {thresholdBars.map((t) => {
            const pos = (t.value + maxPossible) / (maxPossible * 2) * 100;
            return (
              <div key={t.label} style={{ position: 'absolute', left: `${pos}%`, top: 0, width: '1px', height: '100%', background: t.color, opacity: 0.6 }} title={`${t.label}: ${t.value}`} />
            );
          })}
          <div style={{ width: `${totalPct}%`, height: '100%', background: colorMap[decision] ?? 'var(--accent)', borderRadius: '3px', transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: 'var(--text-muted)', marginTop: '2px' }}>
          {thresholdBars.map((t) => (
            <span key={t.label} style={{ color: t.color }}>{t.label} {t.value}</span>
          ))}
        </div>
      </div>

      {componentMeta.map(({ key, label, max, color }) => (
        <ProgressBar key={key} value={breakdown[key] as number} max={max} color={color} label={label} />
      ))}

      <button
        onClick={() => setShowDetails(!showDetails)}
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '10px', cursor: 'pointer', padding: '4px 0 0', textDecoration: 'underline', width: '100%', textAlign: 'center' }}
      >
        {showDetails ? 'Nascondi dettagli' : 'Mostra dettagli'}
      </button>

      {showDetails && breakdown.explanation.length > 0 && (
        <div style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', fontSize: '10px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          {breakdown.explanation.map((line, i) => (
            <div key={i} style={{ marginBottom: i < breakdown.explanation.length - 1 ? '4px' : 0 }}>{line}</div>
          ))}
          <div style={{ marginTop: '4px', color: 'var(--text-muted)', fontSize: '9px' }}>
            Prossimo carico consigliato: {suggestedLoad} kg
          </div>
        </div>
      )}
    </div>
  );
}
