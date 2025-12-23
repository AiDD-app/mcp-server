/**
 * AI Scoring Results Card Component
 *
 * Displays results from AI task scoring with insights,
 * recommendations, and score distribution visualization.
 */

import React, { useEffect, useState } from 'react';
import { useTasks, useAIJobs, useOpenAI } from '../hooks/useOpenAI';
import type { Task, ScoringResult, AIJob } from '../types/openai';
import { cn } from '../utils/cn';
import { getJobsFromToolOutput, getTasksFromToolOutput } from '../utils/toolOutput';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  BarChart3,
  RefreshCw,
  CheckCircle2,
  Clock,
  Zap,
  Target,
  Award,
  AlertCircle,
  ChevronRight,
  Brain,
  Lightbulb,
} from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import * as Tooltip from '@radix-ui/react-tooltip';

interface AIScoringResultsCardProps {
  onTaskSelect?: (task: Task) => void;
  showRecommendations?: boolean;
}

export function AIScoringResultsCard({
  onTaskSelect,
  showRecommendations = true,
}: AIScoringResultsCardProps) {
  const { theme, toolOutput } = useOpenAI();
  const { tasks: fetchedTasks, loading: tasksLoading, fetchTasks } = useTasks();
  const { jobs: fetchedJobs, loading: jobsLoading, fetchJobs, scoreTasks } = useAIJobs();
  const [isScoring, setIsScoring] = useState(false);
  const [lastScoringJob, setLastScoringJob] = useState<AIJob | null>(null);

  const isDark = theme === 'dark';

  // Use pre-populated toolOutput.tasks if available (from tool call that triggered this widget)
  // Otherwise fall back to fetched tasks
  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  const preloadedJobs = getJobsFromToolOutput(toolOutput);
  const tasks = preloadedTasks || fetchedTasks;
  const jobs = preloadedJobs || fetchedJobs;

  useEffect(() => {
    // Only fetch if no pre-populated data from toolOutput
    if (!preloadedTasks || preloadedTasks.length === 0) {
      fetchTasks('score', 100);
    }
    if (!preloadedJobs || preloadedJobs.length === 0) {
      fetchJobs(true);
    }
  }, [fetchTasks, fetchJobs, preloadedTasks, preloadedJobs]);

  // Find the most recent scoring job
  useEffect(() => {
    const scoringJobs = jobs.filter((j) => j.type === 'score_tasks');
    if (scoringJobs.length > 0) {
      setLastScoringJob(scoringJobs[0]); // Assumes sorted by date desc
    }
  }, [jobs]);

  const handleStartScoring = async () => {
    setIsScoring(true);
    try {
      await scoreTasks();
      await fetchJobs();
    } finally {
      setIsScoring(false);
    }
  };

  // Calculate scoring stats
  const scoredTasks = tasks.filter((t) => t.score !== undefined && !t.isCompleted);
  const avgScore = scoredTasks.length > 0
    ? scoredTasks.reduce((sum, t) => sum + (t.score || 0), 0) / scoredTasks.length
    : 0;

  const topTasks = [...scoredTasks]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3);

  const quickWins = scoredTasks.filter(
    (t) => t.taskType === 'quick_win' && t.energyRequired === 'low'
  );

  // Score distribution
  const scoreDistribution = {
    high: scoredTasks.filter((t) => (t.score || 0) >= 70).length,
    medium: scoredTasks.filter((t) => (t.score || 0) >= 40 && (t.score || 0) < 70).length,
    low: scoredTasks.filter((t) => (t.score || 0) < 40).length,
  };

  // Generate insights
  const insights = [];

  if (quickWins.length >= 3) {
    insights.push({
      icon: Zap,
      text: `${quickWins.length} quick wins available - great for low energy moments`,
      color: 'text-green-500',
    });
  }

  if (scoreDistribution.high > scoreDistribution.low) {
    insights.push({
      icon: TrendingUp,
      text: 'Your task list is well-prioritized',
      color: 'text-blue-500',
    });
  }

  const blockedTasks = tasks.filter((t) => t.dependsOnTaskIds && t.dependsOnTaskIds.length > 0);
  if (blockedTasks.length > 3) {
    insights.push({
      icon: AlertCircle,
      text: `${blockedTasks.length} tasks are blocked by dependencies`,
      color: 'text-yellow-500',
    });
  }

  const highEnergyTasks = scoredTasks.filter((t) => t.energyRequired === 'high');
  if (highEnergyTasks.length > 5) {
    insights.push({
      icon: Target,
      text: 'Many high-energy tasks - schedule for peak hours',
      color: 'text-purple-500',
    });
  }

  const isProcessing = lastScoringJob?.status === 'processing';

  return (
    <Tooltip.Provider>
      <div
        className={cn(
          'rounded-xl border shadow-sm overflow-hidden',
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
            <Brain className="w-5 h-5 text-purple-500" />
            <h2 className={cn('font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
              AI Scoring Results
            </h2>
          </div>

          <button
            onClick={handleStartScoring}
            disabled={isScoring || isProcessing}
            className={cn(
              'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              'bg-purple-600 text-white hover:bg-purple-700',
              (isScoring || isProcessing) && 'opacity-50 cursor-not-allowed'
            )}
          >
            <RefreshCw
              className={cn('w-4 h-4', (isScoring || isProcessing) && 'animate-spin')}
            />
            {isProcessing ? 'Scoring...' : 'Re-score'}
          </button>
        </div>

        {/* Processing Status */}
        {isProcessing && lastScoringJob && (
          <div
            className={cn(
              'px-4 py-3 border-b',
              isDark ? 'border-gray-700 bg-purple-900/20' : 'border-gray-200 bg-purple-50'
            )}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-500 animate-pulse" />
                  <span className={isDark ? 'text-purple-300' : 'text-purple-700'}>
                    {lastScoringJob.progressMessage || 'AI is analyzing your tasks...'}
                  </span>
                </div>
                <span className={isDark ? 'text-purple-400' : 'text-purple-600'}>
                  {Math.round(lastScoringJob.progress * 100)}%
                </span>
              </div>
              <Progress.Root
                value={lastScoringJob.progress * 100}
                max={100}
                className={cn(
                  'h-2 rounded-full overflow-hidden',
                  isDark ? 'bg-gray-700' : 'bg-purple-200'
                )}
              >
                <Progress.Indicator
                  className="h-full bg-purple-500 transition-all"
                  style={{ width: `${lastScoringJob.progress * 100}%` }}
                />
              </Progress.Root>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="p-4">
          <div className="grid grid-cols-3 gap-4 mb-6">
            {/* Average Score */}
            <div
              className={cn(
                'p-4 rounded-lg text-center',
                isDark ? 'bg-gray-800' : 'bg-gray-100'
              )}
            >
              <div
                className={cn(
                  'text-3xl font-bold',
                  avgScore >= 60 ? 'text-green-500' : avgScore >= 40 ? 'text-yellow-500' : 'text-red-500'
                )}
              >
                {Math.round(avgScore)}
              </div>
              <div className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                Avg Score
              </div>
            </div>

            {/* Tasks Scored */}
            <div
              className={cn(
                'p-4 rounded-lg text-center',
                isDark ? 'bg-gray-800' : 'bg-gray-100'
              )}
            >
              <div className={cn('text-3xl font-bold', isDark ? 'text-white' : 'text-gray-900')}>
                {scoredTasks.length}
              </div>
              <div className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                Tasks Scored
              </div>
            </div>

            {/* Quick Wins */}
            <div
              className={cn(
                'p-4 rounded-lg text-center',
                isDark ? 'bg-gray-800' : 'bg-gray-100'
              )}
            >
              <div className="text-3xl font-bold text-green-500">
                {quickWins.length}
              </div>
              <div className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                Quick Wins
              </div>
            </div>
          </div>

          {/* Score Distribution */}
          <div className="mb-6">
            <h3
              className={cn(
                'text-sm font-medium mb-3 flex items-center gap-2',
                isDark ? 'text-gray-300' : 'text-gray-700'
              )}
            >
              <BarChart3 className="w-4 h-4" />
              Score Distribution
            </h3>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className={cn('text-xs w-16', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  High (70+)
                </span>
                <div className="flex-1">
                  <Progress.Root
                    value={scoreDistribution.high}
                    max={scoredTasks.length || 1}
                    className={cn('h-4 rounded-full overflow-hidden', isDark ? 'bg-gray-800' : 'bg-gray-200')}
                  >
                    <Progress.Indicator
                      className="h-full bg-green-500 transition-all"
                      style={{ width: `${(scoreDistribution.high / (scoredTasks.length || 1)) * 100}%` }}
                    />
                  </Progress.Root>
                </div>
                <span className={cn('text-xs w-8 text-right', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  {scoreDistribution.high}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className={cn('text-xs w-16', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  Med (40-69)
                </span>
                <div className="flex-1">
                  <Progress.Root
                    value={scoreDistribution.medium}
                    max={scoredTasks.length || 1}
                    className={cn('h-4 rounded-full overflow-hidden', isDark ? 'bg-gray-800' : 'bg-gray-200')}
                  >
                    <Progress.Indicator
                      className="h-full bg-yellow-500 transition-all"
                      style={{ width: `${(scoreDistribution.medium / (scoredTasks.length || 1)) * 100}%` }}
                    />
                  </Progress.Root>
                </div>
                <span className={cn('text-xs w-8 text-right', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  {scoreDistribution.medium}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className={cn('text-xs w-16', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  Low (&lt;40)
                </span>
                <div className="flex-1">
                  <Progress.Root
                    value={scoreDistribution.low}
                    max={scoredTasks.length || 1}
                    className={cn('h-4 rounded-full overflow-hidden', isDark ? 'bg-gray-800' : 'bg-gray-200')}
                  >
                    <Progress.Indicator
                      className="h-full bg-red-500 transition-all"
                      style={{ width: `${(scoreDistribution.low / (scoredTasks.length || 1)) * 100}%` }}
                    />
                  </Progress.Root>
                </div>
                <span className={cn('text-xs w-8 text-right', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  {scoreDistribution.low}
                </span>
              </div>
            </div>
          </div>

          {/* Top Tasks */}
          {topTasks.length > 0 && (
            <div className="mb-6">
              <h3
                className={cn(
                  'text-sm font-medium mb-3 flex items-center gap-2',
                  isDark ? 'text-gray-300' : 'text-gray-700'
                )}
              >
                <Award className="w-4 h-4 text-yellow-500" />
                Top Priority Tasks
              </h3>

              <div className="space-y-2">
                {topTasks.map((task, index) => (
                  <button
                    key={task.id}
                    onClick={() => onTaskSelect?.(task)}
                    className={cn(
                      'w-full p-3 rounded-lg border text-left flex items-center gap-3 transition-all',
                      isDark
                        ? 'border-gray-700 hover:border-purple-600 hover:bg-gray-800'
                        : 'border-gray-200 hover:border-purple-400 hover:bg-gray-50'
                    )}
                  >
                    <div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
                        index === 0
                          ? 'bg-yellow-500 text-white'
                          : index === 1
                          ? 'bg-gray-400 text-white'
                          : 'bg-orange-600 text-white'
                      )}
                    >
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          'font-medium truncate',
                          isDark ? 'text-white' : 'text-gray-900'
                        )}
                      >
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        {task.estimatedTime && (
                          <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                            <Clock className="w-3 h-3 inline mr-1" />
                            {task.estimatedTime}m
                          </span>
                        )}
                        {task.taskType === 'quick_win' && (
                          <span className="text-green-500">
                            <Zap className="w-3 h-3 inline mr-1" />
                            Quick Win
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-lg font-bold',
                          (task.score || 0) >= 70
                            ? 'text-green-500'
                            : (task.score || 0) >= 40
                            ? 'text-yellow-500'
                            : 'text-red-500'
                        )}
                      >
                        {Math.round(task.score || 0)}
                      </span>
                      <ChevronRight
                        className={cn(
                          'w-4 h-4',
                          isDark ? 'text-gray-600' : 'text-gray-400'
                        )}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI Insights */}
          {showRecommendations && insights.length > 0 && (
            <div>
              <h3
                className={cn(
                  'text-sm font-medium mb-3 flex items-center gap-2',
                  isDark ? 'text-gray-300' : 'text-gray-700'
                )}
              >
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                AI Insights
              </h3>

              <div className="space-y-2">
                {insights.map((insight, index) => {
                  const Icon = insight.icon;
                  return (
                    <div
                      key={index}
                      className={cn(
                        'p-3 rounded-lg flex items-center gap-3',
                        isDark ? 'bg-gray-800' : 'bg-gray-100'
                      )}
                    >
                      <Icon className={cn('w-5 h-5 flex-shrink-0', insight.color)} />
                      <span
                        className={cn('text-sm', isDark ? 'text-gray-300' : 'text-gray-600')}
                      >
                        {insight.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {scoredTasks.length === 0 && !isProcessing && (
            <div
              className={cn(
                'text-center py-8',
                isDark ? 'text-gray-400' : 'text-gray-500'
              )}
            >
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No scored tasks yet</p>
              <p className="text-sm mt-1">Click "Re-score" to analyze your tasks with AI</p>
            </div>
          )}
        </div>

        {/* Last Updated */}
        {lastScoringJob && lastScoringJob.status === 'completed' && (
          <div
            className={cn(
              'px-4 py-2 border-t text-xs flex items-center gap-2',
              isDark ? 'border-gray-700 bg-gray-800 text-gray-400' : 'border-gray-200 bg-gray-50 text-gray-500'
            )}
          >
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            <span>
              Last scored {new Date(lastScoringJob.updatedAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}

export default AIScoringResultsCard;
