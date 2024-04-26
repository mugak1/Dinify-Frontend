import { ModuleWithProviders, NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WINDOW } from './window.token';
import { STORAGE_KEY_PREFIX } from './storage-key-prefix.token';

@NgModule({
  imports: [CommonModule],
})
export class StorageModule {
  static forRoot(
    config: StorageModuleConfig
  ): ModuleWithProviders<StorageModule> {
    return {
      ngModule: StorageModule,
      providers: [
        {
          provide: WINDOW,
          useFactory: () => window,
        },
        {
          provide: STORAGE_KEY_PREFIX,
          useValue: config.prefix || '',
        },
      ],
    };
  }
}
export interface StorageModuleConfig {
  prefix?: string;
}