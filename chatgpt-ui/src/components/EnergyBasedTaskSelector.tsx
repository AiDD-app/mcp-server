/**
 * Energy-Based Task Selector Component
 *
 * ADHD-optimized task selection based on current energy level.
 * Users select their energy state and see matching tasks.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useTasks, useOpenAI } from '../hooks/useOpenAI';
import type { Task } from '../types/openai';
import { cn } from '../utils/cn';
import { getTasksFromToolOutput } from '../utils/toolOutput';
import {
  Battery,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  Zap,
  Coffee,
  Moon,
  Clock,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Progress from '@radix-ui/react-progress';

type EnergyLevel = 'low' | 'medium' | 'high';

interface EnergyBasedTaskSelectorProps {
  onTaskSelect?: (task: Task) => void;
  onStartFocusMode?: (task: Task) => void;
}

const ENERGY_OPTIONS = [
  {
    value: 'low' as EnergyLevel,
    label: 'Low Energy',
    description: 'Feeling tired or drained',
    icon: BatteryLow,
    emoji: '😴',
    color: 'green',
    bgClass: 'bg-green-100 dark:bg-green-900/30',
    borderClass: 'border-green-500',
    textClass: 'text-green-600 dark:text-green-400',
  },
  {
    value: 'medium' as EnergyLevel,
    label: 'Medium Energy',
    description: 'Steady and focused',
    icon: BatteryMedium,
    emoji: '🙂',
    color: 'yellow',
    bgClass: 'bg-yellow-100 dark:bg-yellow-900/30',
    borderClass: 'border-yellow-500',
    textClass: 'text-yellow-600 dark:text-yellow-400',
  },
  {
    value: 'high' as EnergyLevel,
    label: 'High Energy',
    description: 'Feeling motivated and sharp',
    icon: BatteryFull,
    emoji: '🔥',
    color: 'red',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    borderClass: 'border-red-500',
    textClass: 'text-red-600 dark:text-red-400',
  },
];

export function EnergyBasedTaskSelector({
  onTaskSelect,
  onStartFocusMode,
}: EnergyBasedTaskSelectorProps) {
  const { theme, toolOutput } = useOpenAI();
  const { tasks: fetchedTasks, loading, fetchTasks, completeTask } = useTasks();
  const [selectedEnergy, setSelectedEnergy] = useState<EnergyLevel | null>(null);

  const isDark = theme === 'dark';

  // Use pre-populated toolOutput.tasks if available (from tool call that triggered this widget)
  // Otherwise fall back to fetched tasks
  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  const tasks = preloadedTasks || fetchedTasks;

  useEffect(() => {
    // Only fetch if no pre-populated data from toolOutput
    if (!preloadedTasks || preloadedTasks.length === 0) {
      fetchTasks('score', 50);
    }
  }, [fetchTasks, preloadedTasks]);

  // Filter tasks by energy level
  const matchingTasks = useMemo(() => {
    if (!selectedEnergy) return [];
    return tasks
      .filter((t) => !t.isCompleted && t.energyRequired === selectedEnergy)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);
  }, [tasks, selectedEnergy]);

  // Get time-based suggestion
  const getTimeOfDaySuggestion = (): EnergyLevel => {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 10) return 'medium'; // Morning ramp-up
    if (hour >= 10 && hour < 14) return 'high'; // Peak hours
    if (hour >= 14 && hour < 17) return 'medium'; // Afternoon
    return 'low'; // Evening/night
  };

  const suggestedEnergy = getTimeOfDaySuggestion();

  const handleEnergySelect = (energy: EnergyLevel) => {
    setSelectedEnergy(energy);
  };

  const getTaskTypeIcon = (type?: string) => {
    switch (type) {
      case 'quick_win':
        return <Zap className="w-4 h-4 text-green-500" />;
      case 'focus_required':
        return <Coffee className="w-4 h-4 text-purple-500" />;
      case 'creative':
        return <Sparkles className="w-4 h-4 text-pink-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <div
      className={cn(
        'rounded-xl border shadow-sm overflow-hidden flex flex-col h-full',
        isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'px-4 py-3 border-b flex items-center gap-2',
          isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
        )}
      >
        <Battery className="w-5 h-5 text-green-500" />
        <h2 className={cn('font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
          How's Your Energy?
        </h2>
      </div>

      {/* Energy Selection */}
      <div className="p-4">
        <p className={cn('text-sm mb-4', isDark ? 'text-gray-400' : 'text-gray-500')}>
          Select your current energy level to find matching tasks:
        </p>

        <RadioGroup.Root
          value={selectedEnergy || ''}
          onValueChange={(v) => handleEnergySelect(v as EnergyLevel)}
          className="grid grid-cols-3 gap-3"
        >
          {ENERGY_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isSelected = selectedEnergy === option.value;
            const isSuggested = option.value === suggestedEnergy && !selectedEnergy;

            return (
              <RadioGroup.Item
                key={option.value}
                value={option.value}
                className={cn(
                  'relative p-4 rounded-xl border-2 cursor-pointer transition-all text-center',
                  isSelected
                    ? cn(option.bgClass, option.borderClass)
                    : isDark
                    ? 'border-gray-700 hover:border-gray-600'
                    : 'border-gray-200 hover:border-gray-300',
                  isSuggested && !isSelected && 'ring-2 ring-offset-2 ring-purple-400'
                )}
              >
                {isSuggested && !isSelected && (
                  <span className="absolute -top-2 -right-2 bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full">
                    Suggested
                  </span>
                )}

                <div className="flex flex-col items-center gap-2">
                  <span className="text-2xl">{option.emoji}</span>
                  <Icon
                    className={cn(
                      'w-6 h-6',
                      isSelected ? option.textClass : isDark ? 'text-gray-400' : 'text-gray-500'
                    )}
                  />
                  <span
                    className={cn(
                      'font-medium text-sm',
                      isSelected ? option.textClass : isDark ? 'text-white' : 'text-gray-900'
                    )}
                  >
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      isDark ? 'text-gray-400' : 'text-gray-500'
                    )}
                  >
                    {option.description}
                  </span>
                </div>
              </RadioGroup.Item>
            );
          })}
        </RadioGroup.Root>
      </div>

      {/* Matching Tasks */}
      {selectedEnergy && (
        <div
          className={cn(
            'border-t',
            isDark ? 'border-gray-700' : 'border-gray-200'
          )}
        >
          <div
            className={cn(
              'px-4 py-2 flex items-center justify-between',
              isDark ? 'bg-gray-800' : 'bg-gray-50'
            )}
          >
            <span
              className={cn(
                'text-sm font-medium',
                isDark ? 'text-gray-300' : 'text-gray-600'
              )}
            >
              {matchingTasks.length > 0
                ? `${matchingTasks.length} matching task${matchingTasks.length > 1 ? 's' : ''}`
                : 'No matching tasks'}
            </span>
            {loading && <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />}
          </div>

          <div className="p-4 space-y-3">
            {matchingTasks.length === 0 ? (
              <div
                className={cn(
                  'text-center py-6',
                  isDark ? 'text-gray-400' : 'text-gray-500'
                )}
              >
                <Moon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No tasks match this energy level</p>
                <p className="text-xs mt-1">Try a different energy level or create new tasks</p>
              </div>
            ) : (
              matchingTasks.map((task, index) => {
                const energyOption = ENERGY_OPTIONS.find((o) => o.value === task.energyRequired);

                return (
                  <div
                    key={task.id}
                    onClick={() => onTaskSelect?.(task)}
                    className={cn(
                      'group p-3 rounded-lg border cursor-pointer transition-all',
                      isDark
                        ? 'border-gray-700 hover:border-green-600 hover:bg-gray-800'
                        : 'border-gray-200 hover:border-green-400 hover:bg-green-50'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      {/* Task number */}
                      <div
                        className={cn(
                          'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
                          energyOption?.bgClass || 'bg-gray-200',
                          energyOption?.textClass || 'text-gray-600'
                        )}
                      >
                        {index + 1}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {getTaskTypeIcon(task.taskType)}
                          <span
                            className={cn(
                              'font-medium truncate',
                              isDark ? 'text-white' : 'text-gray-900'
                            )}
                          >
                            {task.title}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 mt-1 text-xs">
                          {task.estimatedTime && (
                            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                              <Clock className="w-3 h-3 inline mr-1" />
                              {task.estimatedTime}m
                            </span>
                          )}
                          {task.score !== undefined && (
                            <span className="text-green-500">
                              Score: {Math.round(task.score)}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartFocusMode?.(task);
                        }}
                        className={cn(
                          'opacity-0 group-hover:opacity-100 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                          'bg-purple-600 text-white hover:bg-purple-700'
                        )}
                      >
                        Focus
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Time-based tip */}
      <div
        className={cn(
          'px-4 py-3 border-t text-xs flex items-center gap-2',
          isDark ? 'border-gray-700 bg-gray-800 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'
        )}
      >
        <Clock className="w-4 h-4" />
        <span>
          Based on the time ({new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}),{' '}
          <strong className={isDark ? 'text-gray-300' : 'text-gray-600'}>
            {suggestedEnergy} energy
          </strong>{' '}
          tasks might be a good fit
        </span>
      </div>
    </div>
  );
}

export default EnergyBasedTaskSelector;
