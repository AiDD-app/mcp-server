/**
 * Task Priority Dashboard Component
 *
 * A rich visual dashboard showing ADHD-optimized task prioritization.
 * Displays tasks sorted by AI score with energy levels, dependencies, and quick actions.
 */

import React, { useEffect, useState } from 'react';
import { useTasks, useAIJobs, useOpenAI } from '../hooks/useOpenAI';
import type { Task } from '../types/openai';
import { cn } from '../utils/cn';
import { getTasksFromToolOutput } from '../utils/toolOutput';
import {
  Zap,
  Battery,
  BatteryLow,
  BatteryMedium,
  Clock,
  CheckCircle2,
  Circle,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Sparkles,
  AlertCircle,
  ArrowUp,
  Link2,
  Tag,
  FileText,
} from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Checkbox from '@radix-ui/react-checkbox';

interface TaskPriorityDashboardProps {
  onTaskSelect?: (task: Task) => void;
  maxTasks?: number;
  showCompleted?: boolean;
}

export function TaskPriorityDashboard({
  onTaskSelect,
  maxTasks = 10,
  showCompleted = false,
}: TaskPriorityDashboardProps) {
  const { theme, requestFullscreen, toolOutput } = useOpenAI();
  const { tasks: fetchedTasks, loading, error, fetchTasks, completeTask } = useTasks();
  const { scoreTasks, jobs, fetchJobs } = useAIJobs();
  const [isScoring, setIsScoring] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Get the most recent scoring job
  const lastScoringJob = jobs.find((j) => j.type === 'score_tasks');
  const isJobProcessing = lastScoringJob?.status === 'processing';

  // Use pre-populated toolOutput.tasks if available (from tool call that triggered this widget)
  // Otherwise fall back to fetched tasks
  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  const tasks = preloadedTasks || fetchedTasks;

  useEffect(() => {
    // Only fetch if no pre-populated data from toolOutput
    if (!preloadedTasks || preloadedTasks.length === 0) {
      fetchTasks('score', maxTasks);
    }
    // Also fetch jobs to check for scoring status
    fetchJobs(true);
  }, [fetchTasks, fetchJobs, maxTasks, preloadedTasks]);

  // Poll for job status while scoring is in progress
  useEffect(() => {
    if (!isJobProcessing) return;

    const intervalId = setInterval(() => {
      fetchJobs(true);
    }, 3000);

    return () => clearInterval(intervalId);
  }, [isJobProcessing, fetchJobs]);

  // Refresh tasks when scoring job completes
  useEffect(() => {
    if (lastScoringJob?.status === 'completed') {
      fetchTasks('score', maxTasks);
    }
  }, [lastScoringJob?.status, fetchTasks, maxTasks]);

  const filteredTasks = showCompleted
    ? tasks
    : tasks.filter((t) => !t.isCompleted);

  // Sort by score descending before slicing to get top tasks
  const sortedTasks = [...filteredTasks].sort((a, b) => (b.score || 0) - (a.score || 0));
  const topTasks = sortedTasks.slice(0, maxTasks);

  const handleScoreTasks = async () => {
    setIsScoring(true);
    try {
      await scoreTasks();
      // Job polling will handle refresh when complete
      await fetchJobs(true);
    } finally {
      setIsScoring(false);
    }
  };

  const handleToggleComplete = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    await completeTask(task.id);
  };

  const handleToggleExpand = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedTaskId(expandedTaskId === taskId ? null : taskId);
  };

  const getEnergyIcon = (energy?: string) => {
    switch (energy) {
      case 'low':
        return <BatteryLow className="w-4 h-4 text-green-500" />;
      case 'medium':
        return <BatteryMedium className="w-4 h-4 text-yellow-500" />;
      case 'high':
        return <Battery className="w-4 h-4 text-red-500" />;
      default:
        return <Battery className="w-4 h-4 text-gray-400" />;
    }
  };

  const getTaskTypeLabel = (type?: string) => {
    const labels: Record<string, { label: string; color: string }> = {
      quick_win: { label: '⚡ Quick Win', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
      focus_required: { label: '🎯 Focus', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
      collaborative: { label: '👥 Collab', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
      creative: { label: '✨ Creative', color: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200' },
      administrative: { label: '📋 Admin', color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' },
    };
    return labels[type || 'administrative'] || labels.administrative;
  };

  const isDark = theme === 'dark';

  return (
    <Tooltip.Provider>
      <div
        className={cn(
          'rounded-xl border shadow-sm overflow-hidden flex flex-col h-full',
          isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'px-4 py-3 border-b flex items-center justify-between',
            isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
          )}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <h2 className={cn('font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
              Priority Dashboard
            </h2>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
              )}
            >
              {topTasks.length} tasks
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={handleScoreTasks}
                  disabled={isScoring || loading || isJobProcessing}
                  className={cn(
                    'p-2 rounded-lg transition-colors',
                    isDark
                      ? 'hover:bg-gray-700 text-gray-300'
                      : 'hover:bg-gray-100 text-gray-600',
                    (isScoring || loading || isJobProcessing) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <RefreshCw
                    className={cn('w-4 h-4', (isScoring || isJobProcessing) && 'animate-spin')}
                  />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content
                className={cn(
                  'px-2 py-1 rounded text-xs',
                  isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                )}
              >
                Re-score tasks with AI
              </Tooltip.Content>
            </Tooltip.Root>

            <button
              onClick={requestFullscreen}
              className={cn(
                'text-xs px-3 py-1.5 rounded-lg font-medium transition-colors',
                'bg-purple-600 text-white hover:bg-purple-700'
              )}
            >
              Expand
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {loading && !tasks.length ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-purple-500" />
            </div>
          ) : error ? (
            <div
              className={cn(
                'flex items-center gap-2 p-4 rounded-lg',
                isDark ? 'bg-red-900/30 text-red-300' : 'bg-red-50 text-red-600'
              )}
            >
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          ) : topTasks.length === 0 ? (
            <div
              className={cn(
                'text-center py-8',
                isDark ? 'text-gray-400' : 'text-gray-500'
              )}
            >
              <Circle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No tasks to prioritize</p>
              <p className="text-sm mt-1">Create some tasks to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topTasks.map((task, index) => {
                const typeInfo = getTaskTypeLabel(task.taskType);
                const score = task.score || 0;
                const isExpanded = expandedTaskId === task.id;

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'group rounded-lg border transition-all',
                      isDark
                        ? 'border-gray-700 hover:border-purple-600'
                        : 'border-gray-200 hover:border-purple-400',
                      task.isCompleted && 'opacity-50'
                    )}
                  >
                    <div
                      className={cn(
                        'p-3 cursor-pointer',
                        isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                      )}
                      onClick={() => onTaskSelect?.(task)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Priority Rank */}
                        <div
                          className={cn(
                            'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm',
                            index === 0
                              ? 'bg-purple-600 text-white'
                              : index === 1
                              ? 'bg-purple-500 text-white'
                              : index === 2
                              ? 'bg-purple-400 text-white'
                              : isDark
                              ? 'bg-gray-700 text-gray-300'
                              : 'bg-gray-200 text-gray-600'
                          )}
                        >
                          {index + 1}
                        </div>

                        {/* Task Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Checkbox.Root
                              checked={task.isCompleted}
                              onClick={(e) => handleToggleComplete(task, e)}
                              className={cn(
                                'w-5 h-5 rounded border flex items-center justify-center',
                                isDark ? 'border-gray-600' : 'border-gray-300',
                                task.isCompleted && 'bg-green-500 border-green-500'
                              )}
                            >
                              <Checkbox.Indicator>
                                <CheckCircle2 className="w-4 h-4 text-white" />
                              </Checkbox.Indicator>
                            </Checkbox.Root>

                            <h3
                              className={cn(
                                'font-medium truncate',
                                isDark ? 'text-white' : 'text-gray-900',
                                task.isCompleted && 'line-through'
                              )}
                            >
                              {task.title}
                            </h3>
                          </div>

                          {/* Meta info */}
                          <div className="flex items-center gap-3 text-xs flex-wrap">
                            <span className={cn('px-2 py-0.5 rounded-full', typeInfo.color)}>
                              {typeInfo.label}
                            </span>

                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <span className="flex items-center gap-1">
                                  {getEnergyIcon(task.energyRequired)}
                                </span>
                              </Tooltip.Trigger>
                              <Tooltip.Content
                                className={cn(
                                  'px-2 py-1 rounded text-xs capitalize',
                                  isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                                )}
                              >
                                {task.energyRequired || 'Unknown'} energy
                              </Tooltip.Content>
                            </Tooltip.Root>

                            {task.estimatedTime && (
                              <span
                                className={cn(
                                  'flex items-center gap-1',
                                  isDark ? 'text-gray-400' : 'text-gray-500'
                                )}
                              >
                                <Clock className="w-3 h-3" />
                                {task.estimatedTime}m
                              </span>
                            )}

                            {task.dependsOnTaskIds && task.dependsOnTaskIds.length > 0 && (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <span
                                    className={cn(
                                      'flex items-center gap-1',
                                      isDark ? 'text-yellow-400' : 'text-yellow-600'
                                    )}
                                  >
                                    <Link2 className="w-3 h-3" />
                                    {task.dependsOnTaskIds.length}
                                  </span>
                                </Tooltip.Trigger>
                                <Tooltip.Content
                                  className={cn(
                                    'px-2 py-1 rounded text-xs',
                                    isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                                  )}
                                >
                                  Depends on {task.dependsOnTaskIds.length} task(s)
                                </Tooltip.Content>
                              </Tooltip.Root>
                            )}

                            {/* Tags */}
                            {task.tags && task.tags.length > 0 && (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <span
                                    className={cn(
                                      'flex items-center gap-1',
                                      isDark ? 'text-blue-400' : 'text-blue-600'
                                    )}
                                  >
                                    <Tag className="w-3 h-3" />
                                    {task.tags.length}
                                  </span>
                                </Tooltip.Trigger>
                                <Tooltip.Content
                                  className={cn(
                                    'px-2 py-1 rounded text-xs',
                                    isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                                  )}
                                >
                                  {task.tags.slice(0, 3).join(', ')}
                                  {task.tags.length > 3 && ` +${task.tags.length - 3} more`}
                                </Tooltip.Content>
                              </Tooltip.Root>
                            )}

                            {/* Source Action Item (Derived From) */}
                            {task.sourceActionItem && (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <span
                                    className={cn(
                                      'flex items-center gap-1',
                                      isDark ? 'text-purple-400' : 'text-purple-600'
                                    )}
                                  >
                                    <FileText className="w-3 h-3" />
                                  </span>
                                </Tooltip.Trigger>
                                <Tooltip.Content
                                  className={cn(
                                    'px-2 py-1 rounded text-xs max-w-48',
                                    isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                                  )}
                                >
                                  Derived from: "{task.sourceActionItem.title}"
                                </Tooltip.Content>
                              </Tooltip.Root>
                            )}
                          </div>

                          {/* Score bar */}
                          <div className="mt-2 flex items-center gap-2">
                            <Progress.Root
                              value={score}
                              max={100}
                              className={cn(
                                'flex-1 h-1.5 rounded-full overflow-hidden',
                                isDark ? 'bg-gray-700' : 'bg-gray-200'
                              )}
                            >
                              <Progress.Indicator
                                className={cn(
                                  'h-full transition-all',
                                  score >= 70
                                    ? 'bg-green-500'
                                    : score >= 40
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                                )}
                                style={{ width: `${score}%` }}
                              />
                            </Progress.Root>
                            <span
                              className={cn(
                                'text-xs font-medium w-8',
                                isDark ? 'text-gray-400' : 'text-gray-500'
                              )}
                            >
                              {Math.round(score)}
                            </span>
                          </div>
                        </div>

                        {/* Expand/Collapse Button */}
                        <button
                          onClick={(e) => handleToggleExpand(task.id, e)}
                          className={cn(
                            'p-1 rounded transition-colors',
                            isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
                          )}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div
                        className={cn(
                          'px-3 pb-3 border-t',
                          isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-gray-50'
                        )}
                      >
                        <div className="pt-3 pl-11">
                          {/* Description */}
                          {task.description && (
                            <p
                              className={cn(
                                'text-sm mb-3',
                                isDark ? 'text-gray-300' : 'text-gray-600'
                              )}
                            >
                              {task.description}
                            </p>
                          )}

                          {/* Tags Display */}
                          {task.tags && task.tags.length > 0 && (
                            <div className="mb-3">
                              <span
                                className={cn(
                                  'text-xs font-medium',
                                  isDark ? 'text-gray-500' : 'text-gray-400'
                                )}
                              >
                                Tags:
                              </span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {task.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className={cn(
                                      'text-xs px-2 py-0.5 rounded',
                                      isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
                                    )}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Source Action Item */}
                          {task.sourceActionItem && (
                            <div
                              className={cn(
                                'text-xs p-2 rounded',
                                isDark ? 'bg-purple-900/30 text-purple-300' : 'bg-purple-50 text-purple-700'
                              )}
                            >
                              <div className="flex items-center gap-1 mb-1">
                                <FileText className="w-3 h-3" />
                                <span className="font-medium">Derived from Action Item:</span>
                              </div>
                              <p className="ml-4">{task.sourceActionItem.title}</p>
                              {task.sourceActionItem.priority && (
                                <p className="ml-4 text-xs opacity-75">
                                  Priority: {task.sourceActionItem.priority}
                                </p>
                              )}
                            </div>
                          )}

                          {/* AI Score Breakdown */}
                          {task.urgencyScore !== undefined && (
                            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                              <div className={cn('p-2 rounded', isDark ? 'bg-gray-700' : 'bg-gray-100')}>
                                <div className={isDark ? 'text-gray-400' : 'text-gray-500'}>Urgency</div>
                                <div className={cn('font-medium', isDark ? 'text-white' : 'text-gray-900')}>
                                  {task.urgencyScore}%
                                </div>
                              </div>
                              <div className={cn('p-2 rounded', isDark ? 'bg-gray-700' : 'bg-gray-100')}>
                                <div className={isDark ? 'text-gray-400' : 'text-gray-500'}>Impact</div>
                                <div className={cn('font-medium', isDark ? 'text-white' : 'text-gray-900')}>
                                  {task.impactScore ?? '-'}%
                                </div>
                              </div>
                              <div className={cn('p-2 rounded', isDark ? 'bg-gray-700' : 'bg-gray-100')}>
                                <div className={isDark ? 'text-gray-400' : 'text-gray-500'}>Relevance</div>
                                <div className={cn('font-medium', isDark ? 'text-white' : 'text-gray-900')}>
                                  {task.relevanceScore ?? '-'}%
                                </div>
                              </div>
                            </div>
                          )}

                          {/* No additional info message */}
                          {!task.description && !task.tags?.length && !task.sourceActionItem && !task.urgencyScore && (
                            <p
                              className={cn(
                                'text-sm italic',
                                isDark ? 'text-gray-500' : 'text-gray-400'
                              )}
                            >
                              No additional details available
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with AI status */}
        {jobs.some((j) => j.status === 'processing') && (
          <div
            className={cn(
              'px-4 py-2 border-t flex items-center gap-2 text-sm',
              isDark ? 'border-gray-700 bg-gray-800 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'
            )}
          >
            <RefreshCw className="w-4 h-4 animate-spin text-purple-500" />
            <span>AI is processing your tasks...</span>
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}

export default TaskPriorityDashboard;
