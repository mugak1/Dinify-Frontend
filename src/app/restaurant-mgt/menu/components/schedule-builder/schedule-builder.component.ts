import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ScheduleDay, SectionSchedule } from 'src/app/_models/app.models';
import { ButtonComponent } from 'src/app/_shared/ui/button/button.component';
import {
  ALL_DAYS,
  DAY_LABELS,
  DAY_FULL_LABELS,
  createEmptySchedule,
  generateTimeOptions,
} from '../../utils/schedule-utils';

@Component({
  selector: 'app-schedule-builder',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonComponent],
  templateUrl: './schedule-builder.component.html',
})
export class ScheduleBuilderComponent {
  @Input() schedules: SectionSchedule[] = [];
  @Input() error: string | null = null;

  @Output() schedulesChange = new EventEmitter<SectionSchedule[]>();

  readonly allDays = ALL_DAYS;
  readonly dayLabels = DAY_LABELS;
  readonly dayFullLabels = DAY_FULL_LABELS;
  readonly timeOptions = generateTimeOptions();

  toggleDay(scheduleId: string, day: ScheduleDay): void {
    const updated = this.schedules.map((s) => {
      if (s.id !== scheduleId) return s;
      const days = s.days.includes(day)
        ? s.days.filter((d) => d !== day)
        : [...s.days, day];
      return { ...s, days };
    });
    this.schedulesChange.emit(updated);
  }

  updateTime(scheduleId: string, field: 'startTime' | 'endTime', value: string): void {
    const updated = this.schedules.map((s) =>
      s.id === scheduleId ? { ...s, [field]: value } : s
    );
    this.schedulesChange.emit(updated);
  }

  addSchedule(): void {
    this.schedulesChange.emit([...this.schedules, createEmptySchedule()]);
  }

  removeSchedule(id: string): void {
    this.schedulesChange.emit(this.schedules.filter((s) => s.id !== id));
  }

  trackById(_index: number, schedule: SectionSchedule): string {
    return schedule.id;
  }
}
