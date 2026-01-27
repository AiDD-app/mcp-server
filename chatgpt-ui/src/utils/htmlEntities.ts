/**
 * HTML Entity Decoding Utilities
 * FIX v3.3.5: LLMs often produce HTML-encoded text that needs decoding for display
 */

/**
 * Decode HTML entities and normalize line breaks in text
 * Handles: &amp; &lt; &gt; &quot; &apos; &nbsp; &#xHEX; &#DECIMAL;
 * Also converts: <br> tags to newlines, literal \n strings to newlines, • to newline+bullet
 * @param text Text potentially containing HTML entities
 * @returns Text with HTML entities decoded and line breaks normalized
 */
export function decodeHTMLEntities(text: string | null | undefined): string {
  if (!text) return '';

  return text
    // Convert <br> tags to newlines (handle all variations)
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert literal \n strings to actual newlines (when escaped in JSON)
    .replace(/\\n/g, '\n')
    // Convert bullet points to newline + bullet (for better formatting)
    .replace(/•\s*/g, '\n• ')
    // Named entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Numeric entities (hex): &#x2F; -> /
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Numeric entities (decimal): &#39; -> '
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    // Clean up multiple consecutive newlines (max 2)
    .replace(/\n{3,}/g, '\n\n')
    // Trim leading newline if present
    .replace(/^\n+/, '');
}

/**
 * Decode HTML entities in an array of strings
 * @param arr Array of strings potentially containing HTML entities
 * @returns Array with HTML entities decoded
 */
export function decodeHTMLEntitiesArray(arr: string[] | null | undefined): string[] {
  if (!arr || !Array.isArray(arr)) return [];
  return arr.map(decodeHTMLEntities);
}
