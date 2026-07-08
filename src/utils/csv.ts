import type { AppState, Exercise, SessionLog, SetLog, MesocycleState, WeeklyVolumeLog } from '../types';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function esc(value: string | number | null | undefined): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function parseLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { result.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
  }
  result.push(cur.trim());
  return result;
}

// ─── Sections ─────────────────────────────────────────────────────────────────

const SECTION_EXERCISES = '# EXERCISES';
const SECTION_SESSIONS = '# SESSIONS';
const SECTION_SETS = '# SETS';
const SECTION_MESO = '# MESOCYCLESTATES';
const SECTION_VOLUMES = '# WEEKLYVOLUMES';

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportToCsv(state: AppState): string {
  const lines: string[] = [];

  lines.push('# GYMOS CSV v1');
  lines.push('# EXPORTED: ' + new Date().toISOString());
  lines.push('');

  // Exercises
  lines.push(SECTION_EXERCISES);
  lines.push('id,name,muscleGroup,targetSets,repsMin,repsMax,currentLoad,loadIncrement,rirTarget,createdAt,order');
  for (const ex of state.exercises) {
    lines.push([
      esc(ex.id), esc(ex.name), esc(ex.muscleGroup),
      esc(ex.targetSets), esc(ex.repsMin), esc(ex.repsMax),
      esc(ex.currentLoad), esc(ex.loadIncrement), esc(ex.rirTarget),
      esc(ex.createdAt), esc(ex.order),
    ].join(','));
  }
  lines.push('');

  // Sessions
  lines.push(SECTION_SESSIONS);
  lines.push('id,exerciseId,date,progressionResult,suggestedLoad,notes');
  for (const s of state.sessions) {
    lines.push([
      esc(s.id), esc(s.exerciseId), esc(s.date),
      esc(s.progressionResult), esc(s.suggestedLoad), esc(s.notes),
    ].join(','));
  }
  lines.push('');

  // Sets (flattened, linked by sessionId)
  lines.push(SECTION_SETS);
  lines.push('sessionId,setNumber,reps,load,rir');
  for (const s of state.sessions) {
    for (const set of s.sets) {
      lines.push([
        esc(s.id), esc(set.setNumber), esc(set.reps),
        esc(set.load), esc(set.rir),
      ].join(','));
    }
  }
  lines.push('');

  // Mesocycle states
  lines.push(SECTION_MESO);
  lines.push('muscleGroup,currentWeek,mesocycleLengthWeeks,phase,mev,mrv,lastUpdated');
  for (const m of state.mesocycleStates) {
    lines.push([
      esc(m.muscleGroup), esc(m.currentWeek), esc(m.mesocycleLengthWeeks),
      esc(m.phase), esc(m.mev), esc(m.mrv), esc(m.lastUpdated),
    ].join(','));
  }
  lines.push('');

  // Weekly volumes
  lines.push(SECTION_VOLUMES);
  lines.push('muscleGroup,weekStartDate,totalVolumeLoad,effectiveVolumeLoad,setCount');
  for (const v of state.weeklyVolumes) {
    lines.push([
      esc(v.muscleGroup), esc(v.weekStartDate),
      esc(v.totalVolumeLoad), esc(v.effectiveVolumeLoad), esc(v.setCount),
    ].join(','));
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface CsvImportResult {
  exercises: Exercise[];
  sessions: SessionLog[];
  mesocycleStates: MesocycleState[];
  weeklyVolumes: WeeklyVolumeLog[];
  errors: string[];
}

function toNum(raw: string): number {
  const n = Number(raw);
  if (isNaN(n)) throw new Error('invalid number: ' + raw);
  return n;
}

function toNumOrNull(raw: string): number | null {
  if (raw === '' || raw.toLowerCase() === 'null') return null;
  return toNum(raw);
}

export function importFromCsv(text: string): CsvImportResult {
  const result: CsvImportResult = {
    exercises: [],
    sessions: [],
    mesocycleStates: [],
    weeklyVolumes: [],
    errors: [],
  };

  const rawLines = text.split(/\r?\n/);
  const lines = rawLines
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('# GYMOS') && !l.startsWith('# EXPORTED'));

  let currentSection: string | null = null;
  let headerParsed = false;

  function finishSection() {
    headerParsed = false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#')) {
      finishSection();
      currentSection = line;
      continue;
    }

    if (!headerParsed) {
      headerParsed = true; // skip header row
      continue;
    }

    const cols = parseLine(line);

    try {
      switch (currentSection) {
        case SECTION_EXERCISES: {
          if (cols.length < 11) { result.errors.push(`Row ${i + 1}: expected 11 columns for exercise, got ${cols.length}`); break; }
          result.exercises.push({
            id: cols[0], name: cols[1], muscleGroup: cols[2],
            targetSets: toNum(cols[3]), repsMin: toNum(cols[4]), repsMax: toNum(cols[5]),
            currentLoad: toNum(cols[6]), loadIncrement: toNum(cols[7]),
            rirTarget: toNumOrNull(cols[8]),
            createdAt: cols[9], order: toNum(cols[10]),
          });
          break;
        }
        case SECTION_SESSIONS: {
          if (cols.length < 6) { result.errors.push(`Row ${i + 1}: expected 6 columns for session, got ${cols.length}`); break; }
          const session: SessionLog = {
            id: cols[0], exerciseId: cols[1], date: cols[2],
            progressionResult: cols[3] as SessionLog['progressionResult'],
            suggestedLoad: toNum(cols[4]),
            notes: cols[5] || undefined,
            sets: [],
          };
          result.sessions.push(session);
          break;
        }
        case SECTION_SETS: {
          if (cols.length < 5) { result.errors.push(`Row ${i + 1}: expected 5 columns for set, got ${cols.length}`); break; }
          const sessionId = cols[0];
          const setLog: SetLog = {
            setNumber: toNum(cols[1]), reps: toNum(cols[2]),
            load: toNum(cols[3]), rir: toNumOrNull(cols[4]),
          };
          const parent = result.sessions.find((s) => s.id === sessionId);
          if (parent) {
            parent.sets.push(setLog);
          } else {
            result.errors.push(`Row ${i + 1}: set references unknown session ${sessionId}`);
          }
          break;
        }
        case SECTION_MESO: {
          if (cols.length < 7) { result.errors.push(`Row ${i + 1}: expected 7 columns for mesocycle state, got ${cols.length}`); break; }
          result.mesocycleStates.push({
            muscleGroup: cols[0], currentWeek: toNum(cols[1]),
            mesocycleLengthWeeks: toNum(cols[2]),
            phase: cols[3] as MesocycleState['phase'],
            mev: toNum(cols[4]), mrv: toNum(cols[5]),
            lastUpdated: cols[6],
          });
          break;
        }
        case SECTION_VOLUMES: {
          if (cols.length < 5) { result.errors.push(`Row ${i + 1}: expected 5 columns for weekly volume, got ${cols.length}`); break; }
          result.weeklyVolumes.push({
            muscleGroup: cols[0], weekStartDate: cols[1],
            totalVolumeLoad: toNum(cols[2]),
            effectiveVolumeLoad: toNum(cols[3]),
            setCount: toNum(cols[4]),
          });
          break;
        }
        default:
          // skip lines before any known section
          break;
      }
    } catch (e) {
      result.errors.push(`Row ${i + 1}: ${(e as Error).message}`);
    }
  }

  return result;
}

// ─── Download helper ──────────────────────────────────────────────────────────

export function downloadCsv(content: string, filename: string = 'gymos-export.csv'): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
