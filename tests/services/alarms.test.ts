import { alarmService } from '../../src/shared/services/alarms';
import { storageService } from '../../src/shared/services/storage';
import { DEFAULT_SETTINGS, PageNote, TriggeredReminder } from '../../src/shared/types';

const browserMock = (global as any).browser;

function createDueNote(overrides: Partial<PageNote> = {}): PageNote {
  const now = Date.now();
  return {
    id: 'note-1',
    url: 'https://example.com/page',
    urlMatchType: 'exact',
    title: 'Reminder note',
    content: 'Check this page',
    categoryId: null,
    createdAt: now - 60_000,
    updatedAt: now - 60_000,
    hasReminder: true,
    scheduleType: 'once',
    scheduledTime: now - 10_000,
    recurringPattern: null,
    nextTrigger: now - 10_000,
    ...overrides,
  };
}

describe('AlarmService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    browserMock.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    browserMock.browserAction.setBadgeText.mockResolvedValue(undefined);
    browserMock.browserAction.setBadgeBackgroundColor.mockResolvedValue(undefined);
    browserMock.notifications.create.mockResolvedValue('notification-id');
    browserMock.runtime.sendMessage.mockResolvedValue(undefined);
    browserMock.alarms.create.mockResolvedValue(undefined);
    browserMock.alarms.clear.mockResolvedValue(true);
  });

  it('adds triggered reminder for note alarms and sends notification', async () => {
    const dueNote = createDueNote();

    jest.spyOn(storageService, 'getNotes').mockResolvedValue([dueNote]);
    jest.spyOn(storageService, 'getTriggeredReminders').mockResolvedValue([]);
    const addTriggeredSpy = jest
      .spyOn(storageService, 'addTriggeredReminder')
      .mockResolvedValue(undefined);
    jest.spyOn(storageService, 'getSettings').mockResolvedValue(DEFAULT_SETTINGS);

    await alarmService.handleAlarm(`reminder_note_${dueNote.id}`);

    expect(addTriggeredSpy).toHaveBeenCalledTimes(1);
    expect(browserMock.notifications.create).toHaveBeenCalledTimes(1);
    expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'TRIGGERED_REMINDER_ADDED',
    });
  });

  it('does not add duplicate triggered reminders for an already-triggered occurrence', async () => {
    const dueNote = createDueNote();
    const existingTriggered: TriggeredReminder = {
      id: 'tr-1',
      reminderId: dueNote.id,
      url: dueNote.url,
      title: dueNote.title,
      triggeredAt: Date.now(),
      dismissed: false,
    };

    jest.spyOn(storageService, 'getNotes').mockResolvedValue([dueNote]);
    jest
      .spyOn(storageService, 'getTriggeredReminders')
      .mockResolvedValue([existingTriggered]);
    const addTriggeredSpy = jest
      .spyOn(storageService, 'addTriggeredReminder')
      .mockResolvedValue(undefined);
    jest.spyOn(storageService, 'getSettings').mockResolvedValue(DEFAULT_SETTINGS);

    await alarmService.handleAlarm(`reminder_note_${dueNote.id}`);

    expect(addTriggeredSpy).not.toHaveBeenCalled();
    expect(browserMock.notifications.create).not.toHaveBeenCalled();
  });

  it('fires overdue one-time reminders once during startup reschedule', async () => {
    const dueNote = createDueNote();

    jest.spyOn(storageService, 'getNotes').mockResolvedValue([dueNote]);
    jest.spyOn(storageService, 'getTriggeredReminders').mockResolvedValue([]);
    const addTriggeredSpy = jest
      .spyOn(storageService, 'addTriggeredReminder')
      .mockResolvedValue(undefined);
    jest.spyOn(storageService, 'getSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        system: false,
        badge: false,
      },
    });

    await alarmService.rescheduleAllReminders();

    expect(addTriggeredSpy).toHaveBeenCalledTimes(1);
    expect(browserMock.alarms.clear).toHaveBeenCalledWith(`reminder_${dueNote.id}`);
  });

  it('updates badge for each open tab when triggered reminders exist', async () => {
    const triggered: TriggeredReminder = {
      id: 'tr-1',
      reminderId: 'note-1',
      url: 'https://example.com',
      title: 'Reminder',
      triggeredAt: Date.now(),
      dismissed: false,
    };

    browserMock.tabs.query.mockResolvedValue([{ id: 11 }, { id: 22 }, { id: undefined }]);
    jest.spyOn(storageService, 'getTriggeredReminders').mockResolvedValue([triggered]);

    await alarmService.updateTriggeredBadge();

    expect(browserMock.browserAction.setBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 11 });
    expect(browserMock.browserAction.setBadgeText).toHaveBeenCalledWith({ text: '!', tabId: 22 });
    expect(browserMock.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: '#e53935',
      tabId: 11,
    });
    expect(browserMock.browserAction.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: '#e53935',
      tabId: 22,
    });
  });
});
