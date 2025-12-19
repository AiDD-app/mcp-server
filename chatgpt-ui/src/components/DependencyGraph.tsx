/**
 * Dependency Graph Component
 *
 * Visual representation of task dependencies.
 * Shows which tasks block others and critical path highlighting.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { useTasks, useOpenAI } from '../hooks/useOpenAI';
import type { Task } from '../types/openai';
import { cn } from '../utils/cn';
import {
  GitBranch,
  ArrowRight,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Lock,
  Unlock,
  Clock,
  ChevronRight,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

interface DependencyGraphProps {
  onTaskSelect?: (task: Task) => void;
  maxDepth?: number;
}

interface TaskNode {
  task: Task;
  level: number;
  blockedBy: string[];
  blocks: string[];
  isBlocked: boolean;
  isCriticalPath: boolean;
}

export function DependencyGraph({
  onTaskSelect,
  maxDepth = 5,
}: DependencyGraphProps) {
  const { theme, requestFullscreen, toolOutput } = useOpenAI();
  const { tasks: fetchedTasks, loading, fetchTasks } = useTasks();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');

  const isDark = theme === 'dark';

  // Use pre-populated toolOutput.tasks if available (from tool call that triggered this widget)
  // Otherwise fall back to fetched tasks
  const preloadedTasks = (toolOutput as { tasks?: Task[] })?.tasks;
  const tasks = preloadedTasks || fetchedTasks;

  useEffect(() => {
    // Only fetch if no pre-populated data from toolOutput
    if (!preloadedTasks || preloadedTasks.length === 0) {
      fetchTasks('score', 100);
    }
  }, [fetchTasks, preloadedTasks]);

  // Build dependency graph
  const graph = useMemo(() => {
    const nodes = new Map<string, TaskNode>();
    const taskMap = new Map<string, Task>();

    // First pass: create task map
    tasks.forEach((task) => {
      taskMap.set(task.id, task);
    });

    // Second pass: build nodes with relationships
    tasks.forEach((task) => {
      const blockedBy = task.dependsOnTaskIds || [];
      const blocks: string[] = [];

      // Find tasks that depend on this one
      tasks.forEach((otherTask) => {
        if (otherTask.dependsOnTaskIds?.includes(task.id)) {
          blocks.push(otherTask.id);
        }
      });

      // Check if blocked (any dependency not completed)
      const isBlocked = blockedBy.some((depId) => {
        const depTask = taskMap.get(depId);
        return depTask && !depTask.isCompleted;
      });

      nodes.set(task.id, {
        task,
        level: 0,
        blockedBy,
        blocks,
        isBlocked,
        isCriticalPath: false,
      });
    });

    // Third pass: calculate levels (topological sort)
    const calculateLevel = (taskId: string, visited = new Set<string>()): number => {
      if (visited.has(taskId)) return 0;
      visited.add(taskId);

      const node = nodes.get(taskId);
      if (!node || node.blockedBy.length === 0) return 0;

      const maxDepLevel = Math.max(
        ...node.blockedBy.map((depId) => calculateLevel(depId, visited) + 1)
      );

      node.level = maxDepLevel;
      return maxDepLevel;
    };

    nodes.forEach((_, taskId) => {
      calculateLevel(taskId);
    });

    // Fourth pass: identify critical path (longest chain)
    const criticalPathLength = Math.max(...Array.from(nodes.values()).map((n) => n.level));
    nodes.forEach((node) => {
      if (node.level === criticalPathLength && node.blocks.length === 0) {
        // Mark entire chain as critical
        let current: TaskNode | undefined = node;
        while (current) {
          current.isCriticalPath = true;
          if (current.blockedBy.length > 0) {
            current = nodes.get(current.blockedBy[0]);
          } else {
            current = undefined;
          }
        }
      }
    });

    return nodes;
  }, [tasks]);

  // Group by level
  const levels = useMemo(() => {
    const levelMap = new Map<number, TaskNode[]>();

    graph.forEach((node) => {
      const level = node.level;
      if (!levelMap.has(level)) {
        levelMap.set(level, []);
      }
      levelMap.get(level)!.push(node);
    });

    return Array.from(levelMap.entries()).sort(([a], [b]) => a - b);
  }, [graph]);

  // Tasks with dependencies only
  const tasksWithDeps = useMemo(() => {
    return Array.from(graph.values()).filter(
      (node) => node.blockedBy.length > 0 || node.blocks.length > 0
    );
  }, [graph]);

  const handleTaskClick = (task: Task) => {
    setSelectedTaskId(task.id === selectedTaskId ? null : task.id);
    onTaskSelect?.(task);
  };

  const getStatusIcon = (node: TaskNode) => {
    if (node.task.isCompleted) {
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    }
    if (node.isBlocked) {
      return <Lock className="w-4 h-4 text-red-500" />;
    }
    return <Unlock className="w-4 h-4 text-blue-500" />;
  };

  const renderTreeView = () => (
    <div className="space-y-6">
      {levels.map(([level, nodes]) => (
        <div key={level}>
          <div
            className={cn(
              'text-xs font-medium mb-2 flex items-center gap-2',
              isDark ? 'text-gray-500' : 'text-gray-400'
            )}
          >
            <span>Level {level}</span>
            <span className="text-xs">({nodes.length} tasks)</span>
          </div>

          <div className="flex flex-wrap gap-3">
            {nodes.map((node) => {
              const isSelected = node.task.id === selectedTaskId;

              return (
                <Tooltip.Root key={node.task.id}>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => handleTaskClick(node.task)}
                      className={cn(
                        'p-3 rounded-lg border transition-all text-left min-w-48',
                        isSelected && 'ring-2 ring-purple-500',
                        node.isCriticalPath && 'border-orange-500 border-2',
                        node.task.isCompleted
                          ? isDark
                            ? 'bg-gray-800 border-gray-700 opacity-50'
                            : 'bg-gray-100 border-gray-200 opacity-50'
                          : node.isBlocked
                          ? isDark
                            ? 'bg-red-900/20 border-red-700'
                            : 'bg-red-50 border-red-200'
                          : isDark
                          ? 'bg-gray-800 border-gray-700 hover:border-blue-500'
                          : 'bg-white border-gray-200 hover:border-blue-400'
                      )}
                    >
                      <div className="flex items-start gap-2">
                        {getStatusIcon(node)}
                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              'font-medium text-sm truncate',
                              isDark ? 'text-white' : 'text-gray-900',
                              node.task.isCompleted && 'line-through'
                            )}
                          >
                            {node.task.title}
                          </p>

                          <div className="flex items-center gap-2 mt-1 text-xs">
                            {node.blockedBy.length > 0 && (
                              <span
                                className={cn(
                                  'flex items-center gap-1',
                                  isDark ? 'text-red-400' : 'text-red-600'
                                )}
                              >
                                <Lock className="w-3 h-3" />
                                {node.blockedBy.length}
                              </span>
                            )}
                            {node.blocks.length > 0 && (
                              <span
                                className={cn(
                                  'flex items-center gap-1',
                                  isDark ? 'text-blue-400' : 'text-blue-600'
                                )}
                              >
                                <ArrowRight className="w-3 h-3" />
                                {node.blocks.length}
                              </span>
                            )}
                            {node.task.estimatedTime && (
                              <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
                                <Clock className="w-3 h-3 inline" /> {node.task.estimatedTime}m
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {node.isCriticalPath && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-orange-500">
                          <AlertTriangle className="w-3 h-3" />
                          Critical Path
                        </div>
                      )}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs max-w-xs',
                      isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                    )}
                  >
                    {node.isBlocked ? (
                      <p>
                        Blocked by {node.blockedBy.length} task(s). Complete dependencies first.
                      </p>
                    ) : node.blocks.length > 0 ? (
                      <p>This task blocks {node.blocks.length} other task(s).</p>
                    ) : (
                      <p>No dependencies. Ready to work on.</p>
                    )}
                  </Tooltip.Content>
                </Tooltip.Root>
              );
            })}
          </div>

          {/* Connection lines to next level */}
          {level < levels.length - 1 && (
            <div
              className={cn(
                'flex items-center justify-center py-2',
                isDark ? 'text-gray-600' : 'text-gray-300'
              )}
            >
              <ChevronRight className="w-6 h-6 rotate-90" />
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const renderListView = () => (
    <div className="space-y-2">
      {tasksWithDeps.map((node) => (
        <div
          key={node.task.id}
          onClick={() => handleTaskClick(node.task)}
          className={cn(
            'p-3 rounded-lg border cursor-pointer transition-all',
            selectedTaskId === node.task.id && 'ring-2 ring-purple-500',
            isDark
              ? 'border-gray-700 hover:border-gray-600'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <div className="flex items-center gap-3">
            {getStatusIcon(node)}

            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  'font-medium truncate',
                  isDark ? 'text-white' : 'text-gray-900'
                )}
              >
                {node.task.title}
              </p>
            </div>

            <div className="flex items-center gap-4 text-sm">
              {node.blockedBy.length > 0 && (
                <span
                  className={cn(
                    'flex items-center gap-1',
                    isDark ? 'text-red-400' : 'text-red-600'
                  )}
                >
                  <Lock className="w-4 h-4" />
                  Blocked by {node.blockedBy.length}
                </span>
              )}
              {node.blocks.length > 0 && (
                <span
                  className={cn(
                    'flex items-center gap-1',
                    isDark ? 'text-blue-400' : 'text-blue-600'
                  )}
                >
                  Blocks {node.blocks.length}
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

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
            <GitBranch className="w-5 h-5 text-blue-500" />
            <h2 className={cn('font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
              Task Dependencies
            </h2>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
              )}
            >
              {tasksWithDeps.length} connected
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div
              className={cn(
                'flex rounded-lg border p-0.5',
                isDark ? 'border-gray-700' : 'border-gray-200'
              )}
            >
              <button
                onClick={() => setViewMode('tree')}
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium transition-colors',
                  viewMode === 'tree'
                    ? 'bg-purple-600 text-white'
                    : isDark
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-500 hover:text-gray-900'
                )}
              >
                Tree
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'px-2 py-1 rounded text-xs font-medium transition-colors',
                  viewMode === 'list'
                    ? 'bg-purple-600 text-white'
                    : isDark
                    ? 'text-gray-400 hover:text-white'
                    : 'text-gray-500 hover:text-gray-900'
                )}
              >
                List
              </button>
            </div>

            <button
              onClick={requestFullscreen}
              className={cn(
                'p-2 rounded-lg transition-colors',
                isDark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
              )}
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : tasksWithDeps.length === 0 ? (
            <div
              className={cn(
                'text-center py-8',
                isDark ? 'text-gray-400' : 'text-gray-500'
              )}
            >
              <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No task dependencies found</p>
              <p className="text-sm mt-1">
                Tasks with dependencies will appear here
              </p>
            </div>
          ) : viewMode === 'tree' ? (
            renderTreeView()
          ) : (
            renderListView()
          )}
        </div>

        {/* Legend */}
        <div
          className={cn(
            'px-4 py-2 border-t flex items-center gap-4 text-xs',
            isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
          )}
        >
          <span className="flex items-center gap-1 text-green-500">
            <CheckCircle2 className="w-3 h-3" /> Completed
          </span>
          <span className="flex items-center gap-1 text-blue-500">
            <Unlock className="w-3 h-3" /> Ready
          </span>
          <span className="flex items-center gap-1 text-red-500">
            <Lock className="w-3 h-3" /> Blocked
          </span>
          <span className="flex items-center gap-1 text-orange-500">
            <AlertTriangle className="w-3 h-3" /> Critical Path
          </span>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default DependencyGraph;
