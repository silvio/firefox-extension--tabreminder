// Background script - handles alarms, notifications, and tab events
import browser from 'webextension-polyfill';
import { storageService } from '../shared/services/storage';
import { alarmService } from '../shared/services/alarms';

console.log('TabReminder background script loaded');

// Track which tabs have already shown overlay for current URL
const shownOverlays = new Map<number, string>();

// Initialize extension
browser.runtime.onInstalled.addListener(async () => {
  console.log('TabReminder installed');
  await storageService.initialize();
  await alarmService.rescheduleAllReminders();
});

// Reschedule alarms on browser startup
browser.runtime.onStartup?.addListener(async () => {
  await alarmService.rescheduleAllReminders();
});

// Handle alarms
browser.alarms.onAlarm.addListener(async (alarm) => {
  await alarmService.handleAlarm(alarm.name);
});

// Handle notification clicks
browser.notifications.onClicked.addListener(async (notificationId) => {
  const reminders = await storageService.getReminders();
  const reminder = reminders.find((r) => r.id === notificationId);
  if (reminder) {
    await browser.tabs.create({ url: reminder.url });
    await browser.notifications.clear(notificationId);
  }
});

// Check for notes when tab is updated
browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // URL changed - reset overlay tracking
    shownOverlays.delete(tabId);
    await checkForNote(tabId, tab.url);
  }
});

// Check for notes when tab is activated
browser.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await browser.tabs.get(activeInfo.tabId);
  if (tab.url) {
    // Reset overlay tracking on tab switch to show overlay
    shownOverlays.delete(activeInfo.tabId);
    await checkForNote(activeInfo.tabId, tab.url);
  }
});

// Clear tracking when tab is closed
browser.tabs.onRemoved.addListener((tabId) => {
  shownOverlays.delete(tabId);
});

async function checkForNote(tabId: number, url: string): Promise<void> {
  try {
    const notes = await storageService.getNotesForUrl(url);
    const reminders = await storageService.getReminders();
    const categories = await storageService.getCategories();
    const triggeredReminders = await storageService.getTriggeredReminders();

    // Check if page has reminders
    const hasReminders = reminders.some((r) => {
      try {
        const rUrl = new URL(r.url);
        const pUrl = new URL(url);
        return rUrl.hostname === pUrl.hostname && rUrl.pathname === pUrl.pathname;
      } catch {
        return false;
      }
    });

    // Update badge based on priority: triggered reminders > notes, or show both
    if (triggeredReminders.length > 0 && notes.length > 0) {
      // Show both counts with icons
      await browser.browserAction.setBadgeText({ 
        text: `${triggeredReminders.length}🔔 + ${notes.length}📝`, 
        tabId 
      });
      await browser.browserAction.setBadgeBackgroundColor({ color: '#e53935', tabId });
    } else if (triggeredReminders.length > 0) {
      // Show triggered count with icon
      await browser.browserAction.setBadgeText({ 
        text: `${triggeredReminders.length}🔔`, 
        tabId 
      });
      await browser.browserAction.setBadgeBackgroundColor({ color: '#e53935', tabId });
    } else if (notes.length > 0) {
      // Show note count with icon
      await browser.browserAction.setBadgeText({ 
        text: `${notes.length}📝`, 
        tabId 
      });
      await browser.browserAction.setBadgeBackgroundColor({
        color: '#4a90d9',
        tabId,
      });
    } else {
      await browser.browserAction.setBadgeText({ text: '', tabId });
    }

    // Show overlay for notes (separate from badge logic)
    if (notes.length > 0) {
      const lastShownUrl = shownOverlays.get(tabId);
      const shouldShowOverlay = lastShownUrl !== url;
      
      const settings = await storageService.getSettings();
      if (shouldShowOverlay && settings.notifications.overlay) {
        try {
          await browser.tabs.sendMessage(tabId, {
            type: 'SHOW_NOTES',
            notes,
            categories,
            overlayStyle: settings.notifications.overlayStyle,
            hasReminders,
          });
          shownOverlays.set(tabId, url);
        } catch {
          // Content script not ready yet, ignore
        }
      }
    }
  } catch (error) {
    console.error('Error checking for note:', error);
  }
}

// Handle messages from popup/sidebar/content
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; reminder?: unknown; noteId?: string };
  if (msg.type === 'NOTE_UPDATED' || msg.type === 'NOTE_DELETED') {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id && tabs[0].url) {
        checkForNote(tabs[0].id, tabs[0].url);
      }
    });
  }
  if (msg.type === 'REMINDER_CREATED' || msg.type === 'REMINDER_UPDATED') {
    alarmService.rescheduleAllReminders();
  }
  if (msg.type === 'REMINDER_DELETED') {
    alarmService.rescheduleAllReminders();
  }
  if (msg.type === 'EDIT_NOTE' && msg.noteId) {
    // Store noteId and open sidebar for editing
    browser.storage.local.set({ editNoteId: msg.noteId }).then(() => {
      browser.sidebarAction.open();
    });
  }
  return undefined;
});
