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
    const reminders = await storageService.getReminders();
    const notes = await storageService.getNotes();
    const now = Date.now();

    // Schedule old TimeReminder objects
    for (const reminder of reminders) {
      if (reminder.nextTrigger > now) {
        await this.scheduleReminder(reminder);
      } else if (reminder.scheduleType === 'recurring' && reminder.recurringPattern) {
        // Update next trigger for recurring reminders
        const nextTrigger = calculateNextTrigger(reminder.recurringPattern);
        reminder.nextTrigger = nextTrigger;
        await storageService.saveReminder(reminder);
        await this.scheduleReminder(reminder);
      }
    }

    // Schedule PageNote reminders
    for (const note of notes) {
      if (note.hasReminder && note.nextTrigger) {
        if (note.nextTrigger > now) {
          await this.scheduleNoteReminder(note);
        } else if (note.scheduleType === 'recurring' && note.recurringPattern) {
          // Update next trigger for recurring note reminders
          const nextTrigger = calculateNextTrigger(note.recurringPattern);
          note.nextTrigger = nextTrigger;
          await storageService.saveNote(note);
          await this.scheduleNoteReminder(note);
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

    // Add to triggered reminders
    const triggered: TriggeredReminder = {
      id: generateId(),
      reminderId: reminder.id,
      url: reminder.url,
      title: reminder.title,
      triggeredAt: Date.now(),
      dismissed: false,
    };
    await storageService.addTriggeredReminder(triggered);

    // Show notification
    const settings = await storageService.getSettings();
    if (settings.notifications.system) {
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

  private async handleNoteReminder(noteId: string): Promise<void> {
    const notes = await storageService.getNotes();
    const note = notes.find((n) => n.id === noteId);

    if (!note || !note.hasReminder) {
      return;
    }

    // Show notification
    const settings = await storageService.getSettings();
    if (settings.notifications.system && hasNotificationSupport()) {
      await browser.notifications.create(note.id, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-48.png'),
        title: 'TabReminder: ' + (note.title || 'Note'),
        message: note.content || 'Time to check this page!',
      });
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
    await browser.notifications.create(reminder.id, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('icons/icon-48.png'),
      title: 'TabReminder',
      message: reminder.title || 'Time to revisit a page!',
    });
  }

  async updateTriggeredBadge(): Promise<void> {
    const triggered = await storageService.getTriggeredReminders();
    const count = triggered.length;

    if (count > 0) {
      await browser.browserAction.setBadgeText({ text: '!' });
      await browser.browserAction.setBadgeBackgroundColor({ color: '#e53935' });
    } else {
      await browser.browserAction.setBadgeText({ text: '' });
    }
  }

  async getDueReminders(): Promise<TimeReminder[]> {
    const reminders = await storageService.getReminders();
    const now = Date.now();
    return reminders.filter((r) => r.nextTrigger <= now);
  }
}

export const alarmService = new AlarmService();
