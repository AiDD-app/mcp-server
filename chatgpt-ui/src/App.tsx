/**
 * AiDD ChatGPT App - Main Entry Point
 *
 * Demo app showing all available widgets.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useOpenAI } from './hooks/useOpenAI';
import { TaskPriorityDashboard } from './components/TaskPriorityDashboard';
import { ActionItemExtractionPreview } from './components/ActionItemExtractionPreview';
import { EnergyBasedTaskSelector } from './components/EnergyBasedTaskSelector';
import { QuickCaptureForm } from './components/QuickCaptureForm';
import { DependencyGraph } from './components/DependencyGraph';
import { FocusModeWidget } from './components/FocusModeWidget';
import { AIScoringResultsCard } from './components/AIScoringResultsCard';
import type { Task } from './types/openai';
import './index.css';

type WidgetView = 'dashboard' | 'extraction' | 'energy' | 'capture' | 'dependencies' | 'focus' | 'scoring';

export default function App() {
  const { theme, isReady, toolResponseMetadata } = useOpenAI();
  const [currentView, setCurrentView] = useState<WidgetView>('dashboard');
  const [focusTask, setFocusTask] = useState<Task | null>(null);

  const isDark = theme === 'dark';

  const viewFromMetadata = useMemo<WidgetView | null>(() => {
    if (!toolResponseMetadata) return null;
    const template = toolResponseMetadata['openai/outputTemplate'];
    if (typeof template === 'string') {
      switch (template) {
        case 'ui://widget/task-dashboard.html':
          return 'dashboard';
        case 'ui://widget/action-items.html':
          return 'extraction';
        case 'ui://widget/energy-selector.html':
          return 'energy';
        case 'ui://widget/quick-capture.html':
          return 'capture';
        case 'ui://widget/dependencies.html':
          return 'dependencies';
        case 'ui://widget/focus-mode.html':
          return 'focus';
        case 'ui://widget/ai-scoring.html':
          return 'scoring';
        default:
          return null;
      }
    }
    const invocation = toolResponseMetadata.invocation;
    if (typeof invocation === 'string') {
      if (invocation === 'list_tasks') return 'dashboard';
      if (invocation === 'list_action_items' || invocation === 'extract_action_items' || invocation === 'convert_to_tasks') {
        return 'extraction';
      }
      if (invocation === 'create_task') return 'capture';
      if (invocation === 'score_tasks' || invocation === 'check_ai_jobs') return 'scoring';
    }
    return null;
  }, [toolResponseMetadata]);

  useEffect(() => {
    if (viewFromMetadata && viewFromMetadata !== currentView) {
      setCurrentView(viewFromMetadata);
    }
  }, [viewFromMetadata, currentView]);

  const handleTaskSelect = (task: Task) => {
    console.log('Task selected:', task);
  };

  const handleStartFocusMode = (task: Task) => {
    setFocusTask(task);
    setCurrentView('focus');
  };

  const handleExitFocusMode = () => {
    setFocusTask(null);
    setCurrentView('dashboard');
  };

  if (!isReady) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-sm opacity-60">Loading AiDD...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* Navigation */}
      <nav className={`sticky top-0 z-40 border-b ${isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center gap-1 overflow-x-auto py-2 -mx-4 px-4">
            {[
              { id: 'dashboard', label: '📊 Dashboard' },
              { id: 'extraction', label: '📝 Extraction' },
              { id: 'energy', label: '🔋 Energy' },
              { id: 'capture', label: '⚡ Capture' },
              { id: 'dependencies', label: '🔗 Dependencies' },
              { id: 'focus', label: '🎯 Focus' },
              { id: 'scoring', label: '🧠 AI Scoring' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id as WidgetView)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  currentView === item.id
                    ? 'bg-purple-600 text-white'
                    : isDark
                    ? 'text-gray-300 hover:bg-gray-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-4xl mx-auto p-4">
        {currentView === 'dashboard' && (
          <TaskPriorityDashboard
            onTaskSelect={handleTaskSelect}
            maxTasks={10}
          />
        )}

        {currentView === 'extraction' && (
          <ActionItemExtractionPreview
            onConvertToTasks={(ids) => console.log('Converting:', ids)}
          />
        )}

        {currentView === 'energy' && (
          <EnergyBasedTaskSelector
            onTaskSelect={handleTaskSelect}
            onStartFocusMode={handleStartFocusMode}
          />
        )}

        {currentView === 'capture' && (
          <QuickCaptureForm
            onTaskCreated={(task) => console.log('Created:', task)}
            defaultExpanded={true}
          />
        )}

        {currentView === 'dependencies' && (
          <DependencyGraph onTaskSelect={handleTaskSelect} />
        )}

        {currentView === 'focus' && (
          <FocusModeWidget
            task={focusTask || undefined}
            onComplete={handleTaskSelect}
            onExit={handleExitFocusMode}
          />
        )}

        {currentView === 'scoring' && (
          <AIScoringResultsCard
            onTaskSelect={handleTaskSelect}
            showRecommendations={true}
          />
        )}
      </main>
    </div>
  );
}
