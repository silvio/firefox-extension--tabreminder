import browser from 'webextension-polyfill';
import { storageService } from './storage';
import { TimeReminder, TriggeredReminder } from '../types';
import { calculateNextTrigger } from '../utils/timeParser';
import { hasAlarmSupport, hasNotificationSupport } from '../utils/platform';

const ALARM_PREFIX = 'reminder_';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

class AlarmService {
  private async clearAllReminderAlarms(): Promise<void> {
    if (!hasAlarmSupport()) {
      return;
    }

    const alarms = await browser.alarms.getAll();
    const reminderAlarms = alarms.filter((alarm) => alarm.name.startsWith(ALARM_PREFIX));

    await Promise.all(reminderAlarms.map((alarm) => browser.alarms.clear(alarm.name)));
  }

  private hasTriggeredOccurrence(
    triggeredReminders: TriggeredReminder[],
    reminderId: string,
    occurrenceAt: number
  ): boolean {
    const toleranceMs = 1000;
    return triggeredReminders.some(
      (entry) =>
        entry.reminderId === reminderId &&
        entry.triggeredAt >= occurrenceAt - toleranceMs
    );
  }

  private async addTriggeredReminderIfNeeded(
    reminderId: string,
    url: string,
    title: string,
    occurrenceAt: number
  ): Promise<boolean> {
    const triggeredReminders = await storageService.getTriggeredReminders();
    if (this.hasTriggeredOccurrence(triggeredReminders, reminderId, occurrenceAt)) {
      return false;
    }

    const triggered: TriggeredReminder = {
      id: generateId(),
      reminderId,
      url,
      title,
      triggeredAt: Date.now(),
      dismissed: false,
    };
    await storageService.addTriggeredReminder(triggered);

    try {
      await browser.runtime.sendMessage({ type: 'TRIGGERED_REMINDER_ADDED' });
    } catch {
      // Ignore if no listener is ready.
    }

    return true;
  }

  async scheduleReminder(reminder: TimeReminder): Promise<void> {
    if (!hasAlarmSupport()) {
      return; // Alarms not available on this platform
    }

    const alarmName = ALARM_PREFIX + reminder.id;

    // Only schedule if trigger is in the future
    if (reminder.nextTrigger <= Date.now()) {
      return;
    }

    await browser.alarms.create(alarmName, {
      when: reminder.nextTrigger,
    });
  }

  async cancelReminder(reminderId: string): Promise<void> {
    if (!hasAlarmSupport()) {
      return;
    }
    const alarmName = ALARM_PREFIX + reminderId;
    await browser.alarms.clear(alarmName);
  }

  async rescheduleAllReminders(): Promise<void> {
    await this.clearAllReminderAlarms();

    const notes = await storageService.getNotes();
    const now = Date.now();

    // Schedule PageNote reminders
    for (const note of notes) {
      if (note.hasReminder && note.nextTrigger) {
        // Cleanup legacy alarm naming. Current reminders use `note_<id>`.
        await this.cancelReminder(note.id);

        if (note.nextTrigger > now) {
          await this.scheduleNoteReminder(note);
        } else if (note.scheduleType === 'recurring' && note.recurringPattern) {
          // Update next trigger for recurring note reminders
          const nextTrigger = calculateNextTrigger(note.recurringPattern);
          note.nextTrigger = nextTrigger;
          await storageService.saveNote(note);
          await this.scheduleNoteReminder(note);
        } else {
          // Catch-up for one-time overdue reminders after restart/sleep.
          await this.handleNoteReminder(note.id, note.nextTrigger);
        }
      }
    }
  }

  async scheduleNoteReminder(note: any): Promise<void> {
    if (!hasAlarmSupport()) {
      return;
    }

    const alarmName = ALARM_PREFIX + 'note_' + note.id;

    // Only schedule if trigger is in the future
    if (!note.nextTrigger || note.nextTrigger <= Date.now()) {
      return;
    }

    await browser.alarms.create(alarmName, {
      when: note.nextTrigger,
    });
  }

  async cancelNoteReminder(noteId: string): Promise<void> {
    if (!hasAlarmSupport()) {
      return;
    }
    const alarmName = ALARM_PREFIX + 'note_' + noteId;
    await browser.alarms.clear(alarmName);
  }

  async handleAlarm(alarmName: string): Promise<void> {
    if (!alarmName.startsWith(ALARM_PREFIX)) {
      return;
    }

    const idPart = alarmName.slice(ALARM_PREFIX.length);
    
    // Check if it's a note reminder
    if (idPart.startsWith('note_')) {
      const noteId = idPart.slice(5); // Remove 'note_' prefix
      await this.handleNoteReminder(noteId);
      return;
    }

    // Handle old TimeReminder
    const reminderId = idPart;
    const reminders = await storageService.getReminders();
    const reminder = reminders.find((r) => r.id === reminderId);

    if (!reminder) {
      return;
    }

    const occurrenceAt = reminder.nextTrigger;
    if (occurrenceAt > Date.now() + 1000) {
      return; // Stale alarm that was already advanced to the future.
    }

    const added = await this.addTriggeredReminderIfNeeded(
      reminder.id,
      reminder.url,
      reminder.title,
      occurrenceAt
    );

    // Show notification
    const settings = await storageService.getSettings();
    if (added && settings.notifications.system) {
      await this.showNotification(reminder);
    }

    // Update badge for triggered reminders
    if (settings.notifications.badge) {
      await this.updateTriggeredBadge();
    }

    // Handle recurring reminders
    if (reminder.scheduleType === 'recurring' && reminder.recurringPattern) {
      const nextTrigger = calculateNextTrigger(reminder.recurringPattern);
      reminder.nextTrigger = nextTrigger;
      await storageService.saveReminder(reminder);
      await this.scheduleReminder(reminder);
    }
  }

  private async handleNoteReminder(noteId: string, expectedTriggerAt?: number): Promise<void> {
    const notes = await storageService.getNotes();
    const note = notes.find((n) => n.id === noteId);

    if (!note || !note.hasReminder) {
      return;
    }

    const occurrenceAt = expectedTriggerAt ?? note.nextTrigger ?? Date.now();
    if (occurrenceAt > Date.now() + 1000) {
      return; // Stale alarm that was already advanced to the future.
    }

    const added = await this.addTriggeredReminderIfNeeded(
      note.id,
      note.url,
      note.title,
      occurrenceAt
    );

    // Show notification
    const settings = await storageService.getSettings();
    if (added && settings.notifications.system && hasNotificationSupport()) {
      try {
        await browser.notifications.create(note.id, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('icons/icon-48.png'),
          title: 'TabReminder: ' + (note.title || 'Note'),
          message: note.content || 'Time to check this page!',
        });
      } catch (error) {
        console.error('Failed to show note notification:', error);
      }
    }

    // Update badge
    if (settings.notifications.badge) {
      await this.updateTriggeredBadge();
    }

    // Handle recurring note reminders
    if (note.scheduleType === 'recurring' && note.recurringPattern) {
      const nextTrigger = calculateNextTrigger(note.recurringPattern);
      note.nextTrigger = nextTrigger;
      await storageService.saveNote(note);
      await this.scheduleNoteReminder(note);
    }
  }

  private async showNotification(reminder: TimeReminder): Promise<void> {
    if (!hasNotificationSupport()) {
      return;
    }
    try {
      await browser.notifications.create(reminder.id, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-48.png'),
        title: 'TabReminder',
        message: reminder.title || 'Time to revisit a page!',
      });
    } catch (error) {
      console.error('Failed to show reminder notification:', error);
    }
  }

  async updateTriggeredBadge(): Promise<void> {
    const triggered = await storageService.getTriggeredReminders();
    const count = triggered.length;
    const text = count > 0 ? '!' : '';

    try {
      const tabs = await browser.tabs.query({});
      const tabIds = tabs
        .map((tab) => tab.id)
        .filter((id): id is number => typeof id === 'number');

      if (tabIds.length > 0) {
        await Promise.all(tabIds.map((tabId) => browser.browserAction.setBadgeText({ text, tabId })));
        if (count > 0) {
          await Promise.all(
            tabIds.map((tabId) =>
              browser.browserAction.setBadgeBackgroundColor({ color: '#e53935', tabId })
            )
          );
        }
        return;
      }
    } catch (error) {
      console.error('Failed to update badge per-tab, falling back to global badge:', error);
    }

    if (count > 0) {
      await browser.browserAction.setBadgeText({ text });
      await browser.browserAction.setBadgeBackgroundColor({ color: '#e53935' });
    } else {
      await browser.browserAction.setBadgeText({ text });
    }
  }

  async getDueReminders(): Promise<TimeReminder[]> {
    const reminders = await storageService.getReminders();
    const now = Date.now();
    return reminders.filter((r) => r.nextTrigger <= now);
  }
}

export const alarmService = new AlarmService();
