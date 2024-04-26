import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommonImageComponent } from './common-image.component';

describe('CommonImageComponent', () => {
  let component: CommonImageComponent;
  let fixture: ComponentFixture<CommonImageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ CommonImageComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CommonImageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
