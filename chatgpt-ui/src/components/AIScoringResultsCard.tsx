/**
 * AI Scoring Results Card Component
 *
 * Displays results from AI task scoring with insights,
 * recommendations, and score distribution visualization.
 *
 * Redesigned with modern dark theme and vibrant accents.
 */

import React, { useEffect, useState } from 'react';
import { useTasks, useAIJobs, useOpenAI } from '../hooks/useOpenAI';
import type { Task, AIJob } from '../types/openai';
import { cn } from '../utils/cn';
import { getJobsFromToolOutput, getTasksFromToolOutput } from '../utils/toolOutput';
import {
  Sparkles,
  TrendingUp,
  RefreshCw,
  CheckCircle2,
  Clock,
  Zap,
  AlertCircle,
  Brain,
  Lightbulb,
  Target,
  AlertTriangle,
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

  // Use pre-populated toolOutput.tasks if available
  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  const preloadedJobs = getJobsFromToolOutput(toolOutput);
  const tasks = preloadedTasks || fetchedTasks;
  const jobs = preloadedJobs || fetchedJobs;

  useEffect(() => {
    if (!preloadedTasks || preloadedTasks.length === 0) {
      fetchTasks('score', 1000);  // Fetch up to 1000 tasks for comprehensive scoring display
    }
    if (!preloadedJobs || preloadedJobs.length === 0) {
      fetchJobs(true);
    }
  }, [fetchTasks, fetchJobs, preloadedTasks, preloadedJobs]);

  useEffect(() => {
    const scoringJobs = jobs.filter((j) => j.type === 'score_tasks');
    if (scoringJobs.length > 0) {
      setLastScoringJob(scoringJobs[0]);
    }
  }, [jobs]);

  useEffect(() => {
    if (!lastScoringJob || lastScoringJob.status !== 'processing') return;
    const intervalId = setInterval(() => {
      fetchJobs(true);
    }, 3000);
    return () => clearInterval(intervalId);
  }, [lastScoringJob?.status, fetchJobs]);

  useEffect(() => {
    if (lastScoringJob?.status === 'completed') {
      setIsScoring(false);  // Reset scoring state when job completes
      fetchTasks('score', 1000);  // Refetch all tasks after scoring completes
    } else if (lastScoringJob?.status === 'failed') {
      setIsScoring(false);
      setScoringError(lastScoringJob.error || 'Scoring job failed');
    }
  }, [lastScoringJob?.status, lastScoringJob?.error, fetchTasks]);

  const [scoringError, setScoringError] = useState<string | null>(null);

  const handleStartScoring = async () => {
    setIsScoring(true);
    setScoringError(null);
    try {
      console.log('[AIScoringResultsCard] Starting AI scoring...');
      const jobId = await scoreTasks();
      console.log('[AIScoringResultsCard] Scoring job started:', jobId);
      // Immediately fetch jobs to show progress
      await fetchJobs(true);
    } catch (error) {
      console.error('[AIScoringResultsCard] Scoring failed:', error);
      setScoringError(error instanceof Error ? error.message : 'Failed to start scoring');
      // Keep isScoring false so user can retry
      setIsScoring(false);
    }
    // Note: isScoring stays true until job completes or fails
    // The job polling will update the UI
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
    (t) => t.energyRequired === 'low' && (t.estimatedTime || 15) <= 15
  );

  // Score distribution
  const scoreDistribution = {
    high: scoredTasks.filter((t) => (t.score || 0) >= 70).length,
    medium: scoredTasks.filter((t) => (t.score || 0) >= 40 && (t.score || 0) < 70).length,
    low: scoredTasks.filter((t) => (t.score || 0) < 40).length,
  };

  // Generate insights
  const insights = [];

  if (avgScore >= 50) {
    insights.push({
      icon: TrendingUp,
      title: 'Your task list is well-prioritized',
      description: 'Your task list is well-prioritized to help with your productivity goals.',
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    });
  }

  const blockedTasks = tasks.filter((t) => t.dependsOnTaskIds && t.dependsOnTaskIds.length > 0 && !t.isCompleted);
  if (blockedTasks.length > 0) {
    insights.push({
      icon: AlertTriangle,
      title: `${blockedTasks.length} tasks are blocked by dependencies`,
      description: `Alerts, and ${blockedTasks.length} tasks are blocked by dependencies.`,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-500/10',
    });
  }

  const isProcessing = lastScoringJob?.status === 'processing';

  // Score color helper
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-yellow-500';
    return 'text-red-500';
  };

  return (
    <Tooltip.Provider>
      <div className="min-h-full bg-[#0d1117] text-white">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-cyan-400 font-bold text-lg tracking-wide mb-1">AIDD</div>
              <h1 className="text-2xl font-bold text-white">AI Scoring Results</h1>
            </div>
            <button
              onClick={handleStartScoring}
              disabled={isScoring || isProcessing}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                'bg-purple-600 hover:bg-purple-700 text-white',
                (isScoring || isProcessing) && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', (isScoring || isProcessing) && 'animate-spin')} />
              Re-score
            </button>
          </div>
        </div>

        {/* Processing Status */}
        {/* Error Message */}
        {scoringError && (
          <div className="px-6 py-4 bg-red-900/20 border-b border-gray-800">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span>Scoring error: {scoringError}</span>
              <button
                onClick={() => setScoringError(null)}
                className="ml-auto text-red-300 hover:text-red-200"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Scoring Started (waiting for job to appear) */}
        {isScoring && !isProcessing && !scoringError && (
          <div className="px-6 py-4 bg-purple-900/20 border-b border-gray-800">
            <div className="flex items-center gap-2 text-sm text-purple-300">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Starting AI scoring job...</span>
            </div>
          </div>
        )}

        {/* Processing Progress */}
        {isProcessing && lastScoringJob && (
          <div className="px-6 py-4 bg-purple-900/20 border-b border-gray-800">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400 animate-pulse" />
                  <span className="text-purple-300">
                    {lastScoringJob.progressMessage || 'AI is analyzing your tasks...'}
                  </span>
                </div>
                <span className="text-purple-400">
                  {Math.round(lastScoringJob.progress * 100)}%
                </span>
              </div>
              <Progress.Root
                value={lastScoringJob.progress * 100}
                max={100}
                className="h-2 rounded-full overflow-hidden bg-gray-700"
              >
                <Progress.Indicator
                  className="h-full bg-purple-500 transition-all"
                  style={{ width: `${lastScoringJob.progress * 100}%` }}
                />
              </Progress.Root>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-4">
            {/* Average Score */}
            <div className="bg-[#161b22] rounded-xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <Brain className="w-7 h-7 text-white" />
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{Math.round(avgScore)}</div>
                <div className="text-sm text-gray-400">Avg Score</div>
              </div>
            </div>

            {/* Tasks Scored */}
            <div className="bg-[#161b22] rounded-xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-white" />
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{scoredTasks.length}</div>
                <div className="text-sm text-gray-400">Tasks Scored</div>
              </div>
            </div>

            {/* Quick Wins */}
            <div className="bg-[#161b22] rounded-xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 flex items-center justify-center">
                <Zap className="w-7 h-7 text-white" />
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{quickWins.length}</div>
                <div className="text-sm text-gray-400">Quick Wins</div>
              </div>
            </div>
          </div>

          {/* Score Distribution */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">Score Distribution</h2>
            <div className="space-y-3">
              {/* High */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-400 w-24">High (70+)</span>
                <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all"
                    style={{ width: `${(scoreDistribution.high / (scoredTasks.length || 1)) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <span className="w-8 h-8 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-sm font-medium">
                    {scoreDistribution.high}
                  </span>
                </div>
              </div>

              {/* Medium */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-400 w-24">Med (40-69)</span>
                <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-500 to-yellow-400 rounded-full transition-all"
                    style={{ width: `${(scoreDistribution.medium / (scoredTasks.length || 1)) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400" />
                  <span className="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-sm font-medium">
                    {scoreDistribution.medium}
                  </span>
                </div>
              </div>

              {/* Low */}
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-400 w-24">Low (&lt;40)</span>
                <div className="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all"
                    style={{ width: `${(scoreDistribution.low / (scoredTasks.length || 1)) * 100}%` }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-red-400" />
                  <span className="w-8 h-8 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-sm font-medium">
                    {scoreDistribution.low}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Top Priority Tasks */}
          {topTasks.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">Top Priority Tasks</h2>
              <div className="space-y-3">
                {topTasks.map((task, index) => {
                  const score = task.score || 0;
                  return (
                    <button
                      key={task.id}
                      onClick={() => onTaskSelect?.(task)}
                      className="w-full bg-[#161b22] rounded-xl p-4 flex items-center gap-4 hover:bg-[#1c2128] transition-colors border border-transparent hover:border-purple-500/50"
                    >
                      {/* Rank Badge */}
                      <div
                        className={cn(
                          'w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg text-white',
                          index === 0
                            ? 'bg-gradient-to-br from-purple-600 to-purple-700'
                            : index === 1
                            ? 'bg-gradient-to-br from-purple-500 to-purple-600'
                            : 'bg-gradient-to-br from-purple-400 to-purple-500'
                        )}
                      >
                        {index + 1}.
                      </div>

                      {/* Task Title */}
                      <div className="flex-1 text-left">
                        <p className="font-medium text-white truncate">{task.title}</p>
                      </div>

                      {/* Score Badge */}
                      <div className="flex items-center gap-2">
                        <AlertCircle className={cn('w-5 h-5', getScoreColor(score))} />
                        <span className={cn('text-xl font-bold', getScoreColor(score))}>
                          {Math.round(score)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Insights */}
          {showRecommendations && insights.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-white mb-4">AI Insights</h2>
              <div className="grid grid-cols-2 gap-4">
                {insights.map((insight, index) => {
                  const Icon = insight.icon;
                  return (
                    <div
                      key={index}
                      className={cn('rounded-xl p-4', insight.bgColor)}
                    >
                      <div className="flex items-start gap-3">
                        <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', insight.color)} />
                        <div>
                          <p className={cn('font-medium', insight.color)}>{insight.title}</p>
                          <p className="text-sm text-gray-400 mt-1">{insight.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {scoredTasks.length === 0 && !isProcessing && (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 text-lg">No scored tasks yet</p>
              <p className="text-gray-500 text-sm mt-2">Click "Re-score" to analyze your tasks with AI</p>
            </div>
          )}
        </div>

        {/* Last Updated Footer */}
        {lastScoringJob && lastScoringJob.status === 'completed' && (
          <div className="px-6 py-3 border-t border-gray-800 text-xs text-gray-500 flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            <span>Last scored {new Date(lastScoringJob.updatedAt).toLocaleString()}</span>
          </div>
        )}
      </div>
    </Tooltip.Provider>
  );
}

export default AIScoringResultsCard;
