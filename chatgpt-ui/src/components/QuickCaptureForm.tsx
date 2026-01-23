/**
 * Quick Capture Form Component
 *
 * Fast action item capture with minimal friction.
 * ADHD-optimized: single field entry with smart defaults.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useActionItems, useOpenAI } from '../hooks/useOpenAI';
import type { ActionItem } from '../types/openai';
import { cn } from '../utils/cn';
import {
  Plus,
  Flag,
  Tag,
  Calendar,
  Send,
  Sparkles,
  ChevronDown,
  X,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import * as Select from '@radix-ui/react-select';

interface QuickCaptureFormProps {
  onActionItemCreated?: (actionItem: ActionItem) => void;
  defaultExpanded?: boolean;
}

type PriorityLevel = 'low' | 'medium' | 'high' | 'urgent';

const PRIORITY_LEVELS: { value: PriorityLevel; label: string; icon: typeof Flag; color: string }[] = [
  { value: 'low', label: 'Low', icon: Flag, color: 'text-green-500' },
  { value: 'medium', label: 'Medium', icon: Flag, color: 'text-yellow-500' },
  { value: 'high', label: 'High', icon: AlertCircle, color: 'text-orange-500' },
  { value: 'urgent', label: 'Urgent', icon: AlertTriangle, color: 'text-red-500' },
];

const CATEGORIES = [
  { value: 'work', label: 'Work' },
  { value: 'personal', label: 'Personal' },
];

export function QuickCaptureForm({
  onActionItemCreated,
  defaultExpanded = false,
}: QuickCaptureFormProps) {
  const { theme, sendMessage } = useOpenAI();
  const { createActionItem, loading, fetchActionItems } = useActionItems();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [priority, setPriority] = useState<PriorityLevel>('medium');
  const [category, setCategory] = useState<'work' | 'personal'>('work');
  const [dueDate, setDueDate] = useState('');
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
      const actionItem = await createActionItem({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        category,
        dueDate: dueDate || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      onActionItemCreated?.(actionItem);

      // Refresh the action items list
      await fetchActionItems();

      // Reset form
      setTitle('');
      setDescription('');
      setTags([]);
      setTagInput('');
      setDueDate('');
      if (!defaultExpanded) {
        setExpanded(false);
      }

      // Send follow-up message to ChatGPT
      sendMessage(`Created action item: "${actionItem.title}"`);
    } catch (error) {
      console.error('Failed to create action item:', error);
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
    if (lower.includes('urgent') || lower.includes('asap') || lower.includes('immediately')) {
      setPriority('urgent');
    } else if (lower.includes('important') || lower.includes('critical') || lower.includes('must')) {
      setPriority('high');
    } else if (lower.includes('when possible') || lower.includes('eventually') || lower.includes('sometime')) {
      setPriority('low');
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
              'bg-blue-600 text-white'
            )}
          >
            <Plus className="w-5 h-5" />
          </div>
          <span className={cn('font-medium', isDark ? 'text-gray-300' : 'text-gray-600')}>
            Quick capture an action item...
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
              <Sparkles className="w-5 h-5 text-blue-500" />
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
          <div className="p-4 space-y-3">
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What needs to be done?"
              className={cn(
                'w-full px-4 py-3 rounded-lg border text-lg font-medium',
                'focus:outline-none focus:ring-2 focus:ring-blue-500',
                isDark
                  ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
              )}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details (optional)..."
              rows={2}
              className={cn(
                'w-full px-4 py-2 rounded-lg border text-sm',
                'focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none',
                isDark
                  ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500'
                  : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'
              )}
            />
          </div>

          {/* Options Grid */}
          <div
            className={cn(
              'px-4 pb-4 grid grid-cols-3 gap-3',
              isDark ? 'text-gray-300' : 'text-gray-700'
            )}
          >
            {/* Priority */}
            <div>
              <label className="block text-xs font-medium mb-1">Priority</label>
              <Select.Root value={priority} onValueChange={(v) => setPriority(v as PriorityLevel)}>
                <Select.Trigger
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-sm flex items-center justify-between',
                    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                  )}
                >
                  <Select.Value>
                    <span className={cn(PRIORITY_LEVELS.find(p => p.value === priority)?.color)}>
                      {PRIORITY_LEVELS.find(p => p.value === priority)?.label}
                    </span>
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
                      {PRIORITY_LEVELS.map((level) => {
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
                            <Icon className={cn('w-4 h-4', level.color)} />
                            <Select.ItemText>{level.label}</Select.ItemText>
                          </Select.Item>
                        );
                      })}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-medium mb-1">Category</label>
              <Select.Root value={category} onValueChange={(v) => setCategory(v as 'work' | 'personal')}>
                <Select.Trigger
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-sm flex items-center justify-between',
                    isDark ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                  )}
                >
                  <Select.Value>{CATEGORIES.find(c => c.value === category)?.label}</Select.Value>
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
                      {CATEGORIES.map((cat) => (
                        <Select.Item
                          key={cat.value}
                          value={cat.value}
                          className={cn(
                            'px-3 py-2 text-sm cursor-pointer outline-none',
                            isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                          )}
                        >
                          <Select.ItemText>{cat.label}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-xs font-medium mb-1">Due Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={cn(
                    'w-full pl-9 pr-3 py-2 rounded-lg border text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500',
                    isDark ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
                  )}
                />
              </div>
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
                'bg-blue-600 text-white hover:bg-blue-700',
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
                  Create Action Item
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
