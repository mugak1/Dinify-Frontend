import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogComponent } from '../../../../_shared/ui/dialog/dialog.component';
import { ButtonComponent } from '../../../../_shared/ui/button/button.component';
import { BadgeComponent } from '../../../../_shared/ui/badge/badge.component';
import { ToastService } from '../../../../_shared/ui/toast/toast.service';
import { RestaurantTable, DiningArea } from '../../models/tables.models';
import { getTableQRUrl } from '../../utils/qr-print-sheet';
import QRCode from 'qrcode';

@Component({
  selector: 'app-qr-code-preview-modal',
  standalone: true,
  imports: [CommonModule, DialogComponent, ButtonComponent, BadgeComponent],
  templateUrl: './qr-code-preview-modal.component.html',
})
export class QrCodePreviewModalComponent implements OnChanges {
  @Input() open = false;
  @Input() table: RestaurantTable | null = null;
  @Input() area?: DiningArea;
  @Output() closed = new EventEmitter<void>();
  @Output() regenerated = new EventEmitter<void>();

  @ViewChild('qrContainer') qrContainer!: ElementRef<HTMLDivElement>;

  qrSvgHtml = '';
  qrUrl = '';

  constructor(private toast: ToastService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['open'] || changes['table']) && this.open && this.table) {
      this.qrUrl = getTableQRUrl(this.table);
      this.generateQRSvg();
    }
  }

  private async generateQRSvg(): Promise<void> {
    try {
      this.qrSvgHtml = await QRCode.toString(this.qrUrl, {
        type: 'svg',
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'H',
        color: { dark: '#000000', light: '#ffffff' },
      });
    } catch {
      this.qrSvgHtml = '<p class="text-destructive text-sm">Failed to generate QR code</p>';
    }
  }

  async handleDownloadPNG(): Promise<void> {
    if (!this.table) return;
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
    if (!this.table || !this.qrSvgHtml) return;
    const blob = new Blob([this.qrSvgHtml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.download = `table-${this.table.number}-qr.svg`;
    link.href = url;
    link.click();

    URL.revokeObjectURL(url);
    this.toast.success('QR code downloaded as SVG');
  }

  handlePrint(): void {
    if (!this.table) return;
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
          ${this.qrSvgHtml}
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
    try {
      await navigator.clipboard.writeText(this.qrUrl);
      this.toast.success('Link copied to clipboard');
    } catch {
      this.toast.error('Failed to copy link');
    }
  }

  handleOpenLink(): void {
    window.open(this.qrUrl, '_blank');
  }

  handleRegenerate(): void {
    this.regenerated.emit();
    this.toast.success('QR code regenerated');
    // Re-generate the SVG to reflect any URL changes
    if (this.table) {
      this.qrUrl = getTableQRUrl(this.table);
      this.generateQRSvg();
    }
  }

  onClose(): void {
    this.closed.emit();
  }
}
