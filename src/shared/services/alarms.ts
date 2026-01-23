import browser from 'webextension-polyfill';
import { storageService } from './storage';
import { TimeReminder, TriggeredReminder } from '../types';
import { calculateNextTrigger } from '../utils/timeParser';

const ALARM_PREFIX = 'reminder_';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

class AlarmService {
  async scheduleReminder(reminder: TimeReminder): Promise<void> {
    const alarmName = ALARM_PREFIX + reminder.id;

    await browser.alarms.create(alarmName, {
      when: reminder.nextTrigger,
    });
  }

  async cancelReminder(reminderId: string): Promise<void> {
    const alarmName = ALARM_PREFIX + reminderId;
    await browser.alarms.clear(alarmName);
  }

  async rescheduleAllReminders(): Promise<void> {
    const reminders = await storageService.getReminders();
    const now = Date.now();

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
  }

  async handleAlarm(alarmName: string): Promise<void> {
    if (!alarmName.startsWith(ALARM_PREFIX)) {
      return;
    }

    const reminderId = alarmName.slice(ALARM_PREFIX.length);
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

  private async showNotification(reminder: TimeReminder): Promise<void> {
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
