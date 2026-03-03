import { PageNote, RecurringPattern, ScheduleType } from '../types';
import { calculateNextTrigger } from '../utils/timeParser';

export type NoteReminderFields = Pick<
  PageNote,
  'hasReminder' | 'scheduleType' | 'scheduledTime' | 'recurringPattern' | 'nextTrigger'
>;

export interface BuildReminderFieldsInput {
  editingNote?: PageNote | null;
  hasReminder: boolean;
  scheduleType: ScheduleType;
  scheduledTime?: number | null;
  recurringPattern?: RecurringPattern | null;
  preserveRecurringWithoutPattern?: boolean;
}

function areRecurringPatternsEqual(
  a?: RecurringPattern | null,
  b?: RecurringPattern | null
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function buildReminderFields({
  editingNote = null,
  hasReminder,
  scheduleType,
  scheduledTime,
  recurringPattern,
  preserveRecurringWithoutPattern = false,
}: BuildReminderFieldsInput): NoteReminderFields {
  const normalizedScheduledTime = scheduledTime ?? undefined;
  const normalizedRecurringPattern = recurringPattern ?? null;

  const existingHasReminder = Boolean(editingNote?.hasReminder);
  const reminderUnchanged =
    Boolean(editingNote) &&
    existingHasReminder === hasReminder &&
    (!hasReminder ||
      ((editingNote?.scheduleType || 'once') === scheduleType &&
        (scheduleType === 'once'
          ? (editingNote?.scheduledTime ?? null) === (normalizedScheduledTime ?? null)
          : areRecurringPatternsEqual(editingNote?.recurringPattern ?? null, normalizedRecurringPattern))));

  if (editingNote && reminderUnchanged) {
    return {
      hasReminder: editingNote.hasReminder,
      scheduleType: editingNote.scheduleType,
      scheduledTime: editingNote.scheduledTime,
      recurringPattern: editingNote.recurringPattern,
      nextTrigger: editingNote.nextTrigger,
    };
  }

  if (!hasReminder) {
    return {
      hasReminder: false,
      scheduleType: undefined,
      scheduledTime: undefined,
      recurringPattern: undefined,
      nextTrigger: undefined,
    };
  }

  if (scheduleType === 'recurring' && normalizedRecurringPattern) {
    const nextTrigger = calculateNextTrigger(normalizedRecurringPattern);
    return {
      hasReminder: true,
      scheduleType: 'recurring',
      scheduledTime: nextTrigger,
      recurringPattern: normalizedRecurringPattern,
      nextTrigger,
    };
  }

  if (scheduleType === 'recurring' && preserveRecurringWithoutPattern) {
    return {
      hasReminder: true,
      scheduleType: 'recurring',
      scheduledTime: normalizedScheduledTime,
      recurringPattern: normalizedRecurringPattern,
      nextTrigger: undefined,
    };
  }

  return {
    hasReminder: true,
    scheduleType: 'once',
    scheduledTime: normalizedScheduledTime,
    recurringPattern: null,
    nextTrigger: normalizedScheduledTime,
  };
}
