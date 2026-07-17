import { Component } from '@angular/core';

import { RouterModule } from '@angular/router';

interface TeamNavItem {
  key: string;
  label: string;
  path: string;
  icon: string;
}

/**
 * Settings → Team master–detail shell (cloned from ReportsShellComponent). The
 * sub-nav lists the Team sections and lives ABOVE the <router-outlet>; each
 * child keeps its own SectionPageComponent header, so the shell owns only the
 * sub-nav + outlet (no date bar — that is report-specific).
 *
 * The sub-nav is gated on `nav.length > 1`: with E's single "Members" entry it
 * stays hidden and the shell is a transparent passthrough (Members renders
 * exactly as before). PR F reveals it by appending a second nav entry + a child
 * route (a two-append change) — no E line needs editing. Concrete Reports
 * sizing is reused (rail `lg:w-[240px]`; explicit px, no font-relative units —
 * the 14px-root-font explicit-height rule).
 */
@Component({
  selector: 'app-team-shell',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './team-shell.component.html',
})
export class TeamShellComponent {
  readonly nav: TeamNavItem[] = [
    { key: 'members', label: 'Members', path: 'members', icon: 'users' },
    { key: 'roles', label: 'Roles & access', path: 'roles', icon: 'shield' },
  ];
}
