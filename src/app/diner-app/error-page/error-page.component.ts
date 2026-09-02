import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    changeDetection: ChangeDetectionStrategy.Eager,
    selector: 'app-error-page',
    imports: [],
    templateUrl: './error-page.component.html',
    styleUrl: './error-page.component.css'
})
export class ErrorPageComponent {

}
