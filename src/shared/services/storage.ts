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
  CategoryFile,
} from '../types';
import { webdavService, WebDAVAuthError, WebDAVNetworkError } from './webdav';
import { alarmService } from './alarms';

const STORAGE_KEYS = {
  NOTES: 'notes',
  REMINDERS: 'reminders',
  CATEGORIES: 'categories',
  SETTINGS: 'settings',
  TRIGGERED_REMINDERS: 'triggeredReminders',
} as const;

type StorageArea = 'local' | 'sync';

class StorageService {
  private webdavSyncTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private autoSyncInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.migrateSettings();
  }
  
  // Migration: Move WebDAV credentials from sync storage to local storage
  private async migrateSettings(): Promise<void> {
    try {
      // Check if migration already done
      const migrationData = await browser.storage.local.get('settings_migrated_v2');
      if (migrationData['settings_migrated_v2']) {
        return; // Already migrated
      }
      
      // Get old settings from sync storage (may contain credentials)
      const syncData = await browser.storage.sync.get(STORAGE_KEYS.SETTINGS);
      const oldSettings = syncData[STORAGE_KEYS.SETTINGS] as Settings | undefined;
      
      if (oldSettings && (oldSettings.webdavUsername || oldSettings.webdavPassword)) {
        console.log('Migrating WebDAV credentials from sync to local storage...');
        
        // Extract credentials
        const credentials: Partial<Settings> = {
          webdavUsername: oldSettings.webdavUsername,
          webdavPassword: oldSettings.webdavPassword,
          webdavBasePath: oldSettings.webdavBasePath,
          webdavSyncInterval: oldSettings.webdavSyncInterval,
          webdavLastSync: oldSettings.webdavLastSync,
          webdavSyncErrors: oldSettings.webdavSyncErrors,
          lastDeleteAllTimestamp: oldSettings.lastDeleteAllTimestamp
        };
        
        // Save credentials to local storage
        await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: credentials });
        
        // Remove credentials from sync storage (keep URL and enabled flag)
        const syncedOnly: Partial<Settings> = {
          syncEnabled: oldSettings.syncEnabled,
          notifications: oldSettings.notifications,
          preselectLastCategory: oldSettings.preselectLastCategory,
          popupHeight: oldSettings.popupHeight,
          webdavUrl: oldSettings.webdavUrl,
          webdavEnabled: oldSettings.webdavEnabled
        };
        await browser.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: syncedOnly });
        
        // Mark migration as complete
        await browser.storage.local.set({ 'settings_migrated_v2': true });
        console.log('Migration complete: WebDAV credentials moved to local storage');
      } else {
        // No credentials to migrate, just mark as done
        await browser.storage.local.set({ 'settings_migrated_v2': true });
      }
    } catch (error) {
      console.error('Error migrating settings:', error);
      // Don't fail if migration errors - settings will still work
    }
  }

  // Migration v3: Extract category colors to synced settings
  private async migrateCategoryColors(): Promise<void> {
    try {
      const migrated = await browser.storage.local.get('settings_migrated_v3');
      if (migrated.settings_migrated_v3) {
        return; // Already migrated
      }

      const categories = await this.getCategories();
      const settings = await this.getSettings();
      
      // Extract colors from categories into synced settings
      if (categories.length > 0) {
        const categoryColors: { [key: string]: string } = {};
        categories.forEach(cat => {
          categoryColors[cat.id] = cat.color;
        });
        
        settings.categoryColors = categoryColors;
        await this.saveSettings(settings);
        console.log('Migration complete: Category colors added to synced settings');
      }
      
      await browser.storage.local.set({ 'settings_migrated_v3': true });
    } catch (error) {
      console.error('Error migrating category colors:', error);
    }
  }

  // Apply synced category colors to local categories
  private async applySyncedCategoryColors(): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (!settings.categoryColors) {
        return; // No synced colors
      }

      const categories = await this.getCategories();
      let modified = false;

      for (const category of categories) {
        const syncedColor = settings.categoryColors[category.id];
        if (syncedColor && syncedColor !== category.color) {
          category.color = syncedColor;
          modified = true;
        }
      }

      if (modified) {
        await browser.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });
        console.log('Applied synced category colors');
      }
    } catch (error) {
      console.error('Error applying synced category colors:', error);
    }
  }

  // Migrate categories to have updatedAt timestamp
  private async migrateCategoryUpdatedAt(): Promise<void> {
    try {
      const categories = await this.getCategories();
      let modified = false;
      const now = Date.now();

      for (const category of categories) {
        if (!category.updatedAt) {
          category.updatedAt = now;
          modified = true;
        }
      }

      if (modified) {
        await browser.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });
        console.log('Migration: Initialized updatedAt for existing categories');
      }
    } catch (error) {
      console.error('Error migrating category updatedAt:', error);
    }
  }

  private getStorage(area: StorageArea = 'local') {
    return area === 'sync' ? browser.storage.sync : browser.storage.local;
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
    
    // Run migrations
    await this.migrateRemindersToNotes();
    await this.backfillUpdatedAtTimestamps();
    await this.backfillDeletedFlag();
    await this.migrateSettings();
    await this.migrateCategoryColors();
    await this.migrateCategoryUpdatedAt();
    await this.applySyncedCategoryColors();

    // Clean up old deleted notes based on lastDeleteAllTimestamp
    await this.cleanupOldDeletedNotes();

    // Start WebDAV auto-sync if enabled
    const settings = await this.getSettings();
    if (settings.webdavEnabled) {
      await this.startAutoSync();
    }
  }


  // Migration v1: Convert standalone reminders to notes with reminders
  async migrateRemindersToNotes(): Promise<void> {
    const storage = this.getStorage('local');
    const data = await storage.get(['migrationVersion', STORAGE_KEYS.REMINDERS, STORAGE_KEYS.NOTES]);
    
    // Check if migration already done
    const migrationVersion = (data.migrationVersion as number) || 0;
    if (migrationVersion >= 1) {
      return;
    }
    
    const reminders = (data[STORAGE_KEYS.REMINDERS] as TimeReminder[]) || [];
    const notes = (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
    
    // Convert each reminder to a note with reminder fields
    for (const reminder of reminders) {
      // Check if a note with this reminder already exists (by checking if URL/title match)
      const existingNote = notes.find(n => 
        n.url === reminder.url && 
        n.title === reminder.title && 
        n.hasReminder
      );
      
      if (!existingNote) {
        // Create a new note from the reminder
        const noteFromReminder: PageNote = {
          id: reminder.id,
          url: reminder.url,
          urlMatchType: 'exact', // Reminders were always exact match
          title: reminder.title,
          content: '', // Reminders didn't have content
          categoryId: reminder.categoryId,
          createdAt: reminder.createdAt,
          updatedAt: Date.now(),
          hasReminder: true,
          scheduleType: reminder.scheduleType,
          scheduledTime: reminder.scheduledTime,
          recurringPattern: reminder.recurringPattern,
          nextTrigger: reminder.nextTrigger,
        };
        notes.push(noteFromReminder);
      }
    }
    
    // Save migrated notes and mark migration as complete
    await storage.set({ 
      [STORAGE_KEYS.NOTES]: notes,
      migrationVersion: 1
    });
    
    console.log(`Migrated ${reminders.length} reminders to notes with reminders`);
  }

  // Migration v2: Backfill updatedAt for existing notes
  async backfillUpdatedAtTimestamps(): Promise<void> {
    const storage = this.getStorage('local');
    const data = await storage.get(['migrationVersion', STORAGE_KEYS.NOTES]);

    // Check if migration v2 already done
    const migrationVersion = (data.migrationVersion as number) || 0;
    if (migrationVersion >= 2) {
      return;
    }

    const notes = (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
    let backfilled = 0;

    // Backfill updatedAt for notes that don't have it
    for (const note of notes) {
      if (!note.updatedAt || note.updatedAt === 0) {
        note.updatedAt = note.createdAt || Date.now();
        backfilled++;
      }
    }

    // Save updated notes and mark migration v2 as complete
    await storage.set({
      [STORAGE_KEYS.NOTES]: notes,
      migrationVersion: 2
    });

    console.log(`Migration v2: Backfilled updatedAt for ${backfilled} notes`);
  }

  // Migration v3: Backfill deleted flag for existing notes
  async backfillDeletedFlag(): Promise<void> {
    const storage = this.getStorage('local');
    const data = await storage.get(['migrationVersion', STORAGE_KEYS.NOTES]);

    // Check if migration v3 already done
    const migrationVersion = (data.migrationVersion as number) || 0;
    if (migrationVersion >= 3) {
      return;
    }

    const notes = (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
    let backfilled = 0;

    // Backfill deleted flag for notes that don't have it
    for (const note of notes) {
      if (note.deleted === undefined) {
        note.deleted = false;
        backfilled++;
      }
    }

    // Save updated notes and mark migration v3 as complete
    await storage.set({
      [STORAGE_KEYS.NOTES]: notes,
      migrationVersion: 3
    });

    console.log(`Migration v3: Backfilled deleted flag for ${backfilled} notes`);
  }

  // Notes
  async getNotes(): Promise<PageNote[]> {
    // ALWAYS read from local storage - local is source of truth
    const storage = this.getStorage('local');
    const data = await storage.get(STORAGE_KEYS.NOTES);
    const allNotes = (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
    // Filter out deleted notes by default
    return allNotes.filter(note => !note.deleted);
  }

  async getDeletedNotes(): Promise<PageNote[]> {
    // ALWAYS read from local storage
    const storage = this.getStorage('local');
    const data = await storage.get(STORAGE_KEYS.NOTES);
    const allNotes = (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
    return allNotes.filter(note => note.deleted === true);
  }

  private async getAllNotesIncludingDeleted(): Promise<PageNote[]> {
    // ALWAYS read from local storage
    const storage = this.getStorage('local');
    const data = await storage.get(STORAGE_KEYS.NOTES);
    return (data[STORAGE_KEYS.NOTES] as PageNote[]) || [];
  }

  async saveNote(note: PageNote): Promise<void> {
    const notes = await this.getAllNotesIncludingDeleted();
    const index = notes.findIndex((n) => n.id === note.id);
    if (index >= 0) {
      notes[index] = note;
    } else {
      notes.push(note);
    }
    
    // Write to local storage (source of truth)
    await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: notes });

    // Schedule alarm if note has a reminder
    if (note.hasReminder && note.nextTrigger) {
      await alarmService.scheduleNoteReminder(note);
    } else if (note.hasReminder === false) {
      // Cancel alarm if reminder was removed
      await alarmService.cancelNoteReminder(note.id);
    }

    // Trigger WebDAV sync for this note's category
    this.debouncedWebDAVSync(note.categoryId);
  }

  async deleteNote(id: string): Promise<void> {
    const notes = await this.getAllNotesIncludingDeleted();
    const note = notes.find((n) => n.id === id);
    if (note) {
      // Cancel any reminder alarm
      if (note.hasReminder) {
        await alarmService.cancelNoteReminder(note.id);
      }

      // Soft delete: mark as deleted and clear all content
      note.deleted = true;
      note.deletedAt = Date.now();
      note.content = '';
      note.title = '';
      note.url = '';
      note.urlMatchType = 'exact';
      const categoryId = note.categoryId;
      note.categoryId = null;
      note.hasReminder = false;
      note.scheduleType = undefined;
      note.scheduledTime = undefined;
      note.recurringPattern = undefined;
      note.nextTrigger = undefined;
      
      // Write to local storage
      await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: notes });

      // Trigger WebDAV sync for this note's category
      this.debouncedWebDAVSync(categoryId);
    }
  }

  async permanentlyDeleteNote(id: string): Promise<void> {
    const notes = await this.getAllNotesIncludingDeleted();
    const note = notes.find(n => n.id === id);
    const categoryId = note?.categoryId;
    const filtered = notes.filter((n) => n.id !== id);
    
    // Write to local storage
    await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: filtered });

    // Trigger WebDAV sync
    this.debouncedWebDAVSync(categoryId);
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
    const regexMatches: PageNote[] = [];

    for (const note of notes) {
      try {
        if (note.urlMatchType === 'regex') {
          // For regex, note.url contains the regex pattern
          try {
            const regex = new RegExp(note.url);
            if (regex.test(url)) {
              regexMatches.push(note);
            }
          } catch (e) {
            console.error('Invalid regex pattern in note:', note.url, e);
          }
        } else {
          // For other types, parse as URL
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
        }
      } catch {
        continue;
      }
    }

    // Return all matches ordered: exact first, then path, then domain, then regex
    return [...exactMatches, ...pathMatches, ...domainMatches, ...regexMatches];
  }

  // Reminders
  async getReminders(): Promise<TimeReminder[]> {
    // Now get reminders from notes that have hasReminder = true
    const notes = await this.getNotes();
    return notes
      .filter(note => note.hasReminder && note.nextTrigger !== undefined)
      .map(note => ({
        id: note.id,
        url: note.url,
        title: note.title,
        scheduleType: note.scheduleType!,
        scheduledTime: note.scheduledTime ?? null,
        recurringPattern: note.recurringPattern ?? null,
        nextTrigger: note.nextTrigger!,
        categoryId: note.categoryId,
        createdAt: note.createdAt,
      }));
  }

  async saveReminder(reminder: TimeReminder): Promise<void> {
    // Convert reminder to note with reminder fields
    const notes = await this.getNotes();
    const existingNote = notes.find(n => n.id === reminder.id);
    
    const noteWithReminder: PageNote = {
      id: reminder.id,
      url: reminder.url,
      urlMatchType: existingNote?.urlMatchType || 'exact',
      title: reminder.title,
      content: existingNote?.content || '',
      categoryId: reminder.categoryId,
      createdAt: existingNote?.createdAt || reminder.createdAt,
      updatedAt: Date.now(),
      hasReminder: true,
      scheduleType: reminder.scheduleType,
      scheduledTime: reminder.scheduledTime,
      recurringPattern: reminder.recurringPattern,
      nextTrigger: reminder.nextTrigger,
    };
    
    await this.saveNote(noteWithReminder);
  }

  async deleteReminder(id: string): Promise<void> {
    // Remove reminder fields from note, or delete note if it has no content
    const notes = await this.getNotes();
    const note = notes.find(n => n.id === id);
    
    if (note) {
      if (!note.content || note.content.trim() === '') {
        // No content, delete the note entirely
        await this.deleteNote(id);
      } else {
        // Has content, just remove reminder fields
        const updatedNote: PageNote = {
          ...note,
          hasReminder: false,
          scheduleType: undefined,
          scheduledTime: undefined,
          recurringPattern: undefined,
          nextTrigger: undefined,
          updatedAt: Date.now(),
        };
        await this.saveNote(updatedNote);
      }
    }
  }

  // Categories
  async getCategories(): Promise<Category[]> {
    // ALWAYS read from local storage
    const storage = this.getStorage('local');
    const data = await storage.get(STORAGE_KEYS.CATEGORIES);
    return (data[STORAGE_KEYS.CATEGORIES] as Category[]) || DEFAULT_CATEGORIES;
  }

  async getCategoryById(id: string): Promise<Category | null> {
    const categories = await this.getCategories();
    return categories.find(c => c.id === id) || null;
  }

  async saveCategory(category: Category): Promise<void> {
    // Set updatedAt timestamp
    const previousUpdatedAt = category.updatedAt;
    category.updatedAt = Date.now();
    console.log(`Storage: Saving category "${category.name}" (color: ${category.color}, updatedAt: ${new Date(category.updatedAt).toISOString()}, previous: ${previousUpdatedAt ? new Date(previousUpdatedAt).toISOString() : 'none'})`);
    
    const categories = await this.getCategories();
    const index = categories.findIndex((c) => c.id === category.id);
    if (index >= 0) {
      categories[index] = category;
    } else {
      categories.push(category);
    }
    
    // Write to local storage
    await browser.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });

    // Sync category color to settings
    const settings = await this.getSettings();
    if (!settings.categoryColors) {
      settings.categoryColors = {};
    }
    settings.categoryColors[category.id] = category.color;
    await this.saveSettings(settings);

    // Trigger WebDAV sync for this category
    this.debouncedWebDAVSync(category.id);
  }

  async deleteCategory(id: string, deleteFromWebDAV: boolean = true): Promise<void> {
    const categories = await this.getCategories();
    const category = categories.find(c => c.id === id);
    const filtered = categories.filter((c) => c.id !== id);
    
    // Delete all notes in this category
    const allNotes = await this.getAllNotesIncludingDeleted();
    const notesAfterDelete = allNotes.filter(n => n.categoryId !== id);
    
    // Write to local storage
    await browser.storage.local.set({ 
      [STORAGE_KEYS.CATEGORIES]: filtered,
      [STORAGE_KEYS.NOTES]: notesAfterDelete
    });

    // Delete WebDAV file for this category
    if (category && deleteFromWebDAV) {
      const webSettings = await this.getSettings();
      if (webSettings.webdavEnabled && webSettings.webdavUrl && webSettings.webdavUsername && webSettings.webdavPassword) {
        try {
          webdavService.initClient(
            webSettings.webdavUrl,
            webSettings.webdavUsername,
            webSettings.webdavPassword,
            webSettings.webdavBasePath || '/TabReminder/'
          );
          const filename = webdavService.buildFilename(category.name);
          await webdavService.deleteFile(filename);
        } catch (error) {
          console.error('WebDAV delete file error:', error);
          throw error; // Re-throw so UI can show error
        }
      }
    }
  }

  async categoryExists(name: string): Promise<boolean> {
    const categories = await this.getCategories();
    return categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  }

  // Settings
  async getSettings(): Promise<Settings> {
    // Get both synced and local settings
    const syncedData = await browser.storage.sync.get(STORAGE_KEYS.SETTINGS);
    const localData = await browser.storage.local.get(STORAGE_KEYS.SETTINGS);
    
    const syncedSettings = syncedData[STORAGE_KEYS.SETTINGS] || {};
    const localSettings = localData[STORAGE_KEYS.SETTINGS] || {};
    
    // Merge: local settings override synced if both exist (for migration)
    return {
      ...DEFAULT_SETTINGS,
      ...syncedSettings,
      ...localSettings
    };
  }

  async saveSettings(settings: Settings): Promise<void> {
    // Split settings into synced and local
    const syncedSettings: Partial<Settings> = {
      syncEnabled: settings.syncEnabled,
      notifications: settings.notifications,
      preselectLastCategory: settings.preselectLastCategory,
      popupHeight: settings.popupHeight,
      webdavUrl: settings.webdavUrl,
      webdavEnabled: settings.webdavEnabled
    };
    
    const localSettings: Partial<Settings> = {
      lastDeleteAllTimestamp: settings.lastDeleteAllTimestamp,
      webdavUsername: settings.webdavUsername,
      webdavPassword: settings.webdavPassword,
      webdavBasePath: settings.webdavBasePath,
      webdavSyncInterval: settings.webdavSyncInterval,
      webdavLastSync: settings.webdavLastSync,
      webdavSyncErrors: settings.webdavSyncErrors
    };
    
    // Write synced settings to sync storage (Firefox Account)
    await browser.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: syncedSettings });
    
    // Write local settings to local storage (per-device, includes credentials)
    await browser.storage.local.set({ [STORAGE_KEYS.SETTINGS]: localSettings });
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
    const storage = this.getStorage('local');

    await storage.set({
      [STORAGE_KEYS.NOTES]: data.notes || [],
      [STORAGE_KEYS.REMINDERS]: data.reminders || [],
      [STORAGE_KEYS.CATEGORIES]: data.categories || DEFAULT_CATEGORIES,
    });

    if (data.settings) {
      await this.saveSettings(data.settings);
    }
  }

  // Permanently delete all notes marked as deleted
  async deleteAllTrash(): Promise<void> {
    const notes = await this.getAllNotesIncludingDeleted();
    const filtered = notes.filter((n) => !n.deleted);
    
    // Write to local storage
    await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: filtered });

    // Update lastDeleteAllTimestamp in settings
    const settings = await this.getSettings();
    settings.lastDeleteAllTimestamp = Date.now();
    await this.saveSettings(settings);

    console.log(`Permanently deleted all trash. Remaining notes: ${filtered.length}`);
  }

  // Clean up deleted notes older than lastDeleteAllTimestamp (for sync cleanup)
  async cleanupOldDeletedNotes(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.lastDeleteAllTimestamp) {
      return; // No cleanup timestamp set yet
    }

    const notes = await this.getAllNotesIncludingDeleted();
    const filtered = notes.filter((n) => {
      // Keep non-deleted notes
      if (!n.deleted) return true;
      // Remove deleted notes older than lastDeleteAllTimestamp
      if (n.deletedAt && n.deletedAt < settings.lastDeleteAllTimestamp!) {
        return false;
      }
      return true;
    });

    // Write to local storage
    await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: filtered });

    console.log(`Cleaned up old deleted notes. Remaining notes: ${filtered.length}`);
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

  // Force push current data to sync storage

  // ============================================
  // WebDAV Sync Methods
  // ============================================

  // Public method to trigger WebDAV sync from any context (e.g., background script)
  public triggerWebDAVSync(categoryId: string | null | undefined): void {
    this.debouncedWebDAVSync(categoryId);
  }

  // Public method for immediate sync (no debounce) - used when popup is about to close
  public async triggerWebDAVSyncImmediate(categoryId: string | null | undefined): Promise<void> {
    if (!categoryId) return;
    
    // Cancel any pending debounced sync for this category
    const existing = this.webdavSyncTimeouts.get(categoryId);
    if (existing) {
      clearTimeout(existing);
      this.webdavSyncTimeouts.delete(categoryId);
    }
    
    // Sync immediately
    await this.syncCategoryToWebDAV(categoryId);
  }

  private debouncedWebDAVSync(categoryId: string | null | undefined): void {
    if (!categoryId) return;

    const existing = this.webdavSyncTimeouts.get(categoryId);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(async () => {
      this.webdavSyncTimeouts.delete(categoryId);
      await this.syncCategoryToWebDAV(categoryId);
    }, 2000);

    this.webdavSyncTimeouts.set(categoryId, timeout);
  }

  private async syncCategoryToWebDAV(categoryId: string | null): Promise<void> {
    if (!categoryId) return;

    try {
      console.log('WebDAV: Starting push for category', categoryId);
      const settings = await this.getSettings();
      if (!settings.webdavEnabled || !settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
        console.log('WebDAV: Push skipped - WebDAV not configured');
        return;
      }

      webdavService.initClient(
        settings.webdavUrl,
        settings.webdavUsername,
        settings.webdavPassword,
        settings.webdavBasePath || '/TabReminder/'
      );

      const category = await this.getCategoryById(categoryId);
      if (!category) {
        console.log('WebDAV: Push skipped - category not found', categoryId);
        return;
      }

      // Skip if category doesn't have WebDAV sync enabled
      if (!category.webdavSync) {
        console.log(`WebDAV: Category "${category.name}" has WebDAV sync disabled, skipping`);
        return;
      }

      const notes = await this.getAllNotesIncludingDeleted();
      const categoryNotes = notes.filter(n => n.categoryId === categoryId);

      console.log(`WebDAV: Pushing category "${category.name}" with ${categoryNotes.length} notes (color: ${category.color}, updatedAt: ${category.updatedAt ? new Date(category.updatedAt).toISOString() : 'none'})`);

      const categoryFile: CategoryFile = {
        version: 1,
        categoryId: category.id,
        categoryName: category.name,
        categoryColor: category.color,
        notes: categoryNotes,
        lastModified: category.updatedAt || Date.now(),
      };

      console.log(`WebDAV: CategoryFile to push:`, {
        categoryColor: categoryFile.categoryColor,
        lastModified: new Date(categoryFile.lastModified).toISOString(),
        notesCount: categoryFile.notes.length
      });

      // Use UUID-based filename
      const filename = webdavService.buildFilename(category.id);
      await webdavService.putFile(filename, categoryFile);
      
      // Clean up old name-based file if it exists (migration)
      try {
        const oldFilename = webdavService.buildOldFilename(category.name);
        if (oldFilename !== filename) {
          await webdavService.deleteFile(oldFilename);
          console.log(`WebDAV: Cleaned up old file ${oldFilename}`);
        }
      } catch (error) {
        // Ignore errors - old file might not exist
        console.log(`WebDAV: No old file to clean up (expected during migration)`);
      }

      console.log(`WebDAV: Pushed category "${category.name}" to ${filename}`);
      
      // Update last sync timestamp on category
      category.lastSyncTime = Date.now();
      const categories = await this.getCategories();
      const index = categories.findIndex(c => c.id === categoryId);
      if (index >= 0) {
        categories[index] = category;
        await browser.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });
      }
      
      // Update global last sync timestamp
      const updatedSettings = await this.getSettings();
      updatedSettings.webdavLastSync = Date.now();
      await this.saveSettings(updatedSettings);
    } catch (error) {
      console.error('WebDAV push error:', error);
      await this.saveWebDAVError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private async syncCategoryFromWebDAV(categoryId: string): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (!settings.webdavEnabled || !settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
        return;
      }

      webdavService.initClient(
        settings.webdavUrl,
        settings.webdavUsername,
        settings.webdavPassword,
        settings.webdavBasePath || '/TabReminder/'
      );

      const category = await this.getCategoryById(categoryId);
      if (!category) return;

      // Skip if category doesn't have WebDAV sync enabled
      if (!category.webdavSync) {
        return;
      }

      const filename = webdavService.buildFilename(categoryId);
      const remoteFile = await webdavService.getFile(filename);

      if (!remoteFile) return;

      if (remoteFile.categoryId !== categoryId) {
        console.warn(`WebDAV: Category ID mismatch in ${filename}`);
        return;
      }

      // Update category with remote data based on timestamps
      let categoryUpdated = false;
      let colorWasUpdated = false;
      
      // Check if remote is newer than local
      const localUpdatedAt = category.updatedAt || 0;
      const remoteUpdatedAt = remoteFile.lastModified || 0;
      
      if (remoteUpdatedAt > localUpdatedAt) {
        // Remote is newer, apply changes
        console.log(`WebDAV: Remote category is newer (${new Date(remoteUpdatedAt).toISOString()} > ${new Date(localUpdatedAt).toISOString()})`);
        
        // Apply remote category color if different
        if (remoteFile.categoryColor && remoteFile.categoryColor !== category.color) {
          console.log(`WebDAV: Updating category color from ${category.color} to ${remoteFile.categoryColor}`);
          category.color = remoteFile.categoryColor;
          categoryUpdated = true;
          colorWasUpdated = true;
        }
        
        // Update updatedAt to match remote
        category.updatedAt = remoteUpdatedAt;
        categoryUpdated = true;
      } else if (remoteUpdatedAt === localUpdatedAt) {
        // Same timestamp, no conflict
        console.log(`WebDAV: Remote and local are in sync (${new Date(remoteUpdatedAt).toISOString()})`);
      } else {
        // Local is newer, don't apply remote changes
        console.log(`WebDAV: Local category is newer (${new Date(localUpdatedAt).toISOString()} > ${new Date(remoteUpdatedAt).toISOString()}), skipping remote changes`);
      }

      // Always update last sync timestamp
      category.lastSyncTime = Date.now();
      categoryUpdated = true;

      // Save updated category if any changes were made
      if (categoryUpdated) {
        const categories = await this.getCategories();
        const index = categories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          categories[index] = category;
          await browser.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });
        }

        // Also update category color in Firefox Sync settings if color was changed
        if (colorWasUpdated && remoteFile.categoryColor) {
          const settings = await this.getSettings();
          if (!settings.categoryColors) {
            settings.categoryColors = {};
          }
          settings.categoryColors[category.id] = category.color;
          await this.saveSettings(settings);
          console.log('WebDAV: Synced category color to Firefox Sync settings');
        }
      }

      // Merge notes
      const localNotes = await this.getAllNotesIncludingDeleted();
      const localCategoryNotes = localNotes.filter(n => n.categoryId === categoryId);

      const merged = this.mergeCategoryNotes(localCategoryNotes, remoteFile.notes);

      const otherNotes = localNotes.filter(n => n.categoryId !== categoryId);
      const allNotes = [...otherNotes, ...merged];

      await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: allNotes });

      console.log(`WebDAV: Pulled and merged category "${category.name}" from ${filename}`);

      // Update last sync timestamp on category
      category.lastSyncTime = Date.now();
      const categories = await this.getCategories();
      const index = categories.findIndex(c => c.id === categoryId);
      if (index >= 0) {
        categories[index] = category;
        await browser.storage.local.set({ [STORAGE_KEYS.CATEGORIES]: categories });
      }
    } catch (error) {
      console.error('WebDAV pull error:', error);
      await this.saveWebDAVError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private mergeCategoryNotes(localNotes: PageNote[], remoteNotes: PageNote[]): PageNote[] {
    const mergedMap = new Map<string, PageNote>();

    for (const note of localNotes) {
      mergedMap.set(note.id, note);
    }

    for (const remoteNote of remoteNotes) {
      const existing = mergedMap.get(remoteNote.id);

      if (!existing) {
        mergedMap.set(remoteNote.id, remoteNote);
      } else {
        const remoteTime = remoteNote.deletedAt || remoteNote.updatedAt || remoteNote.createdAt || 0;
        const existingTime = existing.deletedAt || existing.updatedAt || existing.createdAt || 0;

        if (remoteTime > existingTime) {
          mergedMap.set(remoteNote.id, remoteNote);
        }
      }
    }

    return Array.from(mergedMap.values());
  }

  private async syncAllCategoriesFromWebDAV(): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (!settings.webdavEnabled || !settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
        return;
      }

      webdavService.initClient(
        settings.webdavUrl,
        settings.webdavUsername,
        settings.webdavPassword,
        settings.webdavBasePath || '/TabReminder/'
      );

      const remoteFiles = await webdavService.listCategoryFiles();
      const localCategories = await this.getCategories();

      for (const remoteFile of remoteFiles) {
        const localCategory = localCategories.find(c => c.id === remoteFile.categoryId);
        if (localCategory) {
          await this.syncCategoryFromWebDAV(localCategory.id);
        }
      }

      // Update global last sync timestamp
      const updatedSettings = await this.getSettings();
      updatedSettings.webdavLastSync = Date.now();
      await this.saveSettings(updatedSettings);
      console.log('WebDAV: Auto-sync completed, updated global lastSync timestamp');
    } catch (error) {
      console.error('WebDAV sync all error:', error);
      await this.saveWebDAVError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  async syncAllCategories(): Promise<{ success: boolean; error?: string }> {
    try {
      const settings = await this.getSettings();
      if (!settings.webdavEnabled || !settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
        return { success: false, error: 'WebDAV not configured' };
      }

      const categories = await this.getCategories();

      // Push local changes first
      for (const category of categories) {
        await this.syncCategoryToWebDAV(category.id);
      }

      // Then pull remote changes
      await this.syncAllCategoriesFromWebDAV();

      const updatedSettings = { ...settings, webdavLastSync: Date.now(), webdavSyncErrors: '' };
      await this.saveSettings(updatedSettings);

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await this.saveWebDAVError(message);
      return { success: false, error: message };
    }
  }

  async forceSyncAllCategories(): Promise<{ success: boolean; error?: string; message?: string }> {
    console.log('WebDAV: Force sync initiated by user');
    const result = await this.syncAllCategories();
    
    if (result.success) {
      return { success: true, message: 'Sync completed successfully' };
    } else {
      return { success: false, error: result.error || 'Unknown error', message: `Sync failed: ${result.error}` };
    }
  }

  async startAutoSync(): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.webdavEnabled) {
      console.log('WebDAV: Auto-sync not started (WebDAV disabled)');
      return;
    }

    this.stopAutoSync();

    const interval = (settings.webdavSyncInterval || 30) * 1000;
    console.log('WebDAV: Starting auto-sync with interval', settings.webdavSyncInterval, 'seconds (', interval, 'ms)');
    
    this.autoSyncInterval = setInterval(async () => {
      console.log('WebDAV: Auto-sync timer fired, syncing from server...');
      await this.syncAllCategoriesFromWebDAV();
    }, interval);

    console.log('WebDAV: Running initial sync from server...');
    await this.syncAllCategoriesFromWebDAV();
  }

  stopAutoSync(): void {
    if (this.autoSyncInterval) {
      console.log('WebDAV: Stopping auto-sync');
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
    }
  }

  private async saveWebDAVError(error: string): Promise<void> {
    const settings = await this.getSettings();
    settings.webdavSyncErrors = { message: error, timestamp: Date.now() };
    await this.saveSettings(settings);
  }

  async testWebDAVConnection(url: string, username: string, password: string, basePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      webdavService.initClient(url, username, password, basePath);
      await webdavService.testConnection();
      await webdavService.ensureBasePath(basePath);
      return { success: true };
    } catch (error) {
      if (error instanceof WebDAVAuthError) {
        return { success: false, error: 'Authentication failed. Check username and password.' };
      }
      if (error instanceof WebDAVNetworkError) {
        return { success: false, error: `Connection failed: ${error.message}` };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async discoverCategoriesOnServer(): Promise<{
    categoryId: string;
    categoryName: string;
    noteCount: number;
    existsLocally: boolean;
    filename: string;
  }[]> {
    console.log('Storage: Starting category discovery');
    const settings = await this.getSettings();
    if (!settings.webdavEnabled || !settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
      throw new Error('WebDAV not configured');
    }

    console.log('Storage: Initializing WebDAV client', {
      url: settings.webdavUrl,
      basePath: settings.webdavBasePath || '/TabReminder/',
    });

    webdavService.initClient(
      settings.webdavUrl,
      settings.webdavUsername,
      settings.webdavPassword,
      settings.webdavBasePath || '/TabReminder/'
    );

    console.log('Storage: Listing category files on server');
    const remoteFiles = await webdavService.listCategoryFiles();
    console.log('Storage: Found remote files', remoteFiles);
    
    const localCategories = await this.getCategories();
    console.log('Storage: Local categories', localCategories.map(c => ({ id: c.id, name: c.name })));
    
    const result = [];

    for (const remoteFile of remoteFiles) {
      try {
        console.log('Storage: Processing remote file', remoteFile.filename);
        const categoryFile = await webdavService.getFile(remoteFile.filename);
        if (!categoryFile) {
          console.error(`Category file ${remoteFile.filename} is empty or invalid`);
          continue;
        }
        
        const existsLocally = localCategories.some(c => c.id === categoryFile.categoryId);
        console.log('Storage: Category exists locally?', existsLocally);
        
        result.push({
          categoryId: categoryFile.categoryId,
          categoryName: categoryFile.categoryName,
          noteCount: categoryFile.notes.filter(n => !n.deleted).length,
          existsLocally,
          filename: remoteFile.filename,
        });
      } catch (error) {
        console.error(`Error reading category file ${remoteFile.filename}:`, error);
      }
    }

    console.log('Storage: Discovery complete, returning', result.length, 'categories');
    return result;
  }

  async importCategoryFromServer(categoryId: string): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.webdavEnabled || !settings.webdavUrl || !settings.webdavUsername || !settings.webdavPassword) {
      throw new Error('WebDAV not configured');
    }

    webdavService.initClient(
      settings.webdavUrl,
      settings.webdavUsername,
      settings.webdavPassword,
      settings.webdavBasePath || '/TabReminder/'
    );

    const remoteFiles = await webdavService.listCategoryFiles();
    const remoteFile = remoteFiles.find(f => f.categoryId === categoryId);
    
    if (!remoteFile) {
      throw new Error('Category not found on server');
    }

    const categoryFile = await webdavService.getFile(remoteFile.filename);
    if (!categoryFile) {
      throw new Error('Failed to read category file from server');
    }
    
    const localCategories = await this.getCategories();
    const existingCategory = localCategories.find(c => c.id === categoryId);

    if (existingCategory) {
      // Category exists locally - merge notes
      console.log('Storage: Category exists locally, syncing from server');
      await this.syncCategoryFromWebDAV(categoryId);
    } else {
      // New category - add it
      console.log('Storage: New category, creating and importing notes');
      const newCategory: Category = {
        id: categoryFile.categoryId,
        name: categoryFile.categoryName,
        color: categoryFile.categoryColor || '#4a90d9',  // Use remote color or default
        isDefault: false,
        webdavSync: true, // Enable sync for imported categories
      };
      
      await this.saveCategory(newCategory);
      console.log('Storage: Category created', newCategory);
      
      // Import notes - ensure all notes have the correct categoryId
      const existingNotes = await this.getAllNotesIncludingDeleted();
      const importedNotes = categoryFile.notes.map(note => ({
        ...note,
        categoryId: categoryFile.categoryId, // Ensure correct categoryId
      }));
      
      console.log('Storage: Importing', importedNotes.length, 'notes for category', categoryFile.categoryName);
      console.log('Storage: Note IDs:', importedNotes.map(n => n.id).slice(0, 5));
      console.log('Storage: Existing note count:', existingNotes.length);
      
      // Check for UUID conflicts
      const existingIds = new Set(existingNotes.map(n => n.id));
      const conflicts = importedNotes.filter(n => existingIds.has(n.id));
      
      if (conflicts.length > 0) {
        console.warn('Storage: Found UUID conflicts:', conflicts.length, 'notes');
        console.warn('Storage: Conflict IDs:', conflicts.map(n => n.id));
        // For new category import, if there's a UUID conflict, keep the existing note
        // Only add notes that don't conflict
        const nonConflictingNotes = importedNotes.filter(n => !existingIds.has(n.id));
        const allNotes = [...existingNotes, ...nonConflictingNotes];
        await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: allNotes });
        console.log('Storage: Imported', nonConflictingNotes.length, 'non-conflicting notes');
      } else {
        // No conflicts - just append all notes
        const allNotes = [...existingNotes, ...importedNotes];
        await browser.storage.local.set({ [STORAGE_KEYS.NOTES]: allNotes });
        console.log('Storage: Imported all', importedNotes.length, 'notes without conflicts');
      }
    }
  }
}


export const storageService = new StorageService();
