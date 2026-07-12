import type { SessionLog, Exercise } from '../types';
import { countHardSets } from '../engine/progression';
import { todayIso } from './storage';

export interface DailyGroupSummary {
  muscleGroup: string;
  exercises: { name: string; setsCount: number; hardSets: number }[];
  totalHardSets: number;
  totalSets: number;
}

export function buildDailySummary(
  sessions: SessionLog[],
  exercises: Exercise[]
): { groups: DailyGroupSummary[]; totalHardSets: number; totalSets: number } {
  const today = todayIso();
  const todaySessions = sessions.filter((s) => s.date === today);

  const groupMap = new Map<string, DailyGroupSummary>();

  for (const s of todaySessions) {
    const ex = exercises.find((e) => e.id === s.exerciseId);
    if (!ex) continue;

    if (!groupMap.has(ex.muscleGroup)) {
      groupMap.set(ex.muscleGroup, { muscleGroup: ex.muscleGroup, exercises: [], totalHardSets: 0, totalSets: 0 });
    }
    const g = groupMap.get(ex.muscleGroup)!;
    const hs = countHardSets(s.sets);
    g.exercises.push({ name: ex.name, setsCount: s.sets.length, hardSets: hs });
    g.totalHardSets += hs;
    g.totalSets += s.sets.length;
  }

  const groups = Array.from(groupMap.values());
  const totalHardSets = groups.reduce((a, g) => a + g.totalHardSets, 0);
  const totalSets = groups.reduce((a, g) => a + g.totalSets, 0);

  return { groups, totalHardSets, totalSets };
}

export function drawDailySummaryToBlob(
  dateStr: string,
  groups: DailyGroupSummary[],
  totalHardSets: number,
  totalSets: number
): Promise<Blob | null> {
  const W = 1080;
  const pad = 60;
  const headerH = 220;
  const footerH = 120;
  const groupHeaderH = 80;
  const exRowH = 60;
  const groupGap = 20;

  let contentH = 0;
  for (const g of groups) {
    contentH += groupHeaderH + g.exercises.length * exRowH + groupGap;
  }

  const H = Math.max(1080, headerH + contentH + footerH + pad * 2);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);

  ctx.fillStyle = '#0d0d12';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#7c6bff';
  ctx.fillRect(0, 0, W, 8);

  ctx.fillStyle = '#f0f0f8';
  ctx.font = 'bold 48px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('\u{1F3CB}\uFE0F GymOS \u2014 Riepilogo Allenamento', W / 2, 90);

  ctx.fillStyle = '#9898b8';
  ctx.font = '28px Inter, sans-serif';
  ctx.fillText(dateStr, W / 2, 140);

  const sepY = 180;
  ctx.strokeStyle = 'rgba(124,107,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad, sepY);
  ctx.lineTo(W - pad, sepY);
  ctx.stroke();

  let y = headerH;

  for (const g of groups) {
    const bgGrad = ctx.createLinearGradient(pad, y, W - pad, y);
    bgGrad.addColorStop(0, 'rgba(124,107,255,0.1)');
    bgGrad.addColorStop(1, 'rgba(124,107,255,0.02)');
    ctx.fillStyle = bgGrad;
    const headerBgH = groupHeaderH + 4;
    ctx.beginPath();
    ctx.roundRect(pad, y - 8, W - pad * 2, headerBgH, 8);
    ctx.fill();

    ctx.fillStyle = '#7c6bff';
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(g.muscleGroup, pad + 16, y + 36);

    ctx.fillStyle = '#9898b8';
    ctx.font = '22px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${g.totalHardSets} hard sets \u00B7 ${g.totalSets} serie`, W - pad - 16, y + 36);

    y += groupHeaderH;

    for (const ex of g.exercises) {
      ctx.fillStyle = '#21212e';
      ctx.beginPath();
      ctx.roundRect(pad + 8, y - 4, W - pad * 2 - 16, exRowH - 8, 6);
      ctx.fill();

      ctx.fillStyle = '#f0f0f8';
      ctx.font = '24px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(ex.name, pad + 24, y + 32);

      ctx.fillStyle = '#9898b8';
      ctx.textAlign = 'right';
      ctx.fillText(`${ex.setsCount} serie \u00B7 ${ex.hardSets} hard sets`, W - pad - 24, y + 32);

      y += exRowH;
    }

    y += groupGap;
  }

  const totalY = y + 20;
  ctx.fillStyle = '#7c6bff';
  ctx.fillRect(pad, totalY - 8, W - pad * 2, 2);

  ctx.fillStyle = '#f0f0f8';
  ctx.font = 'bold 36px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Totale', pad + 16, totalY + 40);

  ctx.textAlign = 'right';
  ctx.fillText(`${totalHardSets} hard sets \u00B7 ${totalSets} serie`, W - pad - 16, totalY + 40);

  const footY = Math.max(H - footerH, totalY + 100);
  ctx.fillStyle = '#5a5a78';
  ctx.font = '24px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('#GymOS', W / 2, footY + 40);

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
