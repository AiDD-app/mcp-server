/**
 * Dependency Graph Component
 *
 * Visual representation of task dependencies for a SELECTED ACTION ITEM.
 * Shows all tasks derived from the action item and their interdependencies.
 * Clear tree hierarchy with parent-child connections.
 *
 * Redesigned with modern dark theme and action-item-centric view.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { useTasks, useActionItems, useOpenAI } from '../hooks/useOpenAI';
import type { Task, ActionItem } from '../types/openai';
import { cn } from '../utils/cn';
import { decodeHTMLEntities } from '../utils/htmlEntities';
import { getTasksFromToolOutput, getActionItemsFromToolOutput } from '../utils/toolOutput';
import {
  GitBranch,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Lock,
  Unlock,
  Clock,
  RefreshCw,
  Maximize2,
  Search,
  X,
  ArrowDown,
  Target,
  FileText,
  Layers,
  AlertCircle,
  Zap,
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
  isRoot: boolean; // No dependencies within this action item's tasks
}

export function DependencyGraph({
  onTaskSelect,
  maxDepth = 10,
}: DependencyGraphProps) {
  const { theme, requestFullscreen, toolOutput } = useOpenAI();
  const { tasks: fetchedTasks, loading: tasksLoading, fetchTasks } = useTasks();
  const { actionItems: fetchedActionItems, loading: actionItemsLoading, fetchActionItems } = useActionItems();
  const [selectedActionItemId, setSelectedActionItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  const isDark = theme === 'dark';
  const loading = tasksLoading || actionItemsLoading;

  // Use pre-populated toolOutput if available
  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  const preloadedActionItems = getActionItemsFromToolOutput(toolOutput);
  const tasks = preloadedTasks || fetchedTasks;
  const actionItems = preloadedActionItems || fetchedActionItems;

  useEffect(() => {
    if (!preloadedTasks || preloadedTasks.length === 0) {
      fetchTasks('score', 500);
    }
    if (!preloadedActionItems || preloadedActionItems.length === 0) {
      fetchActionItems(500);
    }
  }, [fetchTasks, fetchActionItems, preloadedTasks, preloadedActionItems]);

  // Group tasks by action item
  const tasksByActionItem = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((task) => {
      const actionItemId = task.actionItemId || task.sourceActionItem?.title;
      if (actionItemId) {
        if (!map.has(actionItemId)) {
          map.set(actionItemId, []);
        }
        map.get(actionItemId)!.push(task);
      }
    });
    return map;
  }, [tasks]);

  // Action items that have tasks with dependencies
  const actionItemsWithDeps = useMemo(() => {
    const result: { actionItem: ActionItem; taskCount: number; hasDepenencies: boolean }[] = [];

    actionItems.forEach((ai) => {
      const aiTasks = tasksByActionItem.get(ai.id) || [];
      if (aiTasks.length > 0) {
        const hasDeps = aiTasks.some(t =>
          (t.dependsOnTaskIds && t.dependsOnTaskIds.length > 0) ||
          aiTasks.some(other => other.dependsOnTaskIds?.includes(t.id))
        );
        result.push({
          actionItem: ai,
          taskCount: aiTasks.length,
          hasDepenencies: hasDeps,
        });
      }
    });

    // Sort by task count (more tasks = more interesting)
    return result.sort((a, b) => b.taskCount - a.taskCount);
  }, [actionItems, tasksByActionItem]);

  // Filter action items for search
  const filteredActionItems = useMemo(() => {
    if (!searchQuery.trim()) return actionItemsWithDeps;
    const q = searchQuery.toLowerCase();
    return actionItemsWithDeps.filter((item) =>
      item.actionItem.title.toLowerCase().includes(q)
    );
  }, [actionItemsWithDeps, searchQuery]);

  // Auto-select first action item with dependencies if none selected
  useEffect(() => {
    if (!selectedActionItemId && actionItemsWithDeps.length > 0) {
      // Prefer one with dependencies
      const withDeps = actionItemsWithDeps.find(a => a.hasDepenencies);
      setSelectedActionItemId((withDeps || actionItemsWithDeps[0]).actionItem.id);
    }
  }, [actionItemsWithDeps, selectedActionItemId]);

  // Get selected action item
  const selectedActionItem = actionItemsWithDeps.find(
    (a) => a.actionItem.id === selectedActionItemId
  )?.actionItem;

  // Tasks for selected action item
  const selectedTasks = useMemo(() => {
    if (!selectedActionItemId) return [];
    return tasksByActionItem.get(selectedActionItemId) || [];
  }, [selectedActionItemId, tasksByActionItem]);

  // Build dependency tree for selected action item's tasks
  const dependencyTree = useMemo(() => {
    if (selectedTasks.length === 0) return { levels: [], taskNodes: new Map<string, TaskNode>() };

    const taskMap = new Map<string, Task>();
    selectedTasks.forEach((t) => taskMap.set(t.id, t));

    // Build task nodes
    const nodes = new Map<string, TaskNode>();

    selectedTasks.forEach((task) => {
      // Filter dependencies to only include tasks in this action item
      const blockedBy = (task.dependsOnTaskIds || []).filter((id) => taskMap.has(id));
      const blocks = selectedTasks
        .filter((other) => other.dependsOnTaskIds?.includes(task.id))
        .map((t) => t.id);

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
        isRoot: blockedBy.length === 0,
      });
    });

    // Calculate levels using topological sort
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

    // Group by level
    const levelMap = new Map<number, TaskNode[]>();
    nodes.forEach((node) => {
      const level = node.level;
      if (!levelMap.has(level)) {
        levelMap.set(level, []);
      }
      levelMap.get(level)!.push(node);
    });

    // Sort levels and nodes within each level by taskOrder
    const levels = Array.from(levelMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([level, levelNodes]) => ({
        level,
        nodes: levelNodes.sort((a, b) => (a.task.taskOrder || 0) - (b.task.taskOrder || 0)),
      }));

    return { levels, taskNodes: nodes };
  }, [selectedTasks]);

  // Get status info for styling
  const getStatusInfo = (node: TaskNode) => {
    if (node.task.isCompleted) {
      return {
        icon: CheckCircle2,
        label: 'Completed',
        textColor: 'text-green-400',
        bgColor: 'bg-green-500/20',
        borderColor: 'border-green-500/50',
        connectorColor: 'bg-green-500',
      };
    }
    if (node.isBlocked) {
      return {
        icon: Lock,
        label: 'Blocked',
        textColor: 'text-red-400',
        bgColor: 'bg-red-500/20',
        borderColor: 'border-red-500/50',
        connectorColor: 'bg-red-500',
      };
    }
    return {
      icon: Unlock,
      label: 'Ready',
      textColor: 'text-cyan-400',
      bgColor: 'bg-cyan-500/20',
      borderColor: 'border-cyan-500/50',
      connectorColor: 'bg-cyan-500',
    };
  };

  const handleTaskClick = (task: Task) => {
    setHighlightedTaskId(task.id === highlightedTaskId ? null : task.id);
    onTaskSelect?.(task);
  };

  // Get connections for a task (for visual lines)
  const getRelatedTaskIds = (taskId: string) => {
    const node = dependencyTree.taskNodes.get(taskId);
    if (!node) return { dependencies: [], dependents: [] };
    return { dependencies: node.blockedBy, dependents: node.blocks };
  };

  // Check if a task is related to highlighted task
  const isRelatedToHighlighted = (taskId: string) => {
    if (!highlightedTaskId) return false;
    const { dependencies, dependents } = getRelatedTaskIds(highlightedTaskId);
    return dependencies.includes(taskId) || dependents.includes(taskId);
  };

  // Render a task card
  const renderTaskCard = (node: TaskNode) => {
    const status = getStatusInfo(node);
    const StatusIcon = status.icon;
    const isHighlighted = node.task.id === highlightedTaskId;
    const isRelated = isRelatedToHighlighted(node.task.id);
    const hasDeps = node.blockedBy.length > 0;
    const hasDependents = node.blocks.length > 0;

    return (
      <Tooltip.Root key={node.task.id}>
        <Tooltip.Trigger asChild>
          <button
            onClick={() => handleTaskClick(node.task)}
            className={cn(
              'relative p-3 rounded-xl border-2 transition-all text-left w-full',
              'bg-[#161b22] hover:bg-[#1c2128]',
              isHighlighted
                ? 'border-purple-500 ring-2 ring-purple-500/50 bg-purple-600/20'
                : isRelated
                ? 'border-yellow-500/70 bg-yellow-500/10'
                : status.borderColor
            )}
          >
            <div className="flex items-start gap-3">
              {/* Task Order Badge */}
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm',
                isHighlighted ? 'bg-purple-600 text-white' : status.bgColor + ' ' + status.textColor
              )}>
                {node.task.taskOrder || '?'}
              </div>

              <div className="flex-1 min-w-0">
                {/* Task Title */}
                <p
                  className={cn(
                    'font-medium text-sm truncate text-white',
                    node.task.isCompleted && 'line-through opacity-60'
                  )}
                >
                  {decodeHTMLEntities(node.task.title)}
                </p>

                {/* Meta Info Row */}
                <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium',
                      status.bgColor,
                      status.textColor
                    )}
                  >
                    <StatusIcon className="w-3 h-3" />
                    {status.label}
                  </span>

                  {node.task.estimatedTime && (
                    <span className="flex items-center gap-1 text-gray-400">
                      <Clock className="w-3 h-3" />
                      {node.task.estimatedTime}m
                    </span>
                  )}

                  {node.task.energyRequired && (
                    <span className={cn(
                      'flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
                      node.task.energyRequired === 'high' ? 'text-red-400 bg-red-500/10' :
                      node.task.energyRequired === 'medium' ? 'text-yellow-400 bg-yellow-500/10' :
                      'text-green-400 bg-green-500/10'
                    )}>
                      <Zap className="w-3 h-3" />
                      {node.task.energyRequired}
                    </span>
                  )}
                </div>

                {/* Dependency indicators */}
                <div className="flex items-center gap-3 mt-2 text-xs">
                  {hasDeps && (
                    <span className="flex items-center gap-1 text-red-400">
                      <ArrowLeft className="w-3 h-3" />
                      {node.blockedBy.length} dep{node.blockedBy.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {hasDependents && (
                    <span className="flex items-center gap-1 text-cyan-400">
                      <ArrowRight className="w-3 h-3" />
                      blocks {node.blocks.length}
                    </span>
                  )}
                  {node.isRoot && !hasDependents && (
                    <span className="text-gray-500">standalone</span>
                  )}
                </div>
              </div>
            </div>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content
          className="px-3 py-2 rounded-lg text-xs bg-gray-800 text-white border border-gray-700 max-w-xs z-50"
          sideOffset={5}
        >
          <p className="font-medium mb-1">{decodeHTMLEntities(node.task.title)}</p>
          {node.task.description && (
            <p className="text-gray-400 mb-2 line-clamp-2">{decodeHTMLEntities(node.task.description)}</p>
          )}
          {hasDeps && (
            <p className="text-red-400">
              Depends on: {node.blockedBy.map(id => {
                const t = dependencyTree.taskNodes.get(id);
                return t ? `#${t.task.taskOrder}` : id;
              }).join(', ')}
            </p>
          )}
          {hasDependents && (
            <p className="text-cyan-400">
              Blocks: {node.blocks.map(id => {
                const t = dependencyTree.taskNodes.get(id);
                return t ? `#${t.task.taskOrder}` : id;
              }).join(', ')}
            </p>
          )}
          <p className="text-gray-500 mt-1">Click to highlight connections</p>
        </Tooltip.Content>
      </Tooltip.Root>
    );
  };

  const totalTasks = selectedTasks.length;
  const tasksWithDeps = selectedTasks.filter(
    t => (t.dependsOnTaskIds?.length || 0) > 0 ||
         selectedTasks.some(other => other.dependsOnTaskIds?.includes(t.id))
  ).length;

  return (
    <Tooltip.Provider>
      <div className="min-h-full bg-[#0d1117] text-white">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-cyan-400 font-bold text-lg tracking-wide mb-1">AIDD</div>
              <h1 className="text-2xl font-bold text-white">Task Dependencies</h1>
              <p className="text-gray-400 text-sm mt-1">
                Select an action item to view its task breakdown and dependencies
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={requestFullscreen}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Action Item Selector */}
        <div className="px-6 py-4 border-b border-gray-800 bg-[#161b22]">
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Select an action item to view its tasks
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search action items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 bg-[#0d1117] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Action Item List (scrollable) */}
          <div className="mt-3 max-h-48 overflow-y-auto space-y-1 pr-2 scrollbar-thin">
            {filteredActionItems.map(({ actionItem, taskCount, hasDepenencies }) => {
              const isSelected = actionItem.id === selectedActionItemId;

              return (
                <button
                  key={actionItem.id}
                  onClick={() => setSelectedActionItemId(actionItem.id)}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-lg text-left transition-all flex items-center gap-3',
                    isSelected
                      ? 'bg-purple-600/30 border border-purple-500'
                      : 'bg-[#0d1117] border border-gray-800 hover:border-gray-600'
                  )}
                >
                  <div className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                    isSelected ? 'bg-purple-600' : 'bg-gray-700'
                  )}>
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-sm truncate',
                      isSelected ? 'text-white font-medium' : 'text-gray-300'
                    )}>
                      {actionItem.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                      <span>{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
                      {hasDepenencies && (
                        <span className="flex items-center gap-1 text-cyan-500">
                          <GitBranch className="w-3 h-3" />
                          has dependencies
                        </span>
                      )}
                      {actionItem.priority && (
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-xs',
                          actionItem.priority === 'high' || actionItem.priority === 'urgent'
                            ? 'bg-red-500/20 text-red-400'
                            : actionItem.priority === 'medium'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-gray-500/20 text-gray-400'
                        )}>
                          {actionItem.priority}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredActionItems.length === 0 && (
              <p className="text-center text-gray-500 py-4 text-sm">
                {searchQuery ? 'No action items match your search' : 'No action items with tasks found'}
              </p>
            )}
          </div>
        </div>

        {/* Task Dependency Tree View */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
            </div>
          ) : !selectedActionItem ? (
            <div className="text-center py-12">
              <FileText className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 text-lg">Select an action item to view tasks</p>
              <p className="text-gray-500 text-sm mt-2">
                Choose from the list above to see task breakdown and dependencies
              </p>
            </div>
          ) : selectedTasks.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400 text-lg">No tasks for this action item</p>
              <p className="text-gray-500 text-sm mt-2">
                This action item hasn't been converted to tasks yet
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Selected Action Item Header */}
              <div className="bg-purple-600/20 border border-purple-500/50 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center flex-shrink-0">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-white">{selectedActionItem.title}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                      <span>{totalTasks} task{totalTasks !== 1 ? 's' : ''}</span>
                      <span>{tasksWithDeps} with dependencies</span>
                      <span>{dependencyTree.levels.length} level{dependencyTree.levels.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Clear highlight button */}
              {highlightedTaskId && (
                <div className="flex justify-center">
                  <button
                    onClick={() => setHighlightedTaskId(null)}
                    className="px-3 py-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2 hover:bg-yellow-500/30 transition-colors"
                  >
                    <X className="w-4 h-4" />
                    Clear highlight
                  </button>
                </div>
              )}

              {/* Dependency Levels */}
              {dependencyTree.levels.map(({ level, nodes: levelNodes }, levelIndex) => (
                <div key={level} className="relative">
                  {/* Level Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center',
                      level === 0 ? 'bg-green-600' : 'bg-purple-600'
                    )}>
                      <Layers className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-300">
                      {level === 0 ? 'Root Tasks (no dependencies)' : `Level ${level}`}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({levelNodes.length} task{levelNodes.length !== 1 ? 's' : ''})
                    </span>
                  </div>

                  {/* Task Cards Grid */}
                  <div className={cn(
                    'grid gap-3 ml-10',
                    levelNodes.length === 1 ? 'grid-cols-1 max-w-md' :
                    levelNodes.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
                    'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                  )}>
                    {levelNodes.map((node) => renderTaskCard(node))}
                  </div>

                  {/* Connector to next level */}
                  {levelIndex < dependencyTree.levels.length - 1 && (
                    <div className="flex items-center justify-center py-4 ml-10">
                      <div className="flex flex-col items-center text-gray-500">
                        <div className="w-px h-4 bg-gradient-to-b from-gray-600 to-gray-700" />
                        <ArrowDown className="w-4 h-4" />
                        <span className="text-xs mt-1">depends on</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Legend Footer */}
        <div className="px-6 py-3 border-t border-gray-800 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-gray-400">Completed</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-cyan-500" />
            <span className="text-gray-400">Ready</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-gray-400">Blocked</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-purple-500" />
            <span className="text-gray-400">Highlighted</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="text-gray-400">Related</span>
          </span>
          <span className="flex items-center gap-2 ml-auto text-gray-500">
            Click a task to highlight its connections
          </span>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default DependencyGraph;
