/**
 * Focus Mode Widget Component
 *
 * Distraction-free task focus view with timer and progress tracking.
 * ADHD-optimized: single task view, Pomodoro-style timer, break reminders.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTasks, useOpenAI } from '../hooks/useOpenAI';
import type { Task } from '../types/openai';
import { cn } from '../utils/cn';
import {
  Target,
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  Clock,
  Coffee,
  Zap,
  ChevronRight,
  Volume2,
  VolumeX,
  Minimize2,
  Maximize2,
  SkipForward,
  Battery,
} from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import * as Dialog from '@radix-ui/react-dialog';

interface FocusModeWidgetProps {
  task?: Task;
  onComplete?: (task: Task) => void;
  onExit?: () => void;
  defaultDuration?: number; // in minutes
}

type TimerState = 'idle' | 'running' | 'paused' | 'break';

const FOCUS_DURATION = 25; // Pomodoro
const SHORT_BREAK = 5;
const LONG_BREAK = 15;

export function FocusModeWidget({
  task,
  onComplete,
  onExit,
  defaultDuration = FOCUS_DURATION,
}: FocusModeWidgetProps) {
  const { theme, requestFullscreen, requestInline, sendMessage } = useOpenAI();
  const { completeTask } = useTasks();

  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [timeRemaining, setTimeRemaining] = useState(defaultDuration * 60);
  const [totalTime, setTotalTime] = useState(defaultDuration * 60);
  const [pomodorosCompleted, setPomodorosCompleted] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isDark = theme === 'dark';

  // Timer logic
  useEffect(() => {
    if (timerState === 'running') {
      intervalRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            handleTimerComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [timerState]);

  const handleTimerComplete = useCallback(() => {
    setTimerState('idle');

    if (timerState === 'running') {
      // Focus session completed
      setPomodorosCompleted((prev) => prev + 1);

      if (soundEnabled) {
        // Play completion sound (in a real app)
        console.log('🔔 Timer complete!');
      }

      // Suggest break
      const isLongBreak = (pomodorosCompleted + 1) % 4 === 0;
      const breakDuration = isLongBreak ? LONG_BREAK : SHORT_BREAK;

      setTimeRemaining(breakDuration * 60);
      setTotalTime(breakDuration * 60);
      setTimerState('break');

      sendMessage(`Completed a ${FOCUS_DURATION} minute focus session on "${task?.title}"`);
    } else if (timerState === 'break') {
      // Break completed, ready for next focus
      setTimeRemaining(FOCUS_DURATION * 60);
      setTotalTime(FOCUS_DURATION * 60);
    }
  }, [timerState, pomodorosCompleted, soundEnabled, task, sendMessage]);

  const startTimer = () => {
    setTimerState('running');
  };

  const pauseTimer = () => {
    setTimerState('paused');
  };

  const resumeTimer = () => {
    setTimerState('running');
  };

  const resetTimer = () => {
    setTimerState('idle');
    setTimeRemaining(FOCUS_DURATION * 60);
    setTotalTime(FOCUS_DURATION * 60);
  };

  const skipBreak = () => {
    setTimerState('idle');
    setTimeRemaining(FOCUS_DURATION * 60);
    setTotalTime(FOCUS_DURATION * 60);
  };

  const handleCompleteTask = async () => {
    if (task) {
      await completeTask(task.id);
      onComplete?.(task);
      sendMessage(`Completed task: "${task.title}" after ${pomodorosCompleted} pomodoros`);
    }
  };

  const toggleFullscreen = async () => {
    if (isFullscreen) {
      await requestInline();
    } else {
      await requestFullscreen();
    }
    setIsFullscreen(!isFullscreen);
  };

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = ((totalTime - timeRemaining) / totalTime) * 100;

  if (!task) {
    return (
      <div
        className={cn(
          'rounded-xl border shadow-sm p-8 text-center',
          isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        )}
      >
        <Target
          className={cn(
            'w-12 h-12 mx-auto mb-4',
            isDark ? 'text-gray-600' : 'text-gray-300'
          )}
        />
        <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>
          Select a task to start Focus Mode
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border shadow-sm overflow-hidden',
        isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200',
        isFullscreen && 'fixed inset-0 z-50 rounded-none'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'px-4 py-3 border-b flex items-center justify-between',
          timerState === 'break'
            ? 'bg-green-600 border-green-700'
            : isDark
            ? 'border-gray-700 bg-gray-800'
            : 'border-gray-200 bg-gray-50'
        )}
      >
        <div className="flex items-center gap-2">
          {timerState === 'break' ? (
            <Coffee className="w-5 h-5 text-white" />
          ) : (
            <Target className="w-5 h-5 text-purple-500" />
          )}
          <h2
            className={cn(
              'font-semibold',
              timerState === 'break' ? 'text-white' : isDark ? 'text-white' : 'text-gray-900'
            )}
          >
            {timerState === 'break' ? 'Break Time' : 'Focus Mode'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              timerState === 'break'
                ? 'hover:bg-green-500 text-white'
                : isDark
                ? 'hover:bg-gray-700 text-gray-400'
                : 'hover:bg-gray-100 text-gray-500'
            )}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleFullscreen}
            className={cn(
              'p-2 rounded-lg transition-colors',
              timerState === 'break'
                ? 'hover:bg-green-500 text-white'
                : isDark
                ? 'hover:bg-gray-700 text-gray-400'
                : 'hover:bg-gray-100 text-gray-500'
            )}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          {onExit && (
            <button
              onClick={onExit}
              className={cn(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                timerState === 'break'
                  ? 'bg-green-500 text-white hover:bg-green-400'
                  : isDark
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              )}
            >
              Exit
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className={cn('p-8', isFullscreen && 'flex flex-col items-center justify-center min-h-[80vh]')}>
        {/* Task Title */}
        <div className="text-center mb-8">
          <h3
            className={cn(
              'text-xl font-bold mb-2',
              isDark ? 'text-white' : 'text-gray-900'
            )}
          >
            {task.title}
          </h3>
          {task.description && (
            <p className={cn('text-sm', isDark ? 'text-gray-400' : 'text-gray-500')}>
              {task.description}
            </p>
          )}
        </div>

        {/* Timer Display */}
        <div className="relative w-48 h-48 mx-auto mb-8">
          {/* Circular Progress */}
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="96"
              cy="96"
              r="88"
              fill="none"
              stroke={isDark ? '#374151' : '#e5e7eb'}
              strokeWidth="8"
            />
            <circle
              cx="96"
              cy="96"
              r="88"
              fill="none"
              stroke={timerState === 'break' ? '#22c55e' : '#8b5cf6'}
              strokeWidth="8"
              strokeDasharray={553}
              strokeDashoffset={553 - (553 * progress) / 100}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>

          {/* Time Display */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={cn(
                'text-5xl font-mono font-bold',
                timerState === 'break' ? 'text-green-500' : isDark ? 'text-white' : 'text-gray-900'
              )}
            >
              {formatTime(timeRemaining)}
            </span>
            <span
              className={cn(
                'text-sm mt-1',
                isDark ? 'text-gray-400' : 'text-gray-500'
              )}
            >
              {timerState === 'break'
                ? 'Break'
                : timerState === 'running'
                ? 'Focus'
                : timerState === 'paused'
                ? 'Paused'
                : 'Ready'}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {timerState === 'idle' && (
            <button
              onClick={startTimer}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
            >
              <Play className="w-5 h-5" />
              Start Focus
            </button>
          )}

          {timerState === 'running' && (
            <button
              onClick={pauseTimer}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-yellow-500 text-white hover:bg-yellow-600 transition-colors"
            >
              <Pause className="w-5 h-5" />
              Pause
            </button>
          )}

          {timerState === 'paused' && (
            <>
              <button
                onClick={resumeTimer}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
              >
                <Play className="w-5 h-5" />
                Resume
              </button>
              <button
                onClick={resetTimer}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-xl font-medium transition-colors',
                  isDark
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                )}
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            </>
          )}

          {timerState === 'break' && (
            <button
              onClick={skipBreak}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <SkipForward className="w-5 h-5" />
              Skip Break
            </button>
          )}
        </div>

        {/* Stats */}
        <div
          className={cn(
            'flex items-center justify-center gap-6 text-sm',
            isDark ? 'text-gray-400' : 'text-gray-500'
          )}
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-500" />
            <span>{pomodorosCompleted} pomodoros</span>
          </div>

          {task.estimatedTime && (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>Est. {task.estimatedTime}m</span>
            </div>
          )}

          {task.energyRequired && (
            <div className="flex items-center gap-2">
              <Battery className="w-4 h-4" />
              <span className="capitalize">{task.energyRequired} energy</span>
            </div>
          )}
        </div>

        {/* Complete Task Button */}
        {timerState !== 'running' && (
          <div className="mt-8 text-center">
            <button
              onClick={handleCompleteTask}
              className={cn(
                'flex items-center gap-2 px-6 py-3 rounded-xl font-medium mx-auto transition-colors',
                'bg-green-600 text-white hover:bg-green-700'
              )}
            >
              <CheckCircle2 className="w-5 h-5" />
              Mark Complete
            </button>
          </div>
        )}
      </div>

      {/* Footer Tips */}
      <div
        className={cn(
          'px-4 py-3 border-t text-center text-xs',
          isDark ? 'border-gray-700 bg-gray-800 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'
        )}
      >
        {timerState === 'break' ? (
          <span>💡 Take a short walk, stretch, or get some water</span>
        ) : timerState === 'running' ? (
          <span>🎯 Stay focused! Avoid checking notifications</span>
        ) : (
          <span>⏱️ Pomodoro: 25min focus → 5min break → repeat</span>
        )}
      </div>
    </div>
  );
}

export default FocusModeWidget;
