import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RestProfileComponent } from './rest-profile.component';

describe('RestProfileComponent', () => {
  let component: RestProfileComponent;
  let fixture: ComponentFixture<RestProfileComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ RestProfileComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RestProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
