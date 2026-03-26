import { Pipe, PipeTransform, SecurityContext } from "@angular/core";
import { DomSanitizer, SafeHtml, SafeStyle } from "@angular/platform-browser";

/**
 * SafePipe — marks values as trusted for Angular's DomSanitizer.
 *
 * SECURITY NOTE:
 * - 'html': Runs through Angular's HTML sanitizer (strips scripts/iframes/
 *    event handlers, preserves safe tags). Does NOT bypass security.
 * - 'style': Bypasses style sanitization for dynamic inline CSS values.
 *    Only use with developer-controlled content.
 */
@Pipe({
    name: 'safe',
    standalone: false
})
export class SafePipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(value: string, type: 'html' | 'style'): SafeHtml | SafeStyle | string {
    switch (type) {
      case 'html':
        return this.sanitizer.sanitize(SecurityContext.HTML, value) || '';
      case 'style':
        return this.sanitizer.bypassSecurityTrustStyle(value);
      default:
        throw new Error(`SafePipe: unsupported type "${type}".`);
    }
  }
}
