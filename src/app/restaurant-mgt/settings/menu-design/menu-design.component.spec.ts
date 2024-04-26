import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MenuDesignComponent } from './menu-design.component';

describe('MenuDesignComponent', () => {
  let component: MenuDesignComponent;
  let fixture: ComponentFixture<MenuDesignComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MenuDesignComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MenuDesignComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
