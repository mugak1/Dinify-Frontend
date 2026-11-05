import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FloorRound, FloorTable } from '../../models/floor.models';
import {
  CHIP_CLASSES,
  TABLE_TONE_CLASSES,
  FULFILMENT_LABEL,
  ageLabel,
  minutesSince,
  roundChipTone,
  roundStateLabel,
  tableStatusLabel,
  tableTone,
} from '../../utils/floor-presentation';

/** How many rounds a card lists before it says "+N more". */
const ROUNDS_ON_CARD = 3;

/**
 * The floor canvas (Step 2, floor contract v1).
 *
 * A grid of table cards in the floor's own order — tables that need staff first, then
 * the rest — because the contract orders the floor and carries no geometry. Each card
 * shows the table's status, its held and released rounds, how long each held round
 * has waited, and the server's stale flag. Selecting a card opens the drawer, which is
 * where every action lives; the canvas itself acts on nothing.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  selector: 'app-floor-plan-canvas',
  standalone: true,
  templateUrl: './floor-plan-canvas.component.html',
  host: { class: 'block' },
})
export class FloorPlanCanvasComponent {
  /** Already filtered and ordered by the view. */
  @Input() tables: FloorTable[] = [];
  /** True when a search or status filter is hiding tables. */
  @Input() filtered = false;
  @Input() selectedTableId: string | null = null;
  /** "Now" on the SERVER's clock, for round ages. */
  @Input() serverNowMs = 0;
  @Output() tableSelect = new EventEmitter<string>();

  /** "Status unknown" for a stored value outside the five (decision 2). */
  readonly statusLabel = tableStatusLabel;
  readonly fulfilmentLabel = FULFILMENT_LABEL;
  readonly roundsOnCard = ROUNDS_ON_CARD;

  /** Tables that need staff, then the rest — two titled groups, the second alone when none wait. */
  get groups(): { key: 'waiting' | 'other'; title: string; tables: FloorTable[] }[] {
    const waiting = this.tables.filter(t => t.needsStaff);
    const other = this.tables.filter(t => !t.needsStaff);
    const groups: { key: 'waiting' | 'other'; title: string; tables: FloorTable[] }[] = [];
    if (waiting.length) groups.push({ key: 'waiting', title: 'Needs staff', tables: waiting });
    if (other.length) groups.push({ key: 'other', title: waiting.length ? 'Other tables' : 'All tables', tables: other });
    return groups;
  }

  cardClass(t: FloorTable): string {
    return TABLE_TONE_CLASSES[tableTone(t)];
  }

  chipClass(round: FloorRound): string {
    return CHIP_CLASSES[roundChipTone(round)];
  }

  roundLabel(round: FloorRound): string {
    return roundStateLabel(round);
  }

  heldAge(round: FloorRound): string {
    return ageLabel(minutesSince(round.heldSince, this.serverNowMs));
  }

  isSelected(t: FloorTable): boolean {
    return this.selectedTableId === t.id;
  }

  /** One sentence a screen reader hears for the whole card. */
  ariaLabel(t: FloorTable): string {
    const parts = [`${t.displayName}`, this.statusLabel(t.status)];
    const held = t.rounds.filter(r => r.state === 'held');
    if (held.length) parts.push(roundStateLabel({ state: 'held', stale: held.some(r => r.stale) }));
    const released = t.rounds.length - held.length;
    if (released) parts.push(`${released} sent to kitchen`);
    return parts.join(', ');
  }

  select(t: FloorTable): void {
    this.tableSelect.emit(t.id);
  }
}
