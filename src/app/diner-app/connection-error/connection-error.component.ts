
import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * Full-page diner error state for a load that genuinely didn't come back
 * (a flaky connection or a transient server hiccup). Calm, recoverable
 * dead-end with a single "Try again" action — the host re-runs its own fetch
 * in response to the (retry) output. Sibling to NoTableComponent, which stays
 * the *terminal* "ask staff" screen for a removed/disabled table.
 */
@Component({
    selector: 'app-diner-connection-error',
    imports: [],
    templateUrl: './connection-error.component.html',
    styleUrls: ['./connection-error.component.css'],
})
export class DinerConnectionErrorComponent {
    /** Calm headline. Overridable, but the default fits both load surfaces. */
    @Input() headline = "We couldn't load this page";
    /** One line of reassuring guidance under the headline. */
    @Input() description =
        'Something interrupted the connection. Check your signal and try again.';
    /** Optional restaurant name, shown as a quiet footer for context/branding. */
    @Input() restaurantName?: string;
    /** Emitted when the diner taps "Try again"; the host re-runs its fetch. */
    @Output() retry = new EventEmitter<void>();
}
