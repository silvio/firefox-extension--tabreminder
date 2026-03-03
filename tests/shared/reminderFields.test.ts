import { buildReminderFields } from '../../src/shared/core/reminderFields';
import { PageNote, RecurringPattern } from '../../src/shared/types';

describe('buildReminderFields', () => {
  it('returns disabled reminder fields when hasReminder is false', () => {
    const fields = buildReminderFields({
      hasReminder: false,
      scheduleType: 'once',
      scheduledTime: null,
      recurringPattern: null,
    });

    expect(fields).toEqual({
      hasReminder: false,
      scheduleType: undefined,
      scheduledTime: undefined,
      recurringPattern: undefined,
      nextTrigger: undefined,
    });
  });

  it('preserves existing reminder timing when unchanged on edit', () => {
    const editingNote: PageNote = {
      id: 'note-1',
      url: 'https://example.com',
      urlMatchType: 'exact',
      title: 'Title',
      content: 'Content',
      categoryId: 'work',
      createdAt: 1,
      updatedAt: 2,
      hasReminder: true,
      scheduleType: 'once',
      scheduledTime: 123456,
      recurringPattern: null,
      nextTrigger: 123456,
    };

    const fields = buildReminderFields({
      editingNote,
      hasReminder: true,
      scheduleType: 'once',
      scheduledTime: 123456,
      recurringPattern: null,
    });

    expect(fields).toEqual({
      hasReminder: true,
      scheduleType: 'once',
      scheduledTime: 123456,
      recurringPattern: null,
      nextTrigger: 123456,
    });
  });

  it('builds recurring reminder fields with computed next trigger', () => {
    const pattern: RecurringPattern = {
      frequency: 'minutes',
      interval: 5,
      endCondition: { type: 'never' },
    };

    const fields = buildReminderFields({
      hasReminder: true,
      scheduleType: 'recurring',
      recurringPattern: pattern,
      scheduledTime: undefined,
    });

    expect(fields.hasReminder).toBe(true);
    expect(fields.scheduleType).toBe('recurring');
    expect(fields.recurringPattern).toEqual(pattern);
    expect(typeof fields.nextTrigger).toBe('number');
    expect((fields.nextTrigger || 0) - Date.now()).toBeGreaterThan(4 * 60 * 1000);
  });

  it('preserves recurring schedule type without pattern when requested', () => {
    const fields = buildReminderFields({
      hasReminder: true,
      scheduleType: 'recurring',
      recurringPattern: null,
      scheduledTime: undefined,
      preserveRecurringWithoutPattern: true,
    });

    expect(fields).toEqual({
      hasReminder: true,
      scheduleType: 'recurring',
      scheduledTime: undefined,
      recurringPattern: null,
      nextTrigger: undefined,
    });
  });
});
