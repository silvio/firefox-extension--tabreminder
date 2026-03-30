export type UrlMatchType = 'exact' | 'path' | 'domain' | 'regex';

export interface Category {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  webdavSync?: boolean;
  lastSyncTime?: number;
  updatedAt?: number;
}

export interface PageNote {
  id: string;
  url: string;
  urlMatchType: UrlMatchType;
  title: string;
  content: string;
  categoryId: string | null;
  createdAt: number;
  updatedAt: number;
  version?: number; // Monotonic counter for deterministic sync conflict resolution
  // Optional reminder fields
  hasReminder?: boolean;
  scheduleType?: ScheduleType;
  scheduledTime?: number | null;
  recurringPattern?: RecurringPattern | null;
  nextTrigger?: number;
  // Soft delete fields
  deleted?: boolean;
  deletedAt?: number;
  // Hard-delete tombstone fields (after Empty Trash)
  hardDeleted?: boolean;
  hardDeletedAt?: number;
}

export type ScheduleType = 'once' | 'recurring';

export type FrequencyType = 'seconds' | 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type EndCondition =
  | { type: 'never' }
  | { type: 'date'; endDate: number }
  | { type: 'count'; occurrences: number };

export interface RecurringPattern {
  frequency: FrequencyType;
  interval: number;
  weekdays?: number[];       // 0=Sun, 1=Mon, ..., 6=Sat (for weekly)
  dayOfMonth?: number;       // 1-31 (for monthly "on day X")
  weekdayOrdinal?: { ordinal: number; weekday: number }; // e.g. {ordinal: 2, weekday: 1} = 2nd Monday
  endCondition: EndCondition;
  exceptions?: number[];     // timestamps of excluded dates
  timeOfDay?: { hour: number; minute: number }; // Time to trigger (default: current time)
}

export interface TimeReminder {
  id: string;
  url: string;
  title: string;
  scheduleType: ScheduleType;
  scheduledTime: number | null;
  recurringPattern: RecurringPattern | null;
  nextTrigger: number;
  categoryId: string | null;
  createdAt: number;
}

export interface OverlayStyle {
  backgroundColor: string;
  borderColor: string;
  borderWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  timeout?: number; // 0 = no timeout, milliseconds
  opacity?: number; // 0.1 to 1.0, default 1.0
}

export interface NotificationSettings {
  system: boolean;
  overlay: boolean;
  badge: boolean;
  overlayStyle: OverlayStyle;
}

// Settings that sync via Firefox Account (browser.storage.sync)
// These are safe to sync across devices
export interface SyncedSettings {
  syncEnabled: boolean;
  notifications: NotificationSettings;
  preselectLastCategory: boolean;
  popupHeight: number;
  editViewMode: 'tab' | 'modal';
  webdavUrl?: string; // URL syncs so same server on all devices
  webdavEnabled?: boolean; // Enabled state syncs
  categoryColors?: { [categoryId: string]: string }; // Category colors sync across devices
  recurringPreviewCount?: number; // Number of upcoming occurrences shown in recurring editor
}

// Settings stored locally only (browser.storage.local)
// These contain sensitive data and should NOT sync
export interface LocalSettings {
  lastDeleteAllTimestamp?: number;
  lastUsedCategoryId?: string; // Last used category for new-note preselection (per-device)
  webdavUsername?: string; // Credentials are per-device
  webdavPassword?: string; // NEVER sync passwords!
  webdavBasePath?: string; // Paths are per-device
  webdavSyncInterval?: number; // Intervals are per-device
  webdavLastSync?: number; // Sync state is per-device
  webdavSyncErrors?: string | { message: string; timestamp: number }; // Errors with timestamp
}

// Combined settings interface for backwards compatibility
export interface Settings extends SyncedSettings, LocalSettings {}

export interface WebDAVOutboxEntry {
  categoryId: string;
  attempts: number;
  nextAttemptAt: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export type WebDAVOutboxState = Record<string, WebDAVOutboxEntry>;


export interface CategoryFile {
  version: number;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  notes: PageNote[];
  lastModified: number;
}

export interface TriggeredReminder {
  id: string;
  reminderId: string;
  url: string;
  title: string;
  triggeredAt: number;
  dismissed: boolean;
}

export interface StorageData {
  notes: PageNote[];
  reminders: TimeReminder[];
  categories: Category[];
  settings: Settings;
  triggeredReminders: TriggeredReminder[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'work', name: 'Work', color: '#4a90d9', isDefault: true },
  { id: 'personal', name: 'Personal', color: '#7cb342', isDefault: true },
  { id: 'shopping', name: 'Shopping', color: '#ff9800', isDefault: true },
  { id: 'important', name: 'Important', color: '#e53935', isDefault: true },
];

export const DEFAULT_SETTINGS: Settings = {
  syncEnabled: false,
  notifications: {
    system: true,
    overlay: true,
    badge: true,
    overlayStyle: {
      backgroundColor: '#000000',
      borderColor: '#e53935',
      borderWidth: 2,
      fontSize: 14,
      fontFamily: 'system-ui, sans-serif',
      timeout: 0,
      opacity: 1.0,
    },
  },
  preselectLastCategory: false,
  popupHeight: 600,
  editViewMode: 'tab',
  recurringPreviewCount: 5,
};
