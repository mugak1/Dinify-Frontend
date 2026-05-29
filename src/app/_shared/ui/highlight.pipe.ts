import { Pipe, PipeTransform } from '@angular/core';

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Splits `text` into consecutive segments, flagging every case-insensitive
 * occurrence of `query` so the template can wrap matches in <mark>. Original
 * casing is preserved in the output (segments are sliced from the source, not
 * the lowercased copy). The query is trimmed — same rule as searchMenuItems, so
 * ranking and highlighting always agree. Returns a single non-match segment when
 * the query is blank, so callers can pipe unconditionally (a no-op outside an
 * active search). Pure → no cost for stable inputs.
 */
@Pipe({ name: 'highlight', standalone: true, pure: true })
export class HighlightPipe implements PipeTransform {
  transform(
    text: string | null | undefined,
    query: string | null | undefined,
  ): HighlightSegment[] {
    const source = text ?? '';
    const q = (query ?? '').trim();
    if (!q || !source) return source ? [{ text: source, match: false }] : [];

    const lowerSource = source.toLowerCase();
    const lowerQuery = q.toLowerCase();
    const segments: HighlightSegment[] = [];
    let from = 0;
    let idx = lowerSource.indexOf(lowerQuery, from);
    while (idx !== -1) {
      if (idx > from) segments.push({ text: source.slice(from, idx), match: false });
      segments.push({ text: source.slice(idx, idx + q.length), match: true });
      from = idx + q.length;
      idx = lowerSource.indexOf(lowerQuery, from);
    }
    if (from < source.length) segments.push({ text: source.slice(from), match: false });
    return segments;
  }
}
