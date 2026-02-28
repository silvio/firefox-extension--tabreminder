// Background script - handles alarms, notifications, and tab events
import browser from 'webextension-polyfill';
import { storageService, STORAGE_KEYS } from '../shared/services/storage';
import { alarmService } from '../shared/services/alarms';
import { hasAlarmSupport, hasBackgroundSync, hasNotificationSupport, isAndroid } from '../shared/utils/platform';

console.log('TabReminder background script loaded');

// Track which tabs have already shown overlay for current URL
const shownOverlays = new Map<number, string>();

// Listen for storage changes and trigger WebDAV sync from background context
// This ensures sync persists even if popup/options page closes
// Only enabled on desktop (not needed on Android - uses immediate sync)
if (hasBackgroundSync()) {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    
    // When notes change, trigger sync for affected categories
    if (changes[STORAGE_KEYS.NOTES]) {
      const newNotes = changes[STORAGE_KEYS.NOTES].newValue as Array<{ categoryId: string | null }> | undefined;
      const oldNotes = changes[STORAGE_KEYS.NOTES].oldValue as Array<{ categoryId: string | null }> | undefined;
      
      if (newNotes) {
        // Collect all unique category IDs from changed notes
        const categoryIds = new Set<string>();
        
        // Get categories from new notes
        newNotes.forEach(note => {
          if (note.categoryId) categoryIds.add(note.categoryId);
        });
        
        // Get categories from old notes (for deletions)
        if (oldNotes) {
          oldNotes.forEach(note => {
            if (note.categoryId) categoryIds.add(note.categoryId);
          });
        }
        
        // Trigger sync for each affected category
        console.log('Background: Detected note changes, triggering WebDAV sync for categories:', Array.from(categoryIds));
        categoryIds.forEach(categoryId => {
          storageService.triggerWebDAVSync(categoryId);
        });
      }
    }
    
    // When categories change, trigger sync for modified categories
    if (changes[STORAGE_KEYS.CATEGORIES]) {
      const newCategories = changes[STORAGE_KEYS.CATEGORIES].newValue as Array<{ id: string }> | undefined;
      if (newCategories) {
        console.log('Background: Detected category changes, triggering WebDAV sync for all categories');
        newCategories.forEach(category => {
          storageService.triggerWebDAVSync(category.id);
        });
      }
    }
  });
}

// Initialize extension
browser.runtime.onInstalled.addListener(async () => {
  console.log('TabReminder installed');
  await storageService.initialize();
  
  // Only reschedule alarms on platforms that support them
  if (hasAlarmSupport()) {
    await alarmService.rescheduleAllReminders();
  }
});

// Initialize extension services on browser startup
browser.runtime.onStartup?.addListener(async () => {
  await storageService.initialize();
  if (hasAlarmSupport()) {
    await alarmService.rescheduleAllReminders();
  }
});

// Reschedule alarms on supported platforms
if (hasAlarmSupport()) {
  // Handle alarms
  browser.alarms.onAlarm.addListener(async (alarm) => {
    await alarmService.handleAlarm(alarm.name);
  });
}

// Handle notification clicks (desktop only)
if (hasNotificationSupport()) {
  browser.notifications.onClicked.addListener(async (notificationId) => {
    const reminders = await storageService.getReminders();
    const reminder = reminders.find((r) => r.id === notificationId);
    if (reminder) {
      await browser.tabs.create({ url: reminder.url });
      await browser.notifications.clear(notificationId);
    }
  });
}

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
    const categories = await storageService.getCategories();
    const triggeredReminders = await storageService.getTriggeredReminders();

    // Check if page has reminders
    const hasReminders = notes.some((n) => n.hasReminder && n.nextTrigger !== undefined);

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
        const delivered = await sendOverlayMessageWithRetry(tabId, {
            type: 'SHOW_NOTES',
            notes,
            categories,
            overlayStyle: settings.notifications.overlayStyle,
            hasReminders,
          });
        if (delivered) {
          shownOverlays.set(tabId, url);
        }
      }
    }
  } catch (error) {
    console.error('Error checking for note:', error);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOverlayMessageWithRetry(
  tabId: number,
  payload: {
    type: 'SHOW_NOTES';
    notes: unknown[];
    categories: unknown[];
    overlayStyle: unknown;
    hasReminders: boolean;
  },
  maxRetries: number = 2
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await browser.tabs.sendMessage(tabId, payload);
      return true;
    } catch {
      if (attempt === maxRetries) {
        return false;
      }
      await delay(150 * (attempt + 1));
    }
  }
  return false;
}

// Handle messages from popup/sidebar/content
browser.runtime.onMessage.addListener(async (message: unknown) => {
  const msg = message as { type: string; reminder?: unknown; noteId?: string };
  if (msg.type === 'NOTE_UPDATED' || msg.type === 'NOTE_DELETED') {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]?.id && tabs[0].url) {
        checkForNote(tabs[0].id, tabs[0].url);
      }
    });
  }
  if (msg.type === 'TRIGGERED_REMINDER_ADDED') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id && tabs[0].url) {
      await checkForNote(tabs[0].id, tabs[0].url);
    }
  }
  if (msg.type === 'REMINDER_CREATED' || msg.type === 'REMINDER_UPDATED') {
    alarmService.rescheduleAllReminders();
  }
  if (msg.type === 'REMINDER_DELETED') {
    alarmService.rescheduleAllReminders();
  }
  if (msg.type === 'OPEN_POPUP_FOR_EDIT' && msg.noteId) {
    // pendingEditNoteId already set by content script
    // Set the popup and show a visual indicator to the user
    await browser.browserAction.setPopup({ popup: 'popup/index.html' });
    
    // Show badge to indicate user should click the extension icon
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      await browser.browserAction.setBadgeText({ text: '✏️', tabId: tabs[0].id });
      await browser.browserAction.setBadgeBackgroundColor({ color: '#4a90d9', tabId: tabs[0].id });
      
      // Try to open popup (works in some contexts)
      try {
        await browser.browserAction.openPopup();
      } catch (e) {
        // openPopup() may fail if not in user gesture context
        // Badge will guide user to click the icon
        console.log('Could not auto-open popup, user should click extension icon');
      }
      
      // Clear badge and reset popup after 3 seconds
      setTimeout(async () => {
        if (tabs[0]?.url) {
          await checkForNote(tabs[0].id!, tabs[0].url);
        }
        await browser.browserAction.setPopup({ popup: '' });
      }, 3000);
    }
  }
  return undefined;
});

// Handle browser action clicks
// Android: Open mobile page in new tab
// Desktop: Open popup or toggle overlay

if (isAndroid()) {
  // Android: Simple click handler to open mobile page with current tab info
  browser.browserAction.onClicked.addListener(async (tab) => {
    // Pass the tab URL and title as parameters so mobile page knows what page to save
    const url = encodeURIComponent(tab.url || '');
    const title = encodeURIComponent(tab.title || '');
    const sourceTabId = typeof tab.id === 'number' ? `&sourceTabId=${tab.id}` : '';
    await browser.tabs.create({ 
      url: browser.runtime.getURL(`mobile/index.html?url=${url}&title=${title}${sourceTabId}`)
    });
  });
} else {
  // Desktop: Handle left-click (popup) and middle-click (overlay toggle)
  browser.browserAction.onClicked.addListener(async (tab, onClickData) => {
    if (onClickData && onClickData.button === 1) {
      // Middle-click: toggle overlay visibility
      const settings = await storageService.getSettings();
      const newOverlayState = !settings.notifications.overlay;
      
      await storageService.saveSettings({
        ...settings,
        notifications: {
          ...settings.notifications,
          overlay: newOverlayState,
        },
      });
      
      // Show feedback via badge
      if (newOverlayState) {
        await browser.browserAction.setBadgeText({ text: '👁️' });
        await browser.browserAction.setBadgeBackgroundColor({ color: '#4a90d9' });
      } else {
        await browser.browserAction.setBadgeText({ text: '🚫' });
        await browser.browserAction.setBadgeBackgroundColor({ color: '#999' });
      }
      
      // Clear badge after 2 seconds
      setTimeout(async () => {
        const [tabs] = await Promise.all([browser.tabs.query({ active: true, currentWindow: true })]);
        if (tabs[0]?.url) {
          await checkForNote(tabs[0].id!, tabs[0].url);
        }
      }, 2000);
    } else {
      // Left-click: open popup
      // Must set popup before opening, then clear it to allow onClicked to fire again
      await browser.browserAction.setPopup({ popup: 'popup/index.html' });
      await browser.browserAction.openPopup();
      // Clear popup so next click triggers onClicked again
      // Use setTimeout to ensure popup has opened first
      setTimeout(() => {
        browser.browserAction.setPopup({ popup: '' });
      }, 100);
    }
  });
}
