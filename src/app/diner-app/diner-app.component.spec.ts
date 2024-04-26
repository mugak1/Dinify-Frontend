import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DinerAppComponent } from './diner-app.component';

describe('DinerAppComponent', () => {
  let component: DinerAppComponent;
  let fixture: ComponentFixture<DinerAppComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ DinerAppComponent ]
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
