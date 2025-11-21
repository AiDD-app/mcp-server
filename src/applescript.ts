import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Execute an AppleScript command and return the result
 */
export async function execAppleScript(script: string): Promise<string> {
  try {
    // Escape the script properly for command line
    const escapedScript = script
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "'\\''");

    // Execute the AppleScript
    const { stdout, stderr } = await execAsync(
      `osascript -e '${escapedScript}'`
    );

    if (stderr) {
      console.error('AppleScript warning:', stderr);
    }

    return stdout.trim();
  } catch (error: any) {
    console.error('AppleScript error:', error);
    throw new Error(`AppleScript execution failed: ${error.message}`);
  }
}

/**
 * Execute an AppleScript from a file
 */
export async function execAppleScriptFile(filePath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`osascript ${filePath}`);

    if (stderr) {
      console.error('AppleScript warning:', stderr);
    }

    return stdout.trim();
  } catch (error: any) {
    console.error('AppleScript error:', error);
    throw new Error(`AppleScript file execution failed: ${error.message}`);
  }
}

/**
 * Check if Apple Notes is available on the system
 */
export async function isAppleNotesAvailable(): Promise<boolean> {
  try {
    const script = `
      tell application "System Events"
        return exists application process "Notes"
      end tell
    `;
    await execAppleScript(script);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open Apple Notes application
 */
export async function openAppleNotes(): Promise<void> {
  const script = `
    tell application "Notes"
      activate
    end tell
  `;
  await execAppleScript(script);
}

/**
 * Helper to format dates for AppleScript
 */
export function formatDateForAppleScript(date: Date): string {
  return `date "${date.toLocaleDateString()} ${date.toLocaleTimeString()}"`;
}

/**
 * Helper to parse AppleScript lists into JavaScript arrays
 */
export function parseAppleScriptList(listString: string): string[] {
  // AppleScript returns lists as comma-separated values
  if (!listString || listString === '{}') return [];

  // Remove curly braces and split by comma
  const cleaned = listString.replace(/^{|}$/g, '');

  // Split by comma but respect nested structures
  const items: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of cleaned) {
    if (char === '{') depth++;
    else if (char === '}') depth--;
    else if (char === ',' && depth === 0) {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current) {
    items.push(current.trim());
  }

  return items;
}

/**
 * Helper to parse AppleScript records into JavaScript objects
 */
export function parseAppleScriptRecord(recordString: string): Record<string, any> {
  if (!recordString || recordString === '{}') return {};

  try {
    // Try to parse as JSON first (if we formatted it that way)
    return JSON.parse(recordString);
  } catch {
    // Fall back to manual parsing
    const result: Record<string, any> = {};
    const cleaned = recordString.replace(/^{|}$/g, '');

    // Simple parsing for key:value pairs
    const pairs = cleaned.split(',').map(p => p.trim());
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split(':');
      if (key && valueParts.length > 0) {
        result[key.trim()] = valueParts.join(':').trim();
      }
    }

    return result;
  }
}

/**
 * Escape text for safe insertion into AppleScript
 */
export function escapeForAppleScript(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}