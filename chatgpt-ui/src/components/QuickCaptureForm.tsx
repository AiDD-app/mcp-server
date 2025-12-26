/**
 * Quick Capture Form Component
 *
 * Fast task/note capture with minimal friction.
 * ADHD-optimized: single field entry with smart defaults.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTasks, useOpenAI } from '../hooks/useOpenAI';
import type { Task } from '../types/openai';
import { cn } from '../utils/cn';
import {
  Plus,
  Zap,
  Clock,
  Battery,
  BatteryLow,
  BatteryMedium,
  Tag,
  Calendar,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import * as Dialog from '@radix-ui/react-dialog';

interface QuickCaptureFormProps {
  onTaskCreated?: (task: Task) => void;
  defaultExpanded?: boolean;
}

type EnergyLevel = 'low' | 'medium' | 'high';

const ENERGY_LEVELS: { value: EnergyLevel; label: string; icon: typeof Battery }[] = [
  { value: 'low', label: 'Low', icon: BatteryLow },
  { value: 'medium', label: 'Medium', icon: BatteryMedium },
  { value: 'high', label: 'High', icon: Battery },
];

const TIME_ESTIMATES = [5, 10, 15, 30, 45, 60, 90, 120];

export function QuickCaptureForm({
  onTaskCreated,
  defaultExpanded = false,
}: QuickCaptureFormProps) {
  const { theme, sendMessage } = useOpenAI();
  const { createTask, loading } = useTasks();

  const [title, setTitle] = useState('');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [energyRequired, setEnergyRequired] = useState<EnergyLevel>('medium');
  const [estimatedTime, setEstimatedTime] = useState(15);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const isDark = theme === 'dark';

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || loading) return;

    try {
      const task = await createTask({
        title: title.trim(),
        energyRequired,
        estimatedTime,
        tags: tags.length > 0 ? tags : undefined,
      });

      onTaskCreated?.(task);

      // Reset form
      setTitle('');
      setTags([]);
      setTagInput('');
      if (!defaultExpanded) {
        setExpanded(false);
      }

      // Send follow-up message to ChatGPT
      sendMessage(`Created task: "${task.title}"`);
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (tagInput) {
        e.preventDefault();
        addTag();
      } else if (title.trim()) {
        handleSubmit(e);
      }
    }
  };

  // Smart defaults based on title keywords
  useEffect(() => {
    const lower = title.toLowerCase();
    if (lower.includes('quick') || lower.includes('fast') || lower.includes('simple')) {
      setEnergyRequired('low');
    } else if (lower.includes('focus') || lower.includes('deep') || lower.includes('complex')) {
      setEnergyRequired('high');
    } else if (lower.includes('meet') || lower.includes('call') || lower.includes('discuss')) {
      setEnergyRequired('medium');
    } else if (lower.includes('design') || lower.includes('create') || lower.includes('write')) {
      setEnergyRequired('high');
    }
  }, [title]);

  return (
    <div
      className={cn(
        'rounded-xl border shadow-sm overflow-hidden transition-all',
        isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      )}
    >
      {/* Collapsed State */}
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className={cn(
            'w-full p-4 flex items-center gap-3 text-left transition-colors',
            isDark ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
          )}
        >
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center',
              'bg-purple-600 text-white'
            )}
          >
            <Plus className="w-5 h-5" />
          </div>
          <span className={cn('font-medium', isDark ? 'text-gray-300' : 'text-gray-600')}>
            Quick capture a task...
          </span>
        </button>
      ) : (
        <form onSubmit={handleSubmit}>
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
                Quick Capture
              </h2>
            </div>
            {!defaultExpanded && (
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className={cn(
                  'p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700',
                  isDark ? 'text-gray-400' : 'text-gray-500'
                )}
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Main Input */}
          <div className="p-4">
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What do you need to do?"
              className={cn(
                'w-full px-4 py-3 rounded-lg border text-lg font-medium',
                'focus:outline-none focus:ring-2 focus:ring-purple-500',
                isDark
                  ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
              )}
            />
          </div>

          {/* Options Grid */}
          <div
            className={cn(
              'px-4 pb-4 grid grid-cols-2 gap-3',
              isDark ? 'text-gray-300' : 'text-gray-700'
            )}
          >
            {/* Energy */}
            <div>
              <label className="block text-xs font-medium mb-1">Energy</label>
              <Select.Root value={energyRequired} onValueChange={(v) => setEnergyRequired(v as EnergyLevel)}>
                <Select.Trigger
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-sm flex items-center justify-between',
                    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                  )}
                >
                  <Select.Value>
                    {ENERGY_LEVELS.find(e => e.value === energyRequired)?.label}
                  </Select.Value>
                  <Select.Icon>
                    <ChevronDown className="w-4 h-4" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content
                    className={cn(
                      'rounded-lg border shadow-lg overflow-hidden z-50',
                      isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                    )}
                  >
                    <Select.Viewport>
                      {ENERGY_LEVELS.map((level) => {
                        const Icon = level.icon;
                        return (
                          <Select.Item
                            key={level.value}
                            value={level.value}
                            className={cn(
                              'px-3 py-2 text-sm cursor-pointer outline-none flex items-center gap-2',
                              isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                            )}
                          >
                            <Icon className="w-4 h-4" />
                            <Select.ItemText>{level.label}</Select.ItemText>
                          </Select.Item>
                        );
                      })}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>

            {/* Time */}
            <div>
              <label className="block text-xs font-medium mb-1">Time (min)</label>
              <Select.Root value={String(estimatedTime)} onValueChange={(v) => setEstimatedTime(Number(v))}>
                <Select.Trigger
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-sm flex items-center justify-between',
                    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                  )}
                >
                  <Select.Value>
                    <Clock className="w-3 h-3 inline mr-1" />
                    {estimatedTime}m
                  </Select.Value>
                  <Select.Icon>
                    <ChevronDown className="w-4 h-4" />
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content
                    className={cn(
                      'rounded-lg border shadow-lg overflow-hidden z-50',
                      isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                    )}
                  >
                    <Select.Viewport>
                      {TIME_ESTIMATES.map((time) => (
                        <Select.Item
                          key={time}
                          value={String(time)}
                          className={cn(
                            'px-3 py-2 text-sm cursor-pointer outline-none',
                            isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          )}
                        >
                          <Select.ItemText>{time} minutes</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>
          </div>

          {/* Tags */}
          <div className={cn('px-4 pb-4', isDark ? 'text-gray-300' : 'text-gray-700')}>
            <label className="block text-xs font-medium mb-1">Tags</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-xs',
                    isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'
                  )}
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="hover:text-red-500"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add tag..."
                className={cn(
                  'px-2 py-1 text-xs rounded border bg-transparent min-w-20',
                  isDark ? 'border-gray-700' : 'border-gray-200'
                )}
              />
            </div>
          </div>

          {/* Submit Button */}
          <div
            className={cn(
              'px-4 py-3 border-t',
              isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
            )}
          >
            <button
              type="submit"
              disabled={!title.trim() || loading}
              className={cn(
                'w-full py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors',
                'bg-purple-600 text-white hover:bg-purple-700',
                (!title.trim() || loading) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {loading ? (
                <>
                  <Sparkles className="w-4 h-4 animate-pulse" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Create Task
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default QuickCaptureForm;
