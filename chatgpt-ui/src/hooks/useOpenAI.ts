/**
 * React hooks for ChatGPT Apps SDK integration
 */

import { useState, useEffect, useCallback } from 'react';
import type { Task, ActionItem, AIJob } from '../types/openai';

/**
 * Hook to access the ChatGPT Apps SDK
 */
export function useOpenAI() {
  const [isReady, setIsReady] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [locale, setLocale] = useState('en-US');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.openai) {
      setIsReady(true);
      setTheme(window.openai.theme);
      setLocale(window.openai.locale);

      // Listen for theme changes
      const handleThemeChange = (...args: unknown[]) => {
        const newTheme = args[0] as 'light' | 'dark';
        if (newTheme === 'light' || newTheme === 'dark') {
          setTheme(newTheme);
        }
      };

      window.openai.on('themeChange', handleThemeChange);
      return () => {
        window.openai.off('themeChange', handleThemeChange);
      };
    }
  }, []);

  const callTool = useCallback(async <T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> => {
    if (!window.openai) {
      throw new Error('OpenAI Apps SDK not available');
    }
    return window.openai.callTool<T>(name, args);
  }, []);

  const requestFullscreen = useCallback(async () => {
    if (window.openai) {
      await window.openai.requestDisplayMode({ mode: 'fullscreen' });
    }
  }, []);

  const requestInline = useCallback(async () => {
    if (window.openai) {
      await window.openai.requestDisplayMode({ mode: 'inline' });
    }
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    if (window.openai) {
      await window.openai.sendFollowUpMessage(message);
    }
  }, []);

  const getWidgetState = useCallback(<T extends Record<string, unknown>>(): T => {
    if (window.openai) {
      return window.openai.widgetState as T;
    }
    return {} as T;
  }, []);

  const setWidgetState = useCallback((state: Record<string, unknown>) => {
    if (window.openai) {
      window.openai.setWidgetState(state);
    }
  }, []);

  return {
    isReady,
    theme,
    locale,
    callTool,
    requestFullscreen,
    requestInline,
    sendMessage,
    getWidgetState,
    setWidgetState,
    toolInput: window.openai?.toolInput || {},
    toolOutput: window.openai?.toolOutput || {},
  };
}

/**
 * Hook for task operations
 */
export function useTasks() {
  const { callTool } = useOpenAI();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async (sortBy = 'score', limit = 100) => {
    setLoading(true);
    setError(null);
    try {
      const result = await callTool<{ tasks: Task[] }>('list_tasks', { sortBy, limit });
      setTasks(result.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const createTask = useCallback(async (task: Partial<Task>) => {
    setLoading(true);
    try {
      const result = await callTool<{ task: Task }>('create_task', task);
      setTasks(prev => [result.task, ...prev]);
      return result.task;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
    setLoading(true);
    try {
      const result = await callTool<{ task: Task }>('update_task', { taskId, ...updates });
      setTasks(prev => prev.map(t => t.id === taskId ? result.task : t));
      return result.task;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const completeTask = useCallback(async (taskId: string) => {
    return updateTask(taskId, { isCompleted: true });
  }, [updateTask]);

  const deleteTasks = useCallback(async (taskIds: string[]) => {
    setLoading(true);
    try {
      await callTool('delete_tasks', { taskIds });
      setTasks(prev => prev.filter(t => !taskIds.includes(t.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete tasks');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    completeTask,
    deleteTasks,
  };
}

/**
 * Hook for action item operations
 */
export function useActionItems() {
  const { callTool } = useOpenAI();
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActionItems = useCallback(async (limit = 100) => {
    setLoading(true);
    setError(null);
    try {
      const result = await callTool<{ actionItems: ActionItem[] }>('list_action_items', { limit });
      setActionItems(result.actionItems || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch action items');
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const convertToTasks = useCallback(async (actionItemIds: string[]) => {
    setLoading(true);
    try {
      const result = await callTool<{ jobId: string }>('convert_to_tasks', { actionItemIds });
      return result.jobId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert action items');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  return {
    actionItems,
    loading,
    error,
    fetchActionItems,
    convertToTasks,
  };
}

/**
 * Hook for AI job status monitoring
 */
export function useAIJobs() {
  const { callTool } = useOpenAI();
  const [jobs, setJobs] = useState<AIJob[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchJobs = useCallback(async (includeCompleted = false) => {
    setLoading(true);
    try {
      const result = await callTool<{ jobs: AIJob[] }>('check_ai_jobs', { includeCompleted });
      setJobs(result.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const scoreTasks = useCallback(async () => {
    try {
      const result = await callTool<{ jobId: string }>('score_tasks', {});
      await fetchJobs();
      return result.jobId;
    } catch (err) {
      console.error('Failed to start scoring:', err);
      throw err;
    }
  }, [callTool, fetchJobs]);

  return {
    jobs,
    loading,
    fetchJobs,
    scoreTasks,
  };
}
