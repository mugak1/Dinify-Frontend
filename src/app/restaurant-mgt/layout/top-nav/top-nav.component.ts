import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Menu, Bell, LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';

const icons = { Menu, Bell };
import { AuthenticationService } from '../../../_services/authentication.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule],
  providers: [{ provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(icons) }],
  templateUrl: './top-nav.component.html',
})
export class TopNavComponent {
  @Output() menuClick = new EventEmitter<void>();

  baseUrl = environment.apiUrl;

  constructor(public auth: AuthenticationService) {}
}
