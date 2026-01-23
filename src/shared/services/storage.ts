import browser from 'webextension-polyfill';
import pako from 'pako';
import {
  StorageData,
  PageNote,
  TimeReminder,
  Category,
  Settings,
  TriggeredReminder,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
} from '../types';

const STORAGE_KEYS = {
  NOTES: 'notes',
  REMINDERS: 'reminders',
  CATEGORIES: 'categories',
  SETTINGS: 'settings',
  TRIGGERED_REMINDERS: 'triggeredReminders',
} as const;

type StorageArea = 'local' | 'sync';

class StorageService {
  private getStorage(area: StorageArea = 'local') {
    return area === 'sync' ? browser.storage.sync : browser.storage.local;
  }

  private async getStorageArea(): Promise<StorageArea> {
    const settings = await this.getSettings();
    return settings.syncEnabled ? 'sync' : 'local';
  }

  async initialize(): Promise<void> {
    const storage = this.getStorage('local');
    const data = await storage.get([
      STORAGE_KEYS.NOTES,
      STORAGE_KEYS.REMINDERS,
      STORAGE_KEYS.CATEGORIES,
      STORAGE_KEYS.SETTINGS,
    ]);

    if (!data[STORAGE_KEYS.CATEGORIES]) {
      await storage.set({ [STORAGE_KEYS.CATEGORIES]: DEFAULT_CATEGORIES });
    }
    if (!data[STORAGE_KEYS.SETTINGS]) {
      await storage.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    }
    if (!data[STORAGE_KEYS.NOTES]) {
      await storage.set({ [STORAGE_KEYS.NOTES]: [] });
    }
    if (!data[STORAGE_KEYS.REMINDERS]) {
      await storage.set({ [STORAGE_KEYS.REMINDERS]: [] });
    }
  }

  // Notes
  async getNotes(): Promise<PageNote[]> {
    const area = await this.getStorageArea();
    const storage = this.getStorage(area);
    const data = await storage.get(STORAGE_KEYS.NOTES);
    return (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
  }

  async saveNote(note: PageNote): Promise<void> {
    const notes = await this.getNotes();
    const index = notes.findIndex((n) => n.id === note.id);
    if (index >= 0) {
      notes[index] = note;
    } else {
      notes.push(note);
    }
    const area = await this.getStorageArea();
    await this.getStorage(area).set({ [STORAGE_KEYS.NOTES]: notes });
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.getNotes();
    const filtered = notes.filter((n) => n.id !== id);
    const area = await this.getStorageArea();
    await this.getStorage(area).set({ [STORAGE_KEYS.NOTES]: filtered });
  }

  async getNoteForUrl(url: string): Promise<PageNote | null> {
    const notes = await this.getNotesForUrl(url);
    return notes[0] || null;
  }

  async getNotesForUrl(url: string): Promise<PageNote[]> {
    const notes = await this.getNotes();
    return this.findMatchingNotes(notes, url);
  }

  private findMatchingNotes(notes: PageNote[], url: string): PageNote[] {
    const parsedUrl = new URL(url);
    const exactMatches: PageNote[] = [];
    const pathMatches: PageNote[] = [];
    const domainMatches: PageNote[] = [];

    for (const note of notes) {
      try {
        const noteUrl = new URL(note.url);
        switch (note.urlMatchType) {
          case 'exact':
            if (url === note.url) exactMatches.push(note);
            break;
          case 'path':
            if (
              parsedUrl.origin === noteUrl.origin &&
              parsedUrl.pathname === noteUrl.pathname
            ) {
              pathMatches.push(note);
            }
            break;
          case 'domain':
            if (parsedUrl.hostname === noteUrl.hostname) domainMatches.push(note);
            break;
        }
      } catch {
        continue;
      }
    }

    // Return all matches ordered: exact first, then path, then domain
    return [...exactMatches, ...pathMatches, ...domainMatches];
  }

  // Reminders
  async getReminders(): Promise<TimeReminder[]> {
    const area = await this.getStorageArea();
    const storage = this.getStorage(area);
    const data = await storage.get(STORAGE_KEYS.REMINDERS);
    return (data[STORAGE_KEYS.REMINDERS] as TimeReminder[]) || [];
  }

  async saveReminder(reminder: TimeReminder): Promise<void> {
    const reminders = await this.getReminders();
    const index = reminders.findIndex((r) => r.id === reminder.id);
    if (index >= 0) {
      reminders[index] = reminder;
    } else {
      reminders.push(reminder);
    }
    const area = await this.getStorageArea();
    await this.getStorage(area).set({ [STORAGE_KEYS.REMINDERS]: reminders });
  }

  async deleteReminder(id: string): Promise<void> {
    const reminders = await this.getReminders();
    const filtered = reminders.filter((r) => r.id !== id);
    const area = await this.getStorageArea();
    await this.getStorage(area).set({ [STORAGE_KEYS.REMINDERS]: filtered });
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    const area = await this.getStorageArea();
    const storage = this.getStorage(area);
    const data = await storage.get(STORAGE_KEYS.CATEGORIES);
    return (data[STORAGE_KEYS.CATEGORIES] as Category[]) || DEFAULT_CATEGORIES;
  }

  async saveCategory(category: Category): Promise<void> {
    const categories = await this.getCategories();
    const index = categories.findIndex((c) => c.id === category.id);
    if (index >= 0) {
      categories[index] = category;
    } else {
      categories.push(category);
    }
    const area = await this.getStorageArea();
    await this.getStorage(area).set({ [STORAGE_KEYS.CATEGORIES]: categories });
  }

  async deleteCategory(id: string): Promise<void> {
    const categories = await this.getCategories();
    const filtered = categories.filter((c) => c.id !== id);
    const area = await this.getStorageArea();
    await this.getStorage(area).set({ [STORAGE_KEYS.CATEGORIES]: filtered });
  }

  async categoryExists(name: string): Promise<boolean> {
    const categories = await this.getCategories();
    return categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  // Settings
  async getSettings(): Promise<Settings> {
    const storage = this.getStorage('local');
    const data = await storage.get(STORAGE_KEYS.SETTINGS);
    return (data[STORAGE_KEYS.SETTINGS] as Settings) || DEFAULT_SETTINGS;
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.getStorage('local').set({ [STORAGE_KEYS.SETTINGS]: settings });
  }

  async setSyncEnabled(enabled: boolean): Promise<void> {
    const settings = await this.getSettings();
    const oldArea = settings.syncEnabled ? 'sync' : 'local';
    const newArea = enabled ? 'sync' : 'local';

    if (oldArea !== newArea) {
      // Migrate data to new storage area
      const [notes, reminders, categories] = await Promise.all([
        this.getNotes(),
        this.getReminders(),
        this.getCategories(),
      ]);

      await this.getStorage(newArea).set({
        [STORAGE_KEYS.NOTES]: notes,
        [STORAGE_KEYS.REMINDERS]: reminders,
        [STORAGE_KEYS.CATEGORIES]: categories,
      });
    }

    settings.syncEnabled = enabled;
    await this.saveSettings(settings);
  }

  // Triggered Reminders
  async getTriggeredReminders(): Promise<TriggeredReminder[]> {
    const storage = this.getStorage('local');
    const data = await storage.get(STORAGE_KEYS.TRIGGERED_REMINDERS);
    return (data[STORAGE_KEYS.TRIGGERED_REMINDERS] as TriggeredReminder[]) || [];
  }

  async addTriggeredReminder(triggered: TriggeredReminder): Promise<void> {
    const reminders = await this.getTriggeredReminders();
    reminders.push(triggered);
    await this.getStorage('local').set({ [STORAGE_KEYS.TRIGGERED_REMINDERS]: reminders });
  }

  async dismissTriggeredReminder(id: string): Promise<void> {
    const reminders = await this.getTriggeredReminders();
    const filtered = reminders.filter((r) => r.id !== id);
    await this.getStorage('local').set({ [STORAGE_KEYS.TRIGGERED_REMINDERS]: filtered });
  }

  async clearAllTriggeredReminders(): Promise<void> {
    await this.getStorage('local').set({ [STORAGE_KEYS.TRIGGERED_REMINDERS]: [] });
  }

  // Get all data
  async getAllData(): Promise<StorageData> {
    const [notes, reminders, categories, settings, triggeredReminders] = await Promise.all([
      this.getNotes(),
      this.getReminders(),
      this.getCategories(),
      this.getSettings(),
      this.getTriggeredReminders(),
    ]);
    return { notes, reminders, categories, settings, triggeredReminders };
  }

  // Import/Export
  async exportData(): Promise<string> {
    const data = await this.getAllData();
    return JSON.stringify(data, null, 2);
  }

  async importData(jsonString: string): Promise<void> {
    const data = JSON.parse(jsonString) as StorageData;
    const area = await this.getStorageArea();
    const storage = this.getStorage(area);

    await storage.set({
      [STORAGE_KEYS.NOTES]: data.notes || [],
      [STORAGE_KEYS.REMINDERS]: data.reminders || [],
      [STORAGE_KEYS.CATEGORIES]: data.categories || DEFAULT_CATEGORIES,
    });

    if (data.settings) {
      await this.saveSettings(data.settings);
    }
  }

  // Compression utilities
  compressData(data: string): Uint8Array {
    return pako.deflate(data);
  }

  decompressData(compressed: Uint8Array): string {
    return pako.inflate(compressed, { to: 'string' });
  }

  async getStorageStats(): Promise<{ rawBytes: number; compressedBytes: number }> {
    const data = await this.exportData();
    const rawBytes = new Blob([data]).size;
    const compressed = this.compressData(data);
    const compressedBytes = compressed.length;
    return { rawBytes, compressedBytes };
  }
}

export const storageService = new StorageService();
