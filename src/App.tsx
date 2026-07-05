import React, { useState } from 'react';
import './index.css';
import useStore from './store/useStore';
import type { ActiveView } from './types';
import Dashboard from './components/Dashboard';
import NextWorkout from './components/NextWorkout';
import History from './components/History';
import ExerciseManager from './components/ExerciseManager';

// ─── Icons ────────────────────────────────────────────────────────────────────
function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function IconList() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

// ─── Tab Config ───────────────────────────────────────────────────────────────
const TABS: { id: ActiveView; label: string; Icon: () => React.ReactElement }[] = [
  { id: 'dashboard',    label: 'Oggi',     Icon: IconHome },
  { id: 'next-workout', label: 'Prossima', Icon: IconCalendar },
  { id: 'history',      label: 'Storico',  Icon: IconChart },
  { id: 'exercises',    label: 'Esercizi', Icon: IconList },
];

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');

  const store = useStore();

  return (
    <div className="app-shell">
      <main className="main-content">
        {activeView === 'dashboard' && (
          <Dashboard
            exercises={store.exercises}
            sessions={store.sessions}
            mesocycleStates={store.mesocycleStates}
            weeklyVolumes={store.weeklyVolumes}
            getLastSession={store.getLastSession}
            getSessionsForExercise={store.getSessionsForExercise}
            getMesocycleState={store.getMesocycleState}
            forceWeekIncrement={store.forceWeekIncrement}
            onAddExercise={store.addExercise}
            onUpdateExercise={store.updateExercise}
            onDeleteExercise={store.deleteExercise}
            onSaveSession={store.saveSessionDirect}
          />
        )}
        {activeView === 'next-workout' && (
          <NextWorkout
            exercises={store.exercises}
            getLastSession={store.getLastSession}
            getMesocycleState={store.getMesocycleState}
          />
        )}
        {activeView === 'history' && (
          <History
            exercises={store.exercises}
            sessions={store.sessions}
            getSessionsForExercise={store.getSessionsForExercise}
          />
        )}
        {activeView === 'exercises' && (
          <ExerciseManager
            exercises={store.exercises}
            onAdd={store.addExercise}
            onUpdate={store.updateExercise}
            onDelete={store.deleteExercise}
          />
        )}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="tab-bar">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`tab-${id}`}
            className={`tab-btn ${activeView === id ? 'active' : ''}`}
            onClick={() => setActiveView(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
