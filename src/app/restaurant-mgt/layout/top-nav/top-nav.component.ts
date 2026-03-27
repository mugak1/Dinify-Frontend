import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthenticationService } from '../../../_services/authentication.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule],
  templateUrl: './top-nav.component.html',
})
export class TopNavComponent {
  @Output() menuClick = new EventEmitter<void>();

  baseUrl = environment.apiUrl;

  constructor(public auth: AuthenticationService) {}
}
