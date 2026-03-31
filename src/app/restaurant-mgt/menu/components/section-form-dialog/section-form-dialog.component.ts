import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { DialogComponent } from 'src/app/_shared/ui/dialog/dialog.component';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import { SwitchComponent } from 'src/app/_shared/ui/switch/switch.component';
import { MenuSectionListItem, SectionSchedule } from 'src/app/_models/app.models';
import { ScheduleBuilderComponent } from '../schedule-builder/schedule-builder.component';
import { createEmptySchedule, validateSchedules } from '../../utils/schedule-utils';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-section-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    DialogComponent,
    ButtonComponent,
    SwitchComponent,
    ScheduleBuilderComponent,
  ],
  templateUrl: './section-form-dialog.component.html',
})
export class SectionFormDialogComponent implements OnChanges {

  @Input() open = false;
  @Input() section?: MenuSectionListItem;
  @Input() restaurantId = '';
  @Input() deleteMode = false;

  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<any>();
  @Output() deleted = new EventEmitter<{ id: string; reason: string }>();

  form!: FormGroup;
  deleteReason = '';
  imagePreview = '';
  availability: 'always' | 'scheduled' = 'always';
  schedules: SectionSchedule[] = [];
  scheduleError: string | null = null;
  isScheduleOpen = false;

  constructor(private fb: FormBuilder) {
    this.buildForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.buildForm();
      this.deleteReason = '';
      this.imagePreview = '';
      this.scheduleError = null;

      if (this.section) {
        this.form.patchValue({
          id: this.section.id,
          name: this.section.name,
          description: this.section.description,
          available: this.section.available,
          section_banner_image: this.section.section_banner_image,
        });
        if (this.section.section_banner_image) {
          this.imagePreview = environment.apiUrl + this.section.section_banner_image;
        }
        this.availability = this.section.availability || 'always';
        this.schedules = this.section.schedules ? [...this.section.schedules] : [];
        this.isScheduleOpen = this.availability === 'scheduled';
      } else {
        this.availability = 'always';
        this.schedules = [];
        this.isScheduleOpen = false;
      }

      this.form.get('restaurant')?.setValue(this.restaurantId);
    }
  }

  onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.form.get('section_banner_image')?.setValue(file);
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  onAvailabilityChange(value: 'always' | 'scheduled'): void {
    this.availability = value;
    if (value === 'scheduled' && this.schedules.length === 0) {
      this.schedules = [createEmptySchedule()];
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    if (this.availability === 'scheduled') {
      const error = validateSchedules(this.schedules);
      if (error) {
        this.scheduleError = error;
        return;
      }
    }

    const payload = { ...this.form.getRawValue() };

    // If banner image is a string (existing URL, not changed), remove from payload
    if (typeof payload.section_banner_image === 'string') {
      delete payload.section_banner_image;
    }

    payload.availability = this.availability;
    payload.schedules = this.availability === 'scheduled' ? this.schedules : [];

    this.saved.emit(payload);
  }

  onDelete(): void {
    if (!this.section || !this.deleteReason.trim()) return;
    this.deleted.emit({ id: this.section.id, reason: this.deleteReason.trim() });
  }

  onClose(): void {
    this.closed.emit();
  }

  private buildForm(): void {
    this.form = this.fb.group({
      id: [''],
      name: ['', Validators.required],
      restaurant: [''],
      description: [''],
      section_banner_image: [null],
      available: [true],
    });
  }
}
