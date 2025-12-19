/**
 * Action Item Extraction Preview Component
 *
 * Shows AI-extracted action items from notes/emails with confidence scores,
 * selection for conversion to tasks, and real-time extraction progress.
 */

import React, { useState, useCallback } from 'react';
import { useActionItems, useAIJobs, useOpenAI } from '../hooks/useOpenAI';
import type { ActionItem, ExtractionResult } from '../types/openai';
import { cn } from '../utils/cn';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  Circle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Flag,
  Calendar,
  Tag,
  ChevronDown,
  ChevronUp,
  Zap,
  Mail,
  StickyNote,
} from 'lucide-react';
import * as Progress from '@radix-ui/react-progress';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Tooltip from '@radix-ui/react-tooltip';

interface ActionItemExtractionPreviewProps {
  extractionResults?: ExtractionResult[];
  onConvertToTasks?: (actionItemIds: string[]) => void;
  onDismiss?: (actionItemId: string) => void;
}

export function ActionItemExtractionPreview({
  extractionResults = [],
  onConvertToTasks,
  onDismiss,
}: ActionItemExtractionPreviewProps) {
  const { theme, callTool, toolOutput } = useOpenAI();
  const { actionItems: fetchedActionItems, loading, fetchActionItems, convertToTasks } = useActionItems();
  const { jobs, fetchJobs } = useAIJobs();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [isConverting, setIsConverting] = useState(false);

  const isDark = theme === 'dark';

  // Use pre-populated toolOutput.actionItems if available (from tool call that triggered this widget)
  // Otherwise fall back to fetched action items
  const preloadedItems = (toolOutput as { actionItems?: ActionItem[] })?.actionItems;
  const actionItems = preloadedItems || fetchedActionItems;

  // Get extraction jobs in progress
  const extractionJobs = jobs.filter(
    (j) => j.type === 'extract_action_items' && j.status === 'processing'
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    const allIds = actionItems
      .filter((item) => !item.isCompleted)
      .map((item) => item.id);
    setSelectedIds(new Set(allIds));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const toggleNoteExpanded = (noteId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }
      return next;
    });
  };

  const handleConvert = async () => {
    if (selectedIds.size === 0) return;
    setIsConverting(true);
    try {
      await convertToTasks(Array.from(selectedIds));
      setSelectedIds(new Set());
      onConvertToTasks?.(Array.from(selectedIds));
    } finally {
      setIsConverting(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'text-red-500 bg-red-100 dark:bg-red-900/30';
      case 'high':
        return 'text-orange-500 bg-orange-100 dark:bg-orange-900/30';
      case 'medium':
        return 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30';
      case 'low':
        return 'text-green-500 bg-green-100 dark:bg-green-900/30';
      default:
        return 'text-gray-500 bg-gray-100 dark:bg-gray-700';
    }
  };

  const getSourceIcon = (source: string) => {
    if (source.toLowerCase().includes('email') || source.toLowerCase().includes('gmail') || source.toLowerCase().includes('outlook')) {
      return <Mail className="w-4 h-4" />;
    }
    return <StickyNote className="w-4 h-4" />;
  };

  const getConfidenceColor = (confidence?: number) => {
    if (!confidence) return 'text-gray-400';
    if (confidence >= 0.8) return 'text-green-500';
    if (confidence >= 0.5) return 'text-yellow-500';
    return 'text-red-500';
  };

  // Group action items by source note
  const groupedItems = actionItems.reduce((acc, item) => {
    const key = item.sourceNoteId || 'unknown';
    if (!acc[key]) {
      acc[key] = {
        noteTitle: item.source || 'Unknown Source',
        items: [],
      };
    }
    acc[key].items.push(item);
    return acc;
  }, {} as Record<string, { noteTitle: string; items: ActionItem[] }>);

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
            <FileText className="w-5 h-5 text-blue-500" />
            <h2 className={cn('font-semibold', isDark ? 'text-white' : 'text-gray-900')}>
              Extracted Action Items
            </h2>
            {actionItems.length > 0 && (
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
                )}
              >
                {actionItems.filter((i) => !i.isCompleted).length} pending
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleConvert}
                disabled={isConverting}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  'bg-green-600 text-white hover:bg-green-700',
                  isConverting && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isConverting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Convert {selectedIds.size} to Tasks
              </button>
            )}
          </div>
        </div>

        {/* Extraction Progress */}
        {extractionJobs.length > 0 && (
          <div
            className={cn(
              'px-4 py-3 border-b',
              isDark ? 'border-gray-700 bg-purple-900/20' : 'border-gray-200 bg-purple-50'
            )}
          >
            {extractionJobs.map((job) => (
              <div key={job.id} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-500 animate-pulse" />
                    <span className={isDark ? 'text-purple-300' : 'text-purple-700'}>
                      {job.progressMessage || 'Extracting action items...'}
                    </span>
                  </div>
                  <span className={isDark ? 'text-purple-400' : 'text-purple-600'}>
                    {Math.round(job.progress * 100)}%
                  </span>
                </div>
                <Progress.Root
                  value={job.progress * 100}
                  max={100}
                  className={cn(
                    'h-2 rounded-full overflow-hidden',
                    isDark ? 'bg-gray-700' : 'bg-purple-200'
                  )}
                >
                  <Progress.Indicator
                    className="h-full bg-purple-500 transition-all"
                    style={{ width: `${job.progress * 100}%` }}
                  />
                </Progress.Root>
              </div>
            ))}
          </div>
        )}

        {/* Selection controls */}
        {actionItems.length > 0 && (
          <div
            className={cn(
              'px-4 py-2 border-b flex items-center gap-4 text-sm',
              isDark ? 'border-gray-700' : 'border-gray-200'
            )}
          >
            <button
              onClick={selectAll}
              className={cn(
                'hover:underline',
                isDark ? 'text-blue-400' : 'text-blue-600'
              )}
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className={cn(
                'hover:underline',
                isDark ? 'text-gray-400' : 'text-gray-500'
              )}
            >
              Deselect All
            </button>
            <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>|</span>
            <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>
              {selectedIds.size} selected
            </span>
          </div>
        )}

        {/* Content */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : actionItems.length === 0 ? (
            <div
              className={cn(
                'text-center py-8',
                isDark ? 'text-gray-400' : 'text-gray-500'
              )}
            >
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No action items extracted yet</p>
              <p className="text-sm mt-1">
                AI will extract action items from your notes and emails
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedItems).map(([noteId, group]) => (
                <div
                  key={noteId}
                  className={cn(
                    'rounded-lg border overflow-hidden',
                    isDark ? 'border-gray-700' : 'border-gray-200'
                  )}
                >
                  {/* Note Header */}
                  <button
                    onClick={() => toggleNoteExpanded(noteId)}
                    className={cn(
                      'w-full px-3 py-2 flex items-center justify-between text-sm',
                      isDark
                        ? 'bg-gray-800 hover:bg-gray-750'
                        : 'bg-gray-100 hover:bg-gray-200'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {getSourceIcon(group.noteTitle)}
                      <span
                        className={cn(
                          'font-medium truncate max-w-xs',
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        )}
                      >
                        {group.noteTitle}
                      </span>
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                        )}
                      >
                        {group.items.length}
                      </span>
                    </div>
                    {expandedNotes.has(noteId) ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {/* Action Items */}
                  {expandedNotes.has(noteId) && (
                    <div className="divide-y divide-gray-200 dark:divide-gray-700">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            'p-3 flex items-start gap-3',
                            isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50',
                            item.isCompleted && 'opacity-50'
                          )}
                        >
                          <Checkbox.Root
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleSelect(item.id)}
                            disabled={item.isCompleted}
                            className={cn(
                              'mt-0.5 w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                              isDark ? 'border-gray-600' : 'border-gray-300',
                              selectedIds.has(item.id) && 'bg-blue-500 border-blue-500'
                            )}
                          >
                            <Checkbox.Indicator>
                              <CheckCircle2 className="w-4 h-4 text-white" />
                            </Checkbox.Indicator>
                          </Checkbox.Root>

                          <div className="flex-1 min-w-0">
                            <p
                              className={cn(
                                'font-medium',
                                isDark ? 'text-white' : 'text-gray-900',
                                item.isCompleted && 'line-through'
                              )}
                            >
                              {item.title}
                            </p>

                            {item.description && (
                              <p
                                className={cn(
                                  'text-sm mt-1 line-clamp-2',
                                  isDark ? 'text-gray-400' : 'text-gray-500'
                                )}
                              >
                                {item.description}
                              </p>
                            )}

                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {/* Priority */}
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
                                  getPriorityColor(item.priority)
                                )}
                              >
                                <Flag className="w-3 h-3" />
                                {item.priority}
                              </span>

                              {/* Due Date */}
                              {item.dueDate && (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 text-xs',
                                    isDark ? 'text-gray-400' : 'text-gray-500'
                                  )}
                                >
                                  <Calendar className="w-3 h-3" />
                                  {new Date(item.dueDate).toLocaleDateString()}
                                </span>
                              )}

                              {/* Confidence */}
                              {item.confidence !== undefined && (
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <span
                                      className={cn(
                                        'text-xs',
                                        getConfidenceColor(item.confidence)
                                      )}
                                    >
                                      {Math.round(item.confidence * 100)}% conf
                                    </span>
                                  </Tooltip.Trigger>
                                  <Tooltip.Content
                                    className={cn(
                                      'px-2 py-1 rounded text-xs',
                                      isDark ? 'bg-gray-700 text-white' : 'bg-gray-900 text-white'
                                    )}
                                  >
                                    AI confidence score
                                  </Tooltip.Content>
                                </Tooltip.Root>
                              )}

                              {/* Tags */}
                              {item.tags && item.tags.length > 0 && (
                                <div className="flex items-center gap-1">
                                  <Tag className="w-3 h-3 text-gray-400" />
                                  {item.tags.slice(0, 2).map((tag) => (
                                    <span
                                      key={tag}
                                      className={cn(
                                        'text-xs px-1.5 rounded',
                                        isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'
                                      )}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                  {item.tags.length > 2 && (
                                    <span className="text-xs text-gray-400">
                                      +{item.tags.length - 2}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

export default ActionItemExtractionPreview;
