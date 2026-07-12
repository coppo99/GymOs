interface VolumeBarChartProps {
  weeklyTrend: { weekStart: string; volume: number; hardSets: number; setCount: number }[];
  mev: number;
  mrv: number;
}

export default function VolumeBarChart({ weeklyTrend, mev, mrv }: VolumeBarChartProps) {
  const maxHardSets = Math.max(...weeklyTrend.map(w => w.hardSets), 0) || 1;

  return (
    <div style={{ marginTop: 'var(--space-3)', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', padding: 'var(--space-3)' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '6px' }}>
        Hard Sets Ultimi 30 Giorni
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: 80, paddingTop: '10px', position: 'relative' }}>
        {weeklyTrend.map((w, idx) => {
          const barHeight = w.hardSets > 0 ? (w.hardSets / maxHardSets) * (80 - 25) : 4;
          const rawHeight = w.volume > 0 ? (w.volume / maxHardSets) * (80 - 25) : 0;
          const date = new Date(w.weekStart + 'T00:00:00');
          const dateLabel = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

          return (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              {w.hardSets > 0 && (
                <span style={{ fontSize: '9px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {w.hardSets}
                </span>
              )}
              <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
                {rawHeight > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      width: '28px',
                      height: `${rawHeight}px`,
                      background: 'rgba(124,107,255,0.15)',
                      borderRadius: '3px 3px 0 0',
                      bottom: 0,
                    }}
                  />
                )}
                <div
                  style={{
                    width: '16px',
                    height: `${barHeight}px`,
                    background: 'linear-gradient(to top, var(--accent) 30%, var(--accent-hover) 100%)',
                    borderRadius: '3px 3px 0 0',
                    boxShadow: '0 2px 8px var(--accent-glow)',
                    transition: 'height 0.4s ease',
                    position: 'relative',
                    zIndex: 1,
                  }}
                />
              </div>
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
