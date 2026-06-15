import { DayHours, OpeningHoursDay } from 'src/app/_models/app.models';

/**
 * The seven days in display order (Mon→Sun) with their full labels. Keyed by the
 * lowercase full day name the backend `opening_hours` object uses — deliberately
 * NOT the menu module's 3-letter `ScheduleDay` (different storage contract).
 */
export const OPENING_HOURS_DAYS: { key: OpeningHoursDay; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

/** Seed for a day with no stored hours (or a never-configured restaurant). */
export const DEFAULT_DAY_HOURS: DayHours = {
  closed: false,
  open: '09:00',
  close: '17:00',
};
