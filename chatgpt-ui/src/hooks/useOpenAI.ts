/**
 * React hooks for ChatGPT Apps SDK integration
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import type { Task, ActionItem, AIJob } from '../types/openai';
import { getActionItemsFromToolOutput, getJobsFromToolOutput, getTasksFromToolOutput, unwrapStructuredContent } from '../utils/toolOutput';

const SET_GLOBALS_EVENT_TYPE = 'openai:set_globals';

function useOpenAiGlobal<K extends keyof Window['openai']>(key: K) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};

      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{ globals?: Partial<Window['openai']> }>).detail;
        if (!detail?.globals || detail.globals[key] === undefined) {
          return;
        }
        onChange();
      };

      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handler, { passive: true });
      return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handler);
    },
    () => (typeof window !== 'undefined' ? window.openai?.[key] ?? null : null),
    () => null
  );
}

function unwrapToolResult<T extends Record<string, unknown>>(value: unknown): T {
  return (unwrapStructuredContent<T>(value) ?? ({} as T));
}

/**
 * Hook to access the ChatGPT Apps SDK
 */
export function useOpenAI() {
  const theme = (useOpenAiGlobal('theme') ?? 'light') as 'light' | 'dark';
  const locale = (useOpenAiGlobal('locale') ?? 'en-US') as string;
  const toolInput = (useOpenAiGlobal('toolInput') ?? {}) as Record<string, unknown>;
  const toolOutput = (useOpenAiGlobal('toolOutput') ?? null) as Record<string, unknown> | null;
  const toolResponseMetadata = (useOpenAiGlobal('toolResponseMetadata') ?? null) as Record<string, unknown> | null;
  const displayMode = (useOpenAiGlobal('displayMode') ?? 'inline') as 'inline' | 'pip' | 'fullscreen';
  const maxHeight = (useOpenAiGlobal('maxHeight') ?? null) as number | null;
  const safeArea = (useOpenAiGlobal('safeArea') ?? null) as { insets: { top: number; bottom: number; left: number; right: number } } | null;
  const userAgent = (useOpenAiGlobal('userAgent') ?? null) as { device: { type: string }; capabilities: { hover: boolean; touch: boolean } } | null;

  const isReady = useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined') return () => {};
      const handler = () => onChange();
      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handler, { passive: true });
      return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handler);
    },
    () => typeof window !== 'undefined' && !!window.openai,
    () => false
  );

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
    if (!window.openai) return;
    try {
      await window.openai.sendFollowUpMessage({ prompt: message });
    } catch (error) {
      await (window.openai.sendFollowUpMessage as unknown as (payload: string) => Promise<void>)(message);
    }
  }, []);

  const getWidgetState = useCallback(<T extends Record<string, unknown>>(): T | null => {
    if (window.openai) {
      return window.openai.widgetState as T;
    }
    return null;
  }, []);

  const setWidgetState = useCallback(async (state: Record<string, unknown>) => {
    if (window.openai) {
      await window.openai.setWidgetState(state);
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
    toolInput,
    toolOutput,
    toolResponseMetadata,
    displayMode,
    maxHeight,
    safeArea,
    userAgent,
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

  const fetchTasks = useCallback(async (
    sortBy = 'score',
    limit = 100,
    filters?: {
      category?: string;
      tags?: string;
      maxTimeMinutes?: number;
      timeBudgetMinutes?: number;
      maxEnergy?: 'low' | 'medium' | 'high';
      onlyAIScored?: boolean;
      dueWithinDays?: number;
      includeCompleted?: boolean;
    }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = { sortBy, limit };
      // Add filter parameters if provided
      if (filters) {
        if (filters.category) params.category = filters.category;
        if (filters.tags) params.tags = filters.tags;
        if (filters.maxTimeMinutes !== undefined) params.maxTimeMinutes = filters.maxTimeMinutes;
        if (filters.timeBudgetMinutes !== undefined) params.timeBudgetMinutes = filters.timeBudgetMinutes;
        if (filters.maxEnergy) params.maxEnergy = filters.maxEnergy;
        if (filters.onlyAIScored) params.onlyAIScored = filters.onlyAIScored;
        if (filters.dueWithinDays !== undefined) params.dueWithinDays = filters.dueWithinDays;
        if (filters.includeCompleted) params.includeCompleted = filters.includeCompleted;
      }
      console.log('[useTasks] Fetching tasks with params:', params);
      const rawResult = await callTool('list_tasks', params);
      console.log('[useTasks] Raw result received:', typeof rawResult, rawResult);
      const resultTasks = getTasksFromToolOutput(rawResult) || [];
      const fallbackTasks = resultTasks.length === 0 ? getTasksFromToolOutput(window.openai?.toolOutput) : null;
      setTasks(resultTasks.length > 0 ? resultTasks : fallbackTasks || []);
    } catch (err: unknown) {
      console.error('[useTasks] Error fetching tasks:', err);
      // Extract detailed error message
      let errorMessage = 'Failed to fetch tasks';
      if (err instanceof Error) {
        errorMessage = err.message;
        // Also log the stack trace for debugging
        console.error('[useTasks] Error stack:', err.stack);
      } else if (typeof err === 'object' && err !== null) {
        // Handle MCP error responses which may have different shapes
        const errObj = err as Record<string, unknown>;
        // Log the full error object for debugging
        console.error('[useTasks] Full error object:', JSON.stringify(errObj, null, 2));
        if (typeof errObj.message === 'string') {
          errorMessage = errObj.message;
        } else if (typeof errObj.error === 'string') {
          errorMessage = errObj.error;
        } else if (errObj.error && typeof errObj.error === 'object') {
          const innerErr = errObj.error as Record<string, unknown>;
          if (typeof innerErr.message === 'string') {
            errorMessage = innerErr.message;
          }
        } else if (typeof errObj.name === 'string' && errObj.name === 'AbortError') {
          errorMessage = 'Request timed out - backend may be slow or unreachable';
        }
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const createTask = useCallback(async (task: Partial<Task>) => {
    setLoading(true);
    try {
      const result = unwrapToolResult<{ task?: Task }>(
        await callTool('create_task', task)
      );
      const createdTask = result.task;
      if (!createdTask) throw new Error('Task creation failed');
      setTasks(prev => [createdTask, ...prev]);
      return createdTask;
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
      const result = unwrapToolResult<{ task?: Task }>(
        await callTool('update_task', { taskId, ...updates })
      );
      const updatedTask = result.task;
      if (!updatedTask) throw new Error('Task update failed');
      setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
      return updatedTask;
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
      const rawResult = await callTool('list_action_items', { limit });
      const resultItems = getActionItemsFromToolOutput(rawResult) || [];
      const fallbackItems = resultItems.length === 0 ? getActionItemsFromToolOutput(window.openai?.toolOutput) : null;
      setActionItems(resultItems.length > 0 ? resultItems : fallbackItems || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch action items');
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const convertToTasks = useCallback(async (actionItemIds: string[]) => {
    setLoading(true);
    try {
      const result = unwrapToolResult<{ jobId?: string }>(
        await callTool('convert_to_tasks', { actionItemIds })
      );
      if (!result.jobId) throw new Error('Conversion job not started');
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
      const rawResult = await callTool('check_ai_jobs', { includeCompleted });
      const resultJobs = getJobsFromToolOutput(rawResult) || [];
      const fallbackJobs = resultJobs.length === 0 ? getJobsFromToolOutput(window.openai?.toolOutput) : null;
      setJobs(resultJobs.length > 0 ? resultJobs : fallbackJobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, [callTool]);

  const scoreTasks = useCallback(async () => {
    try {
      const result = unwrapToolResult<{ jobId?: string }>(
        await callTool('score_tasks', {})
      );
      if (!result.jobId) throw new Error('Scoring job not started');
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
