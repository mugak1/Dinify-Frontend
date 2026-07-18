import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { RestaurantTable, DiningArea } from '../../models/tables.models';
import { getTableQRUrl } from '../../utils/qr-print-sheet';
import QRCode from 'qrcode';

/**
 * QR preview modal — PRESENTATIONAL. It renders/downloads/prints/copies the
 * current table's QR and asks the parent (via outputs) to activate or securely
 * rotate a QR; it NEVER calls TablesService, mints a credential/timestamp, or
 * reports rotation success itself. The parent owns the mutation, the toast, and
 * the confirmation flow.
 *
 * Fail-closed: when the table has no usable credential, `qrUrl` is null and the
 * modal renders an "unavailable" state instead of ever producing a `?c=` QR.
 */
@Component({
  selector: 'app-qr-code-preview-modal',
  standalone: true,
  imports: [DialogComponent, ButtonComponent, BadgeComponent],
  templateUrl: './qr-code-preview-modal.component.html',
})
export class QrCodePreviewModalComponent implements OnChanges {
  @Input() open = false;
  @Input() table: RestaurantTable | null = null;
  @Input() area?: DiningArea;
  /** True briefly after a successful rotation so the modal can show the
   *  "old QR revoked — reprint now" notice. Owned by the parent. */
  @Input() recentlyRotated = false;
  /** True while the parent's rotation request for THIS table is in flight. */
  @Input() rotating = false;

  @Output() closed = new EventEmitter<void>();
  /** Ask the parent to securely rotate this table's QR credential. */
  @Output() regenerateRequested = new EventEmitter<RestaurantTable>();
  /** Ask the parent to activate a QR for a table that has none yet. */
  @Output() generateRequested = new EventEmitter<RestaurantTable>();

  qrSvgHtml: SafeHtml = '';
  /** The diner URL for the current credential, or null when unavailable
   *  (fail-closed). When null NOTHING renders/copies/downloads/opens/prints. */
  qrUrl: string | null = null;
  private rawSvg = '';
  // Async-render guard: each (re)generation captures a token; a stale
  // QRCode.toString resolution is discarded if a newer render started meanwhile.
  // This matters immediately after rotation, when the credential changes under a
  // still-resolving render — the old QR must never overwrite the new one.
  private renderToken = 0;

  constructor(
    private toast: ToastService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['open'] || changes['table']) && this.open) {
      this.qrUrl = this.table ? getTableQRUrl(this.table) : null;
      if (this.qrUrl) {
        void this.generateQRSvg(this.qrUrl);
      } else {
        // No usable credential — clear any previously rendered QR so a stale
        // image can never linger behind the "unavailable" state, and bump the
        // token so an in-flight render for the old table is discarded.
        this.renderToken++;
        this.rawSvg = '';
        this.qrSvgHtml = '';
      }
    }
  }

  private async generateQRSvg(url: string): Promise<void> {
    const token = ++this.renderToken;
    try {
      const rawSvg = await QRCode.toString(url, {
        type: 'svg',
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' },
      });
      if (token !== this.renderToken) return; // superseded by a newer render
      this.rawSvg = rawSvg;
      this.qrSvgHtml = this.sanitizer.bypassSecurityTrustHtml(rawSvg);
    } catch {
      if (token !== this.renderToken) return;
      this.rawSvg = '';
      this.qrSvgHtml = this.sanitizer.bypassSecurityTrustHtml(
        '<p class="text-destructive text-sm">Failed to generate QR code</p>',
      );
    }
  }

  async handleDownloadPNG(): Promise<void> {
    if (!this.table || !this.qrUrl) return;
    try {
      const dataUrl = await QRCode.toDataURL(this.qrUrl, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' },
      });

      const link = document.createElement('a');
      link.download = `table-${this.table.number}-qr.png`;
      link.href = dataUrl;
      link.click();
      this.toast.success('QR code downloaded as PNG');
    } catch {
      this.toast.error('Failed to generate PNG');
    }
  }

  handleDownloadSVG(): void {
    if (!this.table || !this.qrUrl || !this.rawSvg) return;
    const blob = new Blob([this.rawSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `table-${this.table.number}-qr.svg`;
    link.href = url;
    link.click();

    URL.revokeObjectURL(url);
    this.toast.success('QR code downloaded as SVG');
  }

  handlePrint(): void {
    if (!this.table || !this.qrUrl || !this.rawSvg) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Table ${this.table.number} QR Code</title>
        <style>
          body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            font-family: system-ui, sans-serif;
          }
          .qr-container {
            text-align: center;
            padding: 40px;
            border: 2px solid #e5e5e5;
            border-radius: 16px;
          }
          .table-label {
            font-size: 32px;
            font-weight: bold;
            margin-bottom: 8px;
          }
          .area-label {
            font-size: 16px;
            color: #666;
            margin-bottom: 24px;
          }
          .scan-text {
            margin-top: 24px;
            font-size: 14px;
            color: #888;
          }
          svg { width: 250px; height: 250px; }
        </style>
      </head>
      <body>
        <div class="qr-container">
          <div class="table-label">Table ${this.table.number}</div>
          <div class="area-label">${this.area?.name || 'Main Dining'}</div>
          ${this.rawSvg}
          <div class="scan-text">Scan to view menu & order</div>
        </div>
        <script>
          window.onload = () => { window.print(); window.close(); };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }

  async handleCopyLink(): Promise<void> {
    if (!this.qrUrl) return;
    try {
      await navigator.clipboard.writeText(this.qrUrl);
      this.toast.success('Link copied to clipboard');
    } catch {
      this.toast.error('Failed to copy link');
    }
  }

  handleOpenLink(): void {
    if (!this.qrUrl) return;
    window.open(this.qrUrl, '_blank');
  }

  onRegenerate(): void {
    if (this.table) this.regenerateRequested.emit(this.table);
  }

  onGenerate(): void {
    if (this.table) this.generateRequested.emit(this.table);
  }

  onClose(): void {
    this.closed.emit();
  }
}
