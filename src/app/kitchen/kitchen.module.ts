import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';

import { BoardComponent } from './board/board.component';

/**
 * Lazy feature module for the Kitchen View. Mirrors the diner-app pattern:
 * NgModule + RouterModule.forChild providing the child route. BoardComponent is
 * standalone, so the router resolves it directly — it is not declared here.
 */
const routes: Routes = [
  { path: '', component: BoardComponent, title: 'Kitchen' },
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [CommonModule, RouterModule.forChild(routes)],
})
export class KitchenModule {}
