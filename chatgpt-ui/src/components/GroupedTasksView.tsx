/**
 * Grouped Tasks View Component
 *
 * Displays tasks grouped by their parent action item, sorted in dependency order.
 * Mirrors the web app's GroupedTaskList functionality for MCP widget.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useTasks, useActionItems, useOpenAI } from '../hooks/useOpenAI';
import type { Task, ActionItem, DependencyTask } from '../types/openai';
import { cn } from '../utils/cn';
import { getTasksFromToolOutput } from '../utils/toolOutput';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  RefreshCw,
  Clock,
  Battery,
  BatteryLow,
  BatteryMedium,
  Link2,
  FileText,
  Zap,
  Layers,
  Tag,
} from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Checkbox from '@radix-ui/react-checkbox';

interface GroupedTasksViewProps {
  onTaskSelect?: (task: Task) => void;
  showCompleted?: boolean;
}

interface TaskGroup {
  id: string;
  title: string;
  subtitle?: string;
  tasks: Task[];
  actionItem?: ActionItem;
  priority?: string;
  avgScore?: number;
  isExpanded: boolean;
}

export function GroupedTasksView({
  onTaskSelect,
  showCompleted = false,
}: GroupedTasksViewProps) {
  const { theme, toolOutput, displayMode } = useOpenAI();
  const { tasks: fetchedTasks, loading, error, fetchTasks, completeTask } = useTasks();
  const { actionItems, fetchActionItems } = useActionItems();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['all']));

  const isDark = theme === 'dark';
  const isFullscreen = displayMode === 'fullscreen';

  const preloadedTasks = getTasksFromToolOutput(toolOutput);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(false);
  const tasks = hasFetchedOnce ? fetchedTasks : (preloadedTasks || fetchedTasks);

  // Initial load
  useEffect(() => {
    fetchTasks('score', 100).then(() => setHasFetchedOnce(true));
    fetchActionItems();
  }, []);

  // Create action item lookup map
  const actionItemMap = useMemo(() => {
    const map = new Map<string, ActionItem>();
    actionItems.forEach(item => map.set(item.id, item));
    return map;
  }, [actionItems]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return showCompleted ? tasks : tasks.filter(t => !t.isCompleted);
  }, [tasks, showCompleted]);

  // Sort tasks within a group by taskOrder (dependency order)
  const sortTasksInGroup = (taskList: Task[]): Task[] => {
    return [...taskList].sort((a, b) => {
      // Sort by taskOrder for proper dependency sequencing
      const aOrder = a.taskOrder ?? 999;
      const bOrder = b.taskOrder ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Secondary sort by score
      return (b.score || 0) - (a.score || 0);
    });
  };

  // Group tasks by action item
  const groupedTasks = useMemo((): TaskGroup[] => {
    const groups: TaskGroup[] = [];
    const byActionItem = new Map<string, Task[]>();
    const ungrouped: Task[] = [];

    filteredTasks.forEach(task => {
      if (task.actionItemId) {
        const existing = byActionItem.get(task.actionItemId) || [];
        existing.push(task);
        byActionItem.set(task.actionItemId, existing);
      } else {
        ungrouped.push(task);
      }
    });

    // Create groups for action items, sorted by action item priority
    const actionItemGroups: TaskGroup[] = [];
    byActionItem.forEach((taskList, actionItemId) => {
      const actionItem = actionItemMap.get(actionItemId);
      const avgScore = taskList.reduce((sum, t) => sum + (t.score || 0), 0) / taskList.length;

      actionItemGroups.push({
        id: actionItemId,
        title: actionItem?.title || 'Unknown Action Item',
        subtitle: actionItem?.source ? `Source: ${actionItem.source}` : undefined,
        tasks: sortTasksInGroup(taskList),
        actionItem,
        priority: actionItem?.priority,
        avgScore,
        isExpanded: expandedGroups.has(actionItemId) || expandedGroups.has('all'),
      });
    });

    // Sort groups by action item priority, then by average score
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    actionItemGroups.sort((a, b) => {
      const aPriority = priorityOrder[(a.priority || 'medium').toLowerCase()] ?? 2;
      const bPriority = priorityOrder[(b.priority || 'medium').toLowerCase()] ?? 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return (b.avgScore || 0) - (a.avgScore || 0);
    });

    groups.push(...actionItemGroups);

    // Add ungrouped tasks
    if (ungrouped.length > 0) {
      groups.push({
        id: 'ungrouped',
        title: 'Standalone Tasks',
        subtitle: 'Tasks not linked to action items',
        tasks: sortTasksInGroup(ungrouped),
        avgScore: ungrouped.reduce((sum, t) => sum + (t.score || 0), 0) / ungrouped.length,
        isExpanded: expandedGroups.has('ungrouped') || expandedGroups.has('all'),
      });
    }

    return groups;
  }, [filteredTasks, actionItemMap, expandedGroups]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.delete('all');
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedGroups(new Set(['all']));
  const collapseAll = () => setExpandedGroups(new Set());

  const handleToggleComplete = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    await completeTask(task.id);
    setTimeout(() => fetchTasks('score', 100), 500);
  };

  const getEnergyIcon = (energy?: string) => {
    switch (energy) {
      case 'low':
        return <BatteryLow className="w-3 h-3 text-green-400" />;
      case 'medium':
        return <BatteryMedium className="w-3 h-3 text-yellow-400" />;
      case 'high':
        return <Battery className="w-3 h-3 text-red-400" />;
      default:
        return <Battery className="w-3 h-3 text-gray-500" />;
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority?.toLowerCase()) {
      case 'urgent':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const totalTasks = filteredTasks.length;
  const completedCount = tasks.filter(t => t.isCompleted).length;
  const activeCount = tasks.filter(t => !t.isCompleted).length;

  return (
    <Tooltip.Provider>
      <div className={cn(
        'bg-[#0d1117] text-white flex flex-col rounded-xl border border-gray-800 overflow-hidden',
        isFullscreen ? 'h-full' : 'min-h-full'
      )}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-white">Tasks by Action Item</h2>
            <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-xs">
              {activeCount} active
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchTasks('score', 100)}
              disabled={loading}
              className={cn(
                'p-2 rounded-lg transition-colors',
                'hover:bg-gray-800 text-gray-400 hover:text-white',
                loading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Expand/Collapse Controls */}
        {groupedTasks.length > 1 && (
          <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-4 text-xs">
            <button
              onClick={expandAll}
              className="text-blue-400 hover:text-blue-300 transition-colors"
            >
              Expand All
            </button>
            <span className="text-gray-600">|</span>
            <button
              onClick={collapseAll}
              className="text-gray-400 hover:text-gray-300 transition-colors"
            >
              Collapse All
            </button>
          </div>
        )}

        {/* Content */}
        <div className={cn('p-4', isFullscreen && 'flex-1 overflow-y-auto')}>
          {loading && !tasks.length ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400">
              <p>{error}</p>
            </div>
          ) : groupedTasks.length === 0 ? (
            <div className="text-center py-8">
              <Circle className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400">No tasks found</p>
              <p className="text-gray-500 text-sm mt-1">Create tasks from action items</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedTasks.map((group) => {
                const completedInGroup = group.tasks.filter(t => t.isCompleted).length;
                const progress = group.tasks.length > 0 ? (completedInGroup / group.tasks.length) * 100 : 0;

                return (
                  <div
                    key={group.id}
                    className="bg-[#161b22] rounded-lg border border-gray-800 overflow-hidden"
                  >
                    {/* Group Header */}
                    <button
                      onClick={() => toggleGroup(group.id)}
                      className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {group.isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}

                        <div className="text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-white text-sm">{group.title}</h3>
                            {group.actionItem && (
                              <span className={cn(
                                'px-2 py-0.5 rounded text-[10px] font-medium border',
                                getPriorityColor(group.priority)
                              )}>
                                {group.priority || 'medium'}
                              </span>
                            )}
                            {group.id === 'ungrouped' && (
                              <span className="px-2 py-0.5 bg-gray-700 text-gray-300 rounded text-[10px]">
                                Standalone
                              </span>
                            )}
                          </div>
                          {group.subtitle && (
                            <p className="text-xs text-gray-500 mt-0.5">{group.subtitle}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Progress indicator */}
                        <div className="hidden sm:flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-gray-500">
                            {completedInGroup}/{group.tasks.length}
                          </span>
                        </div>

                        {/* Average Score */}
                        {group.avgScore !== undefined && group.avgScore > 0 && (
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 rounded">
                            <Zap className="w-3 h-3 text-purple-400" />
                            <span className="text-xs font-medium text-purple-400">
                              {Math.round(group.avgScore)}
                            </span>
                          </div>
                        )}

                        <span className="text-xs text-gray-500">
                          {group.tasks.length} task{group.tasks.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </button>

                    {/* Tasks List */}
                    {group.isExpanded && (
                      <div className="border-t border-gray-800 p-3 space-y-2 bg-[#0d1117]/50">
                        {group.tasks.map((task, index) => (
                          <div
                            key={task.id}
                            className={cn(
                              'p-3 rounded-lg border transition-colors cursor-pointer',
                              'border-gray-800 hover:border-gray-700',
                              task.isCompleted && 'opacity-50'
                            )}
                            onClick={() => onTaskSelect?.(task)}
                          >
                            <div className="flex items-start gap-3">
                              {/* Task Order Badge */}
                              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-800 flex items-center justify-center">
                                <span className="text-[10px] font-medium text-gray-400">
                                  {task.taskOrder ?? index + 1}
                                </span>
                              </div>

                              {/* Checkbox */}
                              <Checkbox.Root
                                checked={task.isCompleted}
                                onClick={(e) => handleToggleComplete(task, e)}
                                className={cn(
                                  'mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                                  'border-gray-600',
                                  task.isCompleted && 'bg-green-500 border-green-500'
                                )}
                              >
                                <Checkbox.Indicator>
                                  <CheckCircle2 className="w-3 h-3 text-white" />
                                </Checkbox.Indicator>
                              </Checkbox.Root>

                              {/* Task Content */}
                              <div className="flex-1 min-w-0">
                                <h4 className={cn(
                                  'text-sm font-medium text-white',
                                  task.isCompleted && 'line-through opacity-60'
                                )}>
                                  {task.title}
                                </h4>

                                {/* Meta info */}
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <Tooltip.Root>
                                    <Tooltip.Trigger asChild>
                                      <span className="flex items-center gap-0.5">
                                        {getEnergyIcon(task.energyRequired)}
                                      </span>
                                    </Tooltip.Trigger>
                                    <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white capitalize">
                                      {task.energyRequired || 'medium'} energy
                                    </Tooltip.Content>
                                  </Tooltip.Root>

                                  <span className="flex items-center gap-0.5 text-gray-400 text-[10px]">
                                    <Clock className="w-3 h-3" />
                                    {task.estimatedTime ? `${task.estimatedTime}m` : '?m'}
                                  </span>

                                  {task.dependsOnTaskIds && task.dependsOnTaskIds.length > 0 && (
                                    <Tooltip.Root>
                                      <Tooltip.Trigger asChild>
                                        <span className="flex items-center gap-0.5 text-yellow-400 text-[10px]">
                                          <Link2 className="w-3 h-3" />
                                          {task.dependsOnTaskIds.length}
                                        </span>
                                      </Tooltip.Trigger>
                                      <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white">
                                        Depends on {task.dependsOnTaskIds.length} task(s)
                                      </Tooltip.Content>
                                    </Tooltip.Root>
                                  )}

                                  {task.tags && task.tags.length > 0 && (
                                    <div className="flex items-center gap-1">
                                      <Tag className="w-3 h-3 text-gray-500" />
                                      {task.tags.slice(0, 2).map(tag => (
                                        <span
                                          key={tag}
                                          className="text-[10px] px-1.5 rounded bg-gray-800 text-gray-400"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                      {task.tags.length > 2 && (
                                        <span className="text-[10px] text-gray-500">
                                          +{task.tags.length - 2}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Score Badge */}
                              {task.score !== undefined && task.score > 0 && (
                                <div className={cn(
                                  'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
                                  task.score >= 70 ? 'bg-green-500/20 text-green-400' :
                                  task.score >= 40 ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-red-500/20 text-red-400'
                                )}>
                                  <span className="text-xs font-bold">{Math.round(task.score)}</span>
                                </div>
                              )}

                              {/* Complete Button */}
                              {!task.isCompleted && (
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <button
                                      onClick={(e) => handleToggleComplete(task, e)}
                                      className="flex-shrink-0 p-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    </button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content className="px-2 py-1 rounded text-xs bg-gray-700 text-white">
                                    Complete task
                                  </Tooltip.Content>
                                </Tooltip.Root>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500 flex-shrink-0">
          {groupedTasks.length} group{groupedTasks.length !== 1 ? 's' : ''} &bull; {totalTasks} task{totalTasks !== 1 ? 's' : ''}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default GroupedTasksView;
