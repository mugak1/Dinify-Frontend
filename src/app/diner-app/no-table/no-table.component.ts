import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { SessionStorageService } from '../../_services/storage/session-storage.service';
import { Restaurant } from '../../_models/app.models';

@Component({
    selector: 'app-no-table',
    imports: [CommonModule],
    templateUrl: './no-table.component.html',
    styleUrls: ['./no-table.component.css']
})
export class NoTableComponent implements OnInit {
    /**
     * When set, the panel shows this message as a friendly dead-end (e.g. a
     * scanned table that's unavailable, or a bad QR code). When absent, the
     * default "scan to start" guidance is shown.
     */
    @Input() message?: string;
    restaurantName = '';

    constructor(private readonly sessionStorage: SessionStorageService) {}

    ngOnInit(): void {
        const restaurant = this.sessionStorage.getItem<Restaurant>('restaurant');
        this.restaurantName = restaurant?.name ?? '';
    }
}
