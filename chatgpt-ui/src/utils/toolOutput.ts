import type { ActionItem, AIJob, Task } from '../types/openai';

type UnknownRecord = Record<string, unknown>;

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const tryParseContentText = (value: unknown): unknown => {
  if (!Array.isArray(value)) return null;

  const textParts: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const text = (entry as UnknownRecord).text;
    if (typeof text !== 'string') continue;

    const parsed = tryParseJson(text);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    textParts.push(text);
  }

  if (textParts.length === 0) return null;
  const combined = textParts.join('\n');
  const parsedCombined = tryParseJson(combined);
  if (parsedCombined && typeof parsedCombined === 'object') {
    return parsedCombined;
  }

  return null;
};

export const unwrapStructuredContent = <T>(value: unknown): T | null => {
  if (value == null) return null;

  if (typeof value === 'string') {
    const parsed = tryParseJson(value);
    if (parsed && typeof parsed === 'object') {
      return parsed as T;
    }
    return null;
  }

  if (typeof value !== 'object') return null;

  const record = value as UnknownRecord;
  const parsedFromContent = tryParseContentText(record.content ?? record.contents);
  if (parsedFromContent && typeof parsedFromContent === 'object') {
    return parsedFromContent as T;
  }
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return record.structuredContent as T;
  }
  if (record.structured_content && typeof record.structured_content === 'object') {
    return record.structured_content as T;
  }

  if (record.result !== undefined) {
    const result = record.result;
    if (typeof result === 'string') {
      const parsed = tryParseJson(result);
      if (parsed && typeof parsed === 'object') {
        return parsed as T;
      }
      return null;
    }
    if (typeof result === 'object' && result !== null) {
      const resultRecord = result as UnknownRecord;
      const parsedFromResultContent = tryParseContentText(resultRecord.content ?? resultRecord.contents);
      if (parsedFromResultContent && typeof parsedFromResultContent === 'object') {
        return parsedFromResultContent as T;
      }
      if (resultRecord.structuredContent && typeof resultRecord.structuredContent === 'object') {
        return resultRecord.structuredContent as T;
      }
      if (resultRecord.structured_content && typeof resultRecord.structured_content === 'object') {
        return resultRecord.structured_content as T;
      }
      return resultRecord as T;
    }
  }

  return record as T;
};

const normalizeEnergyRequired = (value: unknown): Task['energyRequired'] | undefined => {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'low' || trimmed === 'medium' || trimmed === 'high') {
      return trimmed as Task['energyRequired'];
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
      return normalizeEnergyRequired(numeric);
    }
    return value as Task['energyRequired'];
  }
  if (typeof value === 'number') {
    if (value <= 2) return 'low';
    if (value === 3) return 'medium';
    if (value >= 4) return 'high';
  }
  return value as Task['energyRequired'];
};

export const normalizeTasks = (tasks: Task[]): Task[] => {
  return tasks.map((task) => {
    const normalizedEnergy = normalizeEnergyRequired(task.energyRequired);
    if (normalizedEnergy === task.energyRequired) {
      return task;
    }
    return { ...task, energyRequired: normalizedEnergy };
  });
};

export const getTasksFromToolOutput = (value: unknown): Task[] | null => {
  const structured = unwrapStructuredContent<unknown>(value);
  if (!structured) return null;
  if (Array.isArray(structured)) {
    return normalizeTasks(structured as Task[]);
  }
  if (typeof structured !== 'object') return null;

  const record = structured as Record<string, unknown>;
  if (Array.isArray(record.tasks)) {
    return normalizeTasks(record.tasks as Task[]);
  }
  const data = record.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.tasks)) {
    return normalizeTasks(data.tasks as Task[]);
  }
  return null;
};

export const getActionItemsFromToolOutput = (value: unknown): ActionItem[] | null => {
  const structured = unwrapStructuredContent<unknown>(value);
  if (!structured) return null;
  if (Array.isArray(structured)) {
    return structured as ActionItem[];
  }
  if (typeof structured !== 'object') return null;

  const record = structured as Record<string, unknown>;
  if (Array.isArray(record.actionItems)) {
    return record.actionItems as ActionItem[];
  }
  const data = record.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.actionItems)) {
    return data.actionItems as ActionItem[];
  }
  return null;
};

export const getJobsFromToolOutput = (value: unknown): AIJob[] | null => {
  const structured = unwrapStructuredContent<unknown>(value);
  if (!structured) return null;
  if (Array.isArray(structured)) {
    return structured as AIJob[];
  }
  if (typeof structured !== 'object') return null;

  const record = structured as Record<string, unknown>;
  if (Array.isArray(record.jobs)) {
    return record.jobs as AIJob[];
  }
  const data = record.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.jobs)) {
    return data.jobs as AIJob[];
  }
  return null;
};
