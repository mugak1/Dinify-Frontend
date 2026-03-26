import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WINDOW } from '../_services/storage/window.token';
import { STORAGE_KEY_PREFIX } from '../_services/storage/storage-key-prefix.token';
import { DinerAppComponent } from './diner-app.component';

describe('DinerAppComponent', () => {
  let component: DinerAppComponent;
  let fixture: ComponentFixture<DinerAppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [DinerAppComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: WINDOW, useValue: window },
        { provide: STORAGE_KEY_PREFIX, useValue: '' },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    })
    .compileComponents();

    fixture = TestBed.createComponent(DinerAppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
