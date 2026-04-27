import { Pipe, PipeTransform } from '@angular/core';

/**
 * Returns the value if it is an array, otherwise returns an empty array.
 * Useful for defending *ngFor / @for against malformed inputs (e.g. corrupted
 * JSONField data from older backend records). Pure, so it has no perf cost
 * for stable inputs.
 */
@Pipe({
  name: 'safeArray',
  standalone: true,
  pure: true,
})
export class SafeArrayPipe implements PipeTransform {
  transform<T>(value: readonly T[] | null | undefined): T[];
  transform(value: any): any[];
  transform(value: any): any[] {
    return Array.isArray(value) ? value : [];
  }
}
