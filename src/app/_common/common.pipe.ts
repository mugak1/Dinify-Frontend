import { Pipe, PipeTransform } from "@angular/core";
import { DomSanitizer, SafeHtml, SafeStyle } from "@angular/platform-browser";

@Pipe({
    name: 'safe'
  })
  export class SafePipe implements PipeTransform {
    /**
     * Pipe Constructor
     *
     * @param _sanitizer: DomSanitezer
     */
    // tslint:disable-next-line
    constructor(protected _sanitizer: DomSanitizer) {
    }

    /**
     * Transform
     *
     * @param value: string
     * @param type: string
     */
    transform(value: string, type: string): SafeHtml | SafeStyle {
      switch (type) {
        case 'html':
          return this._sanitizer.bypassSecurityTrustHtml(value);
        case 'style':
          return this._sanitizer.bypassSecurityTrustStyle(value);
        default:
          throw new Error(`SafePipe: unsupported type "${type}". Only "html" and "style" are allowed.`);
      }
    }
  }