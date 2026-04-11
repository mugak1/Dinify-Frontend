import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { TablesServiceViewComponent } from './components/tables-service-view/tables-service-view.component';
import { TablesSetupViewComponent } from './components/tables-setup-view/tables-setup-view.component';

@Component({
  selector: 'app-tables',
  standalone: true,
  imports: [CommonModule, TablesServiceViewComponent, TablesSetupViewComponent],
  templateUrl: './tables.component.html',
  styleUrls: ['./tables.component.css'],
})
export class TablesComponent {
  activeView: 'service' | 'setup' = 'service';
}
