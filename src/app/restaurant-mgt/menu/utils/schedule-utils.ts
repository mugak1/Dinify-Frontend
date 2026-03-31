import { MenuSectionListItem, ScheduleDay, SectionSchedule } from 'src/app/_models/app.models';

export const ALL_DAYS: ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DAY_LABELS: Record<ScheduleDay, string> = {
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'T',
  fri: 'F',
  sat: 'S',
  sun: 'S',
};

export const DAY_FULL_LABELS: Record<ScheduleDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/**
 * Converts JavaScript day index (0=Sunday) to ScheduleDay
 */
function getScheduleDay(dayIndex: number): ScheduleDay {
  const days: ScheduleDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return days[dayIndex];
}

/**
 * Parses a time string "HH:mm" to minutes since midnight
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Checks if a given time (in minutes) falls within a schedule window.
 * Handles overnight spans (e.g., 22:00 - 02:00).
 */
function isTimeInWindow(currentMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Creates an empty schedule slot with default times.
 */
export function createEmptySchedule(): SectionSchedule {
  return {
    id: `sched_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    days: [],
    startTime: '09:00',
    endTime: '17:00',
  };
}

/**
 * Validates an array of schedules. Returns an error message or null.
 */
export function validateSchedules(schedules: SectionSchedule[]): string | null {
  if (schedules.length === 0) {
    return 'At least one schedule is required when using scheduled availability.';
  }

  for (let i = 0; i < schedules.length; i++) {
    const schedule = schedules[i];

    if (schedule.days.length === 0) {
      return `Schedule ${i + 1}: At least one day must be selected.`;
    }

    if (!schedule.startTime || !schedule.endTime) {
      return `Schedule ${i + 1}: Start and end times are required.`;
    }
  }

  return null;
}

/**
 * Checks if a section is currently active based on its schedules.
 * Uses local browser time.
 */
export function isSectionCurrentlyActive(section: MenuSectionListItem): boolean {
  if (section.availability !== 'scheduled') {
    return true;
  }

  if (!section.schedules || section.schedules.length === 0) {
    return false;
  }

  const now = new Date();
  const currentDay = getScheduleDay(now.getDay());
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return section.schedules.some((schedule) => {
    if (!schedule.days.includes(currentDay)) {
      return false;
    }
    const startMinutes = parseTimeToMinutes(schedule.startTime);
    const endMinutes = parseTimeToMinutes(schedule.endTime);
    return isTimeInWindow(currentMinutes, startMinutes, endMinutes);
  });
}

/**
 * Generates time options in 30-minute increments for dropdowns.
 */
export function generateTimeOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];

  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const value = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const ampm = hour < 12 ? 'AM' : 'PM';
      const label = `${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`;
      options.push({ value, label });
    }
  }

  return options;
}
