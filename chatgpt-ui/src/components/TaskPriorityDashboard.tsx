/**
 * Task Priority Dashboard Component
 *
 * A rich visual dashboard showing ADHD-optimized task prioritization.
 * Displays tasks sorted by AI score with energy levels, dependencies, and quick actions.
 *
 * Redesigned with modern dark theme and vibrant accents.
 */

import React, { useEffect, useState } from 'react';
import { useTasks, useAIJobs, useOpenAI, useActionItems } from '../hooks/useOpenAI';
import type { Task } from '../types/openai';
import { cn } from '../utils/cn';
import { decodeHTMLEntities } from '../utils/htmlEntities';
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
  ChevronUp,
  ChevronDown,
  Sparkles,
  AlertCircle,
  Link2,
  Tag,
  FileText,
  Filter,
  X,
  Briefcase,
  User,
  Maximize2,
} from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Checkbox from '@radix-ui/react-checkbox';

// Filter types
interface TaskFilters {
  category?: string;
  maxEnergy?: 'low' | 'medium' | 'high';
  timeBudgetMinutes?: number;
  includeCompleted?: boolean;
  actionItemId?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

interface TaskPriorityDashboardProps {
  onTaskSelect?: (task: Task) => void;
  maxTasks?: number;
  showCompleted?: boolean;
}

// Circular Progress Component - responsive sizing for mobile
function CircularProgress({ score, size = 48, className }: { score: number; size?: number; className?: string }) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (score / 100) * circumference;

  const getScoreColor = (score: number) => {
    if (score >= 70) return '#22c55e'; // green
    if (score >= 40) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  return (
    <div className={cn("relative flex-shrink-0", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#374151"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getScoreColor(score)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-white">{Math.round(score)}</span>
      </div>
    </div>
  );
}

export function TaskPriorityDashboard({
  onTaskSelect,
  maxTasks = 50,
  showCompleted = false,
}: TaskPriorityDashboardProps) {
  const { theme, requestFullscreen, toolOutput, displayMode } = useOpenAI();
  const { tasks: fetchedTasks, loading, error, fetchTasks, completeTask } = useTasks();
  const { actionItems, fetchActionItems } = useActionItems();
  const isFullscreen = displayMode === 'fullscreen';
  const { scoreTasks, jobs, fetchJobs } = useAIJobs();
  const [isScoring, setIsScoring] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>({});

  const lastScoringJob = jobs.find((j) => j.type === 'score_tasks');
  const isJobProcessing = lastScoringJob?.status === 'processing';
  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== false).length;

  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  // Always prefer freshly fetched tasks; fall back to preloaded only before first fetch completes
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const tasks = hasFetchedOnce ? fetchedTasks : (preloadedTasks || fetchedTasks);
  const [hasAppliedFilters, setHasAppliedFilters] = useState(false);

  // Initial load - ALWAYS fetch fresh data (preloaded may be stale)
  useEffect(() => {
    console.log('[TaskPriorityDashboard] Initial fetch - preloaded:', preloadedTasks?.length, 'fetched:', fetchedTasks.length);
    fetchTasks('score', maxTasks, filters).then(() => {
      setHasFetchedOnce(true);
      console.log('[TaskPriorityDashboard] Fresh fetch complete');
    });
    fetchJobs(true);
    fetchActionItems(); // Fetch action items for the filter dropdown
  }, []);

  // Helper to update filters and trigger refetch via useEffect
  // Note: fetchTasks is called via the useEffect below, NOT directly here
  // This prevents race conditions from double-fetching
  const updateFilter = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => {
    const newFilters = { ...filters, [key]: value };
    console.log('[TaskPriorityDashboard] updateFilter:', key, '=', value, 'newFilters:', newFilters);
    setFilters(newFilters);
    setHasAppliedFilters(true);
  };

  // When filters change, refetch tasks (single source of truth)
  useEffect(() => {
    console.log('[TaskPriorityDashboard] Filters effect triggered, hasAppliedFilters:', hasAppliedFilters, 'filters:', filters);
    if (hasAppliedFilters) {
      console.log('[TaskPriorityDashboard] Calling fetchTasks with filters:', filters);
      fetchTasks('score', maxTasks, filters);
    }
  }, [filters, hasAppliedFilters, fetchTasks, maxTasks]);

  const clearFilters = () => {
    setFilters({});
    setHasAppliedFilters(false);
    fetchTasks('score', maxTasks, {});
  };

  useEffect(() => {
    if (!isJobProcessing) return;
    const intervalId = setInterval(() => {
      fetchJobs(true);
    }, 3000);
    return () => clearInterval(intervalId);
  }, [isJobProcessing, fetchJobs]);

  useEffect(() => {
    if (lastScoringJob?.status === 'completed') {
      setIsScoring(false);
      fetchTasks('score', maxTasks, filters);
    } else if (lastScoringJob?.status === 'failed') {
      setIsScoring(false);
      setScoringError((lastScoringJob as any).error || 'Scoring job failed');
    }
  }, [lastScoringJob?.status, fetchTasks, maxTasks, filters]);

  // Apply client-side filtering
  let filteredTasks = showCompleted
    ? tasks
    : tasks.filter((t) => !t.isCompleted);

  // Filter by action item (client-side fallback if backend doesn't support this filter)
  if (filters.actionItemId) {
    filteredTasks = filteredTasks.filter((t) =>
      t.actionItemId === filters.actionItemId
    );
  }

  // Filter by priority of parent action item (client-side fallback)
  if (filters.priority) {
    filteredTasks = filteredTasks.filter((t) =>
      t.sourceActionItem?.priority?.toLowerCase() === filters.priority?.toLowerCase()
    );
  }

  // Trust the server's scoreWithDependencies ordering - don't re-sort client-side
  // This ensures widget matches the text response from ChatGPT
  // Don't limit the number of tasks shown - let the server control this
  const topTasks = filteredTasks;

  const [scoringError, setScoringError] = useState<string | null>(null);

  const handleScoreTasks = async () => {
    setIsScoring(true);
    setScoringError(null);
    try {
      console.log('[TaskPriorityDashboard] Starting AI scoring...');
      const jobId = await scoreTasks();
      console.log('[TaskPriorityDashboard] Scoring job started:', jobId);
      await fetchJobs(true);
    } catch (error) {
      console.error('[TaskPriorityDashboard] Scoring failed:', error);
      setScoringError(error instanceof Error ? error.message : 'Failed to start scoring');
      setIsScoring(false);
    }
  };

  const handleToggleComplete = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    await completeTask(task.id);
    setTimeout(() => {
      fetchTasks('score', maxTasks, filters);
    }, 500);
  };

  const handleToggleExpand = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedTaskId(expandedTaskId === taskId ? null : taskId);
  };

  const getEnergyIcon = (energy?: string) => {
    switch (energy) {
      case 'low':
        return <BatteryLow className="w-4 h-4 text-green-400" />;
      case 'medium':
        return <BatteryMedium className="w-4 h-4 text-yellow-400" />;
      case 'high':
        return <Battery className="w-4 h-4 text-red-400" />;
      default:
        return <Battery className="w-4 h-4 text-gray-500" />;
    }
  };

  return (
    <Tooltip.Provider>
      <div className={cn(
        'bg-[#0d1117] text-white flex flex-col',
        isFullscreen ? 'h-full' : 'min-h-full'
      )}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-purple-500" />
            <h1 className="text-xl font-bold text-white">Priority Dashboard</h1>
            <span className="px-3 py-1 rounded-full bg-gray-800 text-gray-300 text-sm">
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
                    'hover:bg-gray-800 text-gray-400 hover:text-white',
                    (isScoring || loading || isJobProcessing) && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <RefreshCw className={cn('w-5 h-5', (isScoring || isJobProcessing) && 'animate-spin')} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white">
                Re-score tasks with AI
              </Tooltip.Content>
            </Tooltip.Root>

            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={cn(
                    'p-2 rounded-lg transition-colors relative',
                    showFilters
                      ? 'bg-purple-600 text-white'
                      : 'hover:bg-gray-800 text-gray-400 hover:text-white'
                  )}
                >
                  <Filter className="w-5 h-5" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 text-white text-xs rounded-full flex items-center justify-center">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white">
                Filter tasks
              </Tooltip.Content>
            </Tooltip.Root>

            <button
              onClick={requestFullscreen}
              className="px-4 py-2 rounded-lg font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
            >
              Expand
            </button>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="px-6 py-4 bg-[#161b22] border-b border-gray-800 flex-shrink-0">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">Category</label>
                <select
                  value={filters.category || ''}
                  onChange={(e) => updateFilter('category', e.target.value || undefined)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-[120px]"
                >
                  <option value="">All</option>
                  <option value="work">Work</option>
                  <option value="personal">Personal</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">Max Energy</label>
                <select
                  value={filters.maxEnergy || ''}
                  onChange={(e) => updateFilter('maxEnergy', (e.target.value as 'low' | 'medium' | 'high') || undefined)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-[120px]"
                >
                  <option value="">Any</option>
                  <option value="low">🔋 Low</option>
                  <option value="medium">⚡ Medium</option>
                  <option value="high">🔥 High</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">Time Budget</label>
                <select
                  value={filters.timeBudgetMinutes?.toString() || ''}
                  onChange={(e) => updateFilter('timeBudgetMinutes', e.target.value ? parseInt(e.target.value) : undefined)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-[120px]"
                >
                  <option value="">Any</option>
                  <option value="15">15 min</option>
                  <option value="30">30 min</option>
                  <option value="60">1 hour</option>
                  <option value="120">2 hours</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">Action Item</label>
                <select
                  value={filters.actionItemId || ''}
                  onChange={(e) => updateFilter('actionItemId', e.target.value || undefined)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-[180px] max-w-[250px]"
                >
                  <option value="">All Action Items</option>
                  {actionItems
                    .filter((item) => !item.isCompleted)
                    .map((item) => {
                      const decodedTitle = decodeHTMLEntities(item.title);
                      return (
                        <option key={item.id} value={item.id} title={decodedTitle}>
                          {decodedTitle.length > 30 ? `${decodedTitle.substring(0, 30)}...` : decodedTitle}
                        </option>
                      );
                    })}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-400">Priority</label>
                <select
                  value={filters.priority || ''}
                  onChange={(e) => updateFilter('priority', (e.target.value as 'low' | 'medium' | 'high' | 'urgent') || undefined)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm min-w-[120px]"
                >
                  <option value="">Any Priority</option>
                  <option value="urgent">🔴 Urgent</option>
                  <option value="high">🟠 High</option>
                  <option value="medium">🟡 Medium</option>
                  <option value="low">🟢 Low</option>
                </select>
              </div>

              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scoring Error */}
        {scoringError && (
          <div className="px-6 py-3 bg-red-900/20 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span>Scoring error: {scoringError}</span>
            </div>
            <button
              onClick={() => setScoringError(null)}
              className="text-red-300 hover:text-red-200 text-sm"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Scoring in Progress */}
        {isScoring && !isJobProcessing && !scoringError && (
          <div className="px-6 py-3 bg-purple-900/20 border-b border-gray-800 flex items-center gap-2 text-sm text-purple-300">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Starting AI scoring...</span>
          </div>
        )}

        {/* Content */}
        <div className={cn('p-6', isFullscreen && 'flex-1 overflow-y-auto')}>
          {loading && !tasks.length ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 text-red-400">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          ) : topTasks.length === 0 ? (
            <div className="text-center py-12">
              <Circle className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 text-lg">No tasks to prioritize</p>
              <p className="text-gray-500 text-sm mt-2">Create some tasks to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {topTasks.map((task, index) => {
                const score = task.score || 0;
                const isExpanded = expandedTaskId === task.id;

                return (
                  <div
                    key={task.id}
                    className={cn(
                      'bg-[#161b22] rounded-xl border transition-all overflow-hidden',
                      isExpanded ? 'border-purple-500' : 'border-gray-800 hover:border-gray-700',
                      task.isCompleted && 'opacity-50'
                    )}
                  >
                    <div
                      className="p-3 cursor-pointer"
                      onClick={() => onTaskSelect?.(task)}
                    >
                      <div className="flex items-start gap-3">
                        {/* Circular Score - smaller on mobile */}
                        <CircularProgress score={score} size={48} />

                        {/* Task Content - takes remaining space */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <div className="flex items-center gap-2 mb-1">
                            <Checkbox.Root
                              checked={task.isCompleted}
                              onClick={(e) => handleToggleComplete(task, e)}
                              className={cn(
                                'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                                'border-gray-600',
                                task.isCompleted && 'bg-green-500 border-green-500'
                              )}
                            >
                              <Checkbox.Indicator>
                                <CheckCircle2 className="w-3 h-3 text-white" />
                              </Checkbox.Indicator>
                            </Checkbox.Root>

                            {/* Title with better truncation for mobile */}
                            <h3 className={cn(
                              'font-semibold text-white text-sm leading-tight',
                              'overflow-hidden text-ellipsis',
                              'line-clamp-2',
                              task.isCompleted && 'line-through opacity-60'
                            )}>
                              {decodeHTMLEntities(task.title)}
                            </h3>
                          </div>

                          {/* Meta info - compact for mobile */}
                          <div className="flex items-center gap-2 text-xs flex-wrap mt-1">
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <span className="flex items-center gap-0.5 text-gray-400">
                                  {getEnergyIcon(task.energyRequired)}
                                </span>
                              </Tooltip.Trigger>
                              <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white capitalize">
                                {task.energyRequired || 'Medium'} energy
                              </Tooltip.Content>
                            </Tooltip.Root>

                            <span className="flex items-center gap-0.5 text-gray-400 text-[11px]">
                              <Clock className="w-3 h-3" />
                              {task.estimatedTime ? `${task.estimatedTime}m` : '?m'}
                            </span>

                            {task.category && (
                              <span className={cn(
                                'px-1.5 py-0.5 rounded text-[10px]',
                                task.category === 'work'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-green-500/20 text-green-400'
                              )}>
                                {task.category === 'work' ? '💼' : '🏠'} {task.category}
                              </span>
                            )}

                            {task.dependencyTasks && task.dependencyTasks.length > 0 && (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <span className="flex items-center gap-0.5 text-yellow-400 text-[11px]">
                                    <Link2 className="w-3 h-3" />
                                    {task.dependencyTasks.length}
                                  </span>
                                </Tooltip.Trigger>
                                <Tooltip.Content className="px-3 py-2 rounded text-xs bg-gray-800 text-white max-w-xs">
                                  <div className="font-medium mb-1">Depends on {task.dependencyTasks.length} task(s):</div>
                                  <div className="space-y-1">
                                    {task.dependencyTasks.slice(0, 3).map((dep, i) => (
                                      <div key={i} className="flex items-start gap-1">
                                        {dep.isCompleted ? (
                                          <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                                        ) : (
                                          <Circle className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
                                        )}
                                        <div>
                                          <span className={dep.isCompleted ? "text-green-300" : "text-yellow-300"}>
                                            {dep.title}
                                          </span>
                                          {dep.sourceActionItem && (
                                            <div className="text-purple-400 text-[10px]">
                                              ← {dep.sourceActionItem.title}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                    {task.dependencyTasks.length > 3 && (
                                      <div className="text-gray-500">...and {task.dependencyTasks.length - 3} more</div>
                                    )}
                                  </div>
                                </Tooltip.Content>
                              </Tooltip.Root>
                            )}
                            {/* Fallback for old data without dependencyTasks */}
                            {!task.dependencyTasks?.length && task.dependsOnTaskIds && task.dependsOnTaskIds.length > 0 && (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <span className="flex items-center gap-0.5 text-yellow-400 text-[11px]">
                                    <Link2 className="w-3 h-3" />
                                    {task.dependsOnTaskIds.length}
                                  </span>
                                </Tooltip.Trigger>
                                <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white">
                                  Depends on {task.dependsOnTaskIds.length} task(s)
                                </Tooltip.Content>
                              </Tooltip.Root>
                            )}

                            {task.sourceActionItem && (
                              <span className="flex items-center gap-1 text-purple-400 text-[11px] truncate max-w-32">
                                <FileText className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{task.sourceActionItem.title}</span>
                              </span>
                            )}
                          </div>

                          {/* Score Progress Bar */}
                          <div className="mt-2">
                            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                                )}
                                style={{ width: `${score}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Quick Actions - compact, no duplicate score display */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!task.isCompleted && (
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <button
                                  onClick={(e) => handleToggleComplete(task, e)}
                                  className="p-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              </Tooltip.Trigger>
                              <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white">
                                Complete task
                              </Tooltip.Content>
                            </Tooltip.Root>
                          )}

                          <button
                            onClick={(e) => handleToggleExpand(task.id, e)}
                            className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-2 border-t border-gray-800 bg-[#0d1117]/50">
                        <div className="pl-[60px]">
                          {/* Description */}
                          {task.description && (
                            <p className="text-sm text-gray-300 mb-4">{task.description}</p>
                          )}

                          {/* Tags Display */}
                          {task.tags && task.tags.length > 0 && (
                            <div className="mb-4">
                              <span className="text-xs font-medium text-gray-500 block mb-2">Tags:</span>
                              <div className="flex flex-wrap gap-2">
                                {task.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-xs px-2 py-1 rounded-lg bg-gray-800 text-gray-300"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Source Action Item */}
                          {task.sourceActionItem && (
                            <div className="p-3 rounded-lg bg-purple-500/10 text-purple-300 mb-4">
                              <div className="flex items-center gap-2 mb-1 text-xs font-medium">
                                <FileText className="w-3.5 h-3.5" />
                                Derived from Action Item:
                              </div>
                              <p className="text-sm">{task.sourceActionItem.title}</p>
                              {task.sourceActionItem.priority && (
                                <p className="text-xs text-purple-400 mt-1">
                                  Priority: {task.sourceActionItem.priority}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Dependencies with Source Action Items */}
                          {task.dependencyTasks && task.dependencyTasks.length > 0 && (
                            <div className="mb-4">
                              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-yellow-400">
                                <Link2 className="w-3.5 h-3.5" />
                                Depends on {task.dependencyTasks.length} task(s):
                              </div>
                              <div className="space-y-2">
                                {task.dependencyTasks.map((depTask, idx) => (
                                  <div
                                    key={depTask.id || idx}
                                    className={cn(
                                      "p-2 rounded-lg border",
                                      depTask.isCompleted
                                        ? "bg-green-500/10 border-green-500/30"
                                        : "bg-yellow-500/10 border-yellow-500/30"
                                    )}
                                  >
                                    <div className="flex items-center gap-2">
                                      {depTask.isCompleted ? (
                                        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                                      ) : (
                                        <Circle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                                      )}
                                      <span className={cn(
                                        "text-sm",
                                        depTask.isCompleted ? "text-green-300 line-through" : "text-yellow-300"
                                      )}>
                                        {depTask.title}
                                      </span>
                                      {depTask.estimatedTime && (
                                        <span className="text-xs text-gray-500 ml-auto">
                                          ~{depTask.estimatedTime}m
                                        </span>
                                      )}
                                    </div>
                                    {depTask.sourceActionItem && (
                                      <div className="flex items-center gap-1 mt-1 ml-6 text-purple-400 text-xs">
                                        <FileText className="w-3 h-3" />
                                        <span className="truncate">{depTask.sourceActionItem.title}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* AI Score Breakdown */}
                          {task.urgencyScore !== undefined && (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="p-3 rounded-lg bg-gray-800">
                                <div className="text-xs text-gray-500 mb-1">Urgency</div>
                                <div className="text-lg font-bold text-white">{task.urgencyScore}%</div>
                                <div className="h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${task.urgencyScore}%` }} />
                                </div>
                              </div>
                              <div className="p-3 rounded-lg bg-gray-800">
                                <div className="text-xs text-gray-500 mb-1">Impact</div>
                                <div className="text-lg font-bold text-white">{task.impactScore ?? '-'}%</div>
                                <div className="h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${task.impactScore || 0}%` }} />
                                </div>
                              </div>
                              <div className="p-3 rounded-lg bg-gray-800">
                                <div className="text-xs text-gray-500 mb-1">Relevance</div>
                                <div className="text-lg font-bold text-white">{task.relevanceScore ?? '-'}%</div>
                                <div className="h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
                                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${task.relevanceScore || 0}%` }} />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* No additional info message */}
                          {!task.description && !task.tags?.length && !task.sourceActionItem && !task.urgencyScore && (
                            <p className="text-sm italic text-gray-500">No additional details available</p>
                          )}

                          {/* Action Buttons */}
                          <div className="mt-4 flex items-center gap-2">
                            {!task.isCompleted && (
                              <button
                                onClick={(e) => handleToggleComplete(task, e)}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-green-600 text-white hover:bg-green-700 transition-colors"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                Mark Complete
                              </button>
                            )}
                            {task.isCompleted && (
                              <span className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-green-500/20 text-green-400">
                                <CheckCircle2 className="w-4 h-4" />
                                Completed
                              </span>
                            )}
                          </div>
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
          <div className="px-6 py-3 border-t border-gray-800 flex items-center gap-2 text-sm text-gray-400 flex-shrink-0">
            <RefreshCw className="w-4 h-4 animate-spin text-purple-500" />
            <span>AI is processing your tasks...</span>
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}

export default TaskPriorityDashboard;
