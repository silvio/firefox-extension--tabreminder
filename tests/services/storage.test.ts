import { storageService } from '../../src/shared/services/storage';
import { webdavService } from '../../src/shared/services/webdav';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  PageNote,
  Category,
  Settings,
} from '../../src/shared/types';

const browserMock = (global as any).browser;

function setupStorageMocks(
  localStoreOverride: Record<string, unknown> = {},
  syncStoreOverride: Record<string, unknown> = {}
) {
  const localStore: Record<string, unknown> = {
    settings: {},
    categories: DEFAULT_CATEGORIES,
    notes: [],
    reminders: [],
    webdavOutbox: {},
    ...localStoreOverride,
  };

  const syncStore: Record<string, unknown> = {
    settings: {
      syncEnabled: DEFAULT_SETTINGS.syncEnabled,
      notifications: DEFAULT_SETTINGS.notifications,
      preselectLastCategory: DEFAULT_SETTINGS.preselectLastCategory,
      popupHeight: DEFAULT_SETTINGS.popupHeight,
      editViewMode: DEFAULT_SETTINGS.editViewMode,
      webdavUrl: '',
      webdavEnabled: false,
      categoryColors: DEFAULT_SETTINGS.categoryColors,
      ...syncStoreOverride.settings as object | undefined,
    },
    ...syncStoreOverride,
  };

  browserMock.storage.local.get.mockImplementation(async (keys: any) => {
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      keys.forEach((key) => {
        result[key] = localStore[key];
      });
      return result;
    }
    if (typeof keys === 'string') {
      return { [keys]: localStore[keys] };
    }
    return { ...localStore };
  });

  browserMock.storage.sync.get.mockImplementation(async (keys: any) => {
    if (typeof keys === 'string') {
      return { [keys]: syncStore[keys] };
    }
    if (Array.isArray(keys)) {
      const result: Record<string, unknown> = {};
      keys.forEach((key) => {
        result[key] = syncStore[key];
      });
      return result;
    }
    return { ...syncStore };
  });

  browserMock.storage.local.set.mockImplementation(async (update: Record<string, unknown>) => {
    Object.assign(localStore, update);
  });
  browserMock.storage.sync.set.mockImplementation(async (update: Record<string, unknown>) => {
    Object.assign(syncStore, update);
  });

  return { localStore, syncStore };
}

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    browserMock.storage.local.get.mockResolvedValue({
      settings: DEFAULT_SETTINGS,
      categories: DEFAULT_CATEGORIES,
      notes: [],
      reminders: [],
    });
    browserMock.storage.local.set.mockResolvedValue(undefined);
    browserMock.storage.sync.get.mockResolvedValue({});
    browserMock.storage.sync.set.mockResolvedValue(undefined);
  });

  describe('initialize', () => {
    it('should set default values if not present', async () => {
      browserMock.storage.local.get.mockResolvedValue({});

      await storageService.initialize();

      expect(browserMock.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('getNotes', () => {
    it('should return empty array when no notes exist', async () => {
      browserMock.storage.local.get.mockResolvedValue({ notes: [] });

      const notes = await storageService.getNotes();

      expect(notes).toEqual([]);
    });

    it('should return stored notes', async () => {
      const mockNotes: PageNote[] = [
        {
          id: '1',
          url: 'https://example.com',
          urlMatchType: 'exact',
          title: 'Test',
          content: 'Content',
          categoryId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
      browserMock.storage.local.get.mockResolvedValue({ notes: mockNotes });

      const notes = await storageService.getNotes();

      expect(notes).toEqual(mockNotes);
    });
  });

  describe('saveNote', () => {
    it('should add new note', async () => {
      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [],
      });

      const note: PageNote = {
        id: '1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Test',
        content: 'Content',
        categoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storageService.saveNote(note);

      expect(browserMock.storage.local.set).toHaveBeenCalledWith({
        notes: [expect.objectContaining({
          ...note,
          version: 1,
        })],
      });
    });

    it('should update existing note', async () => {
      const existingNote: PageNote = {
        id: '1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Old Title',
        content: 'Old Content',
        categoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 2,
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [existingNote],
      });

      const updatedNote = { ...existingNote, title: 'New Title' };
      await storageService.saveNote(updatedNote);

      expect(browserMock.storage.local.set).toHaveBeenCalledWith({
        notes: [expect.objectContaining({
          ...updatedNote,
          version: 3,
        })],
      });
    });
  });

  describe('deleteNote', () => {
    it('should soft-delete note by id', async () => {
      const note: PageNote = {
        id: '1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Test',
        content: 'Content',
        categoryId: 'work',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 4,
        hasReminder: true,
        scheduleType: 'once',
        scheduledTime: Date.now() + 60_000,
        nextTrigger: Date.now() + 60_000,
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [note],
      });

      await storageService.deleteNote('1');

      const setCalls = browserMock.storage.local.set.mock.calls;
      const notesWrite = setCalls.find((call: any[]) => call[0]?.notes);
      expect(notesWrite).toBeDefined();
      const deletedNote = notesWrite[0].notes[0];
      expect(deletedNote.id).toBe('1');
      expect(deletedNote.deleted).toBe(true);
      expect(deletedNote.title).toBe('Test');
      expect(deletedNote.content).toBe('Content');
      expect(deletedNote.url).toBe('https://example.com');
      expect(deletedNote.categoryId).toBe('work');
      expect(deletedNote.hasReminder).toBe(false);
      expect(deletedNote.version).toBe(5);
    });

    it('restores a soft-deleted note', async () => {
      const note: PageNote = {
        id: '1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Test',
        content: 'Content',
        categoryId: 'work',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now() - 500,
        version: 3,
        deleted: true,
        deletedAt: Date.now() - 300,
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [note],
      });

      await storageService.restoreNote('1');

      const setCalls = browserMock.storage.local.set.mock.calls;
      const notesWrite = setCalls.find((call: any[]) => call[0]?.notes);
      expect(notesWrite).toBeDefined();
      const restored = notesWrite[0].notes[0];
      expect(restored.deleted).toBe(false);
      expect(restored.deletedAt).toBeUndefined();
      expect(restored.version).toBe(4);
    });
  });

  describe('getNoteForUrl', () => {
    it('should match exact URL', async () => {
      const note: PageNote = {
        id: '1',
        url: 'https://example.com/page?id=1',
        urlMatchType: 'exact',
        title: 'Test',
        content: 'Content',
        categoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [note],
      });

      const result = await storageService.getNoteForUrl(
        'https://example.com/page?id=1'
      );
      expect(result).toEqual(note);

      const noMatch = await storageService.getNoteForUrl(
        'https://example.com/page?id=2'
      );
      expect(noMatch).toBeNull();
    });

    it('should match by path', async () => {
      const note: PageNote = {
        id: '1',
        url: 'https://example.com/page?id=1',
        urlMatchType: 'path',
        title: 'Test',
        content: 'Content',
        categoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [note],
      });

      const result = await storageService.getNoteForUrl(
        'https://example.com/page?id=2'
      );
      expect(result).toEqual(note);
    });

    it('should match by domain', async () => {
      const note: PageNote = {
        id: '1',
        url: 'https://example.com/page',
        urlMatchType: 'domain',
        title: 'Test',
        content: 'Content',
        categoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [note],
      });

      const result = await storageService.getNoteForUrl(
        'https://example.com/other'
      );
      expect(result).toEqual(note);
    });
  });

  describe('categories', () => {
    it('should return default categories', async () => {
      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        categories: DEFAULT_CATEGORIES,
      });

      const categories = await storageService.getCategories();

      expect(categories).toEqual(DEFAULT_CATEGORIES);
    });

    it('should add custom category', async () => {
      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        categories: [...DEFAULT_CATEGORIES],
      });

      const newCategory: Category = {
        id: 'custom',
        name: 'Custom',
        color: '#000000',
        isDefault: false,
      };

      await storageService.saveCategory(newCategory);

      const setCalls = browserMock.storage.local.set.mock.calls;
      const categoriesWrite = setCalls.find((call: any[]) => call[0]?.categories);
      expect(categoriesWrite).toBeDefined();
      expect(categoriesWrite[0].categories.length).toBe(DEFAULT_CATEGORIES.length + 1);
      const created = categoriesWrite[0].categories.find((c: Category) => c.id === newCategory.id);
      expect(created).toBeDefined();
      expect(created.name).toBe(newCategory.name);
      expect(created.color).toBe(newCategory.color);
    });

    it('should delete default category (no longer protected)', async () => {
      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        categories: DEFAULT_CATEGORIES,
      });

      await storageService.deleteCategory('work');
      expect(browserMock.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('settings', () => {
    it('should return default settings', async () => {
      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
      });

      const settings = await storageService.getSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('should save settings', async () => {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        notifications: {
          system: false,
          overlay: true,
          badge: true,
          overlayStyle: { backgroundColor: '#000000', borderColor: '#e53935' },
        },
      };

      await storageService.saveSettings(newSettings);

      expect(browserMock.storage.sync.set).toHaveBeenCalledWith({
        settings: {
          syncEnabled: newSettings.syncEnabled,
          notifications: newSettings.notifications,
          preselectLastCategory: newSettings.preselectLastCategory,
          popupHeight: newSettings.popupHeight,
          editViewMode: newSettings.editViewMode,
          webdavUrl: newSettings.webdavUrl,
          webdavEnabled: newSettings.webdavEnabled,
          categoryColors: newSettings.categoryColors,
        },
      });

      expect(browserMock.storage.local.set).toHaveBeenCalledWith({
        settings: {
          lastDeleteAllTimestamp: newSettings.lastDeleteAllTimestamp,
          lastUsedCategoryId: newSettings.lastUsedCategoryId,
          webdavUsername: newSettings.webdavUsername,
          webdavPassword: newSettings.webdavPassword,
          webdavBasePath: newSettings.webdavBasePath,
          webdavSyncInterval: newSettings.webdavSyncInterval,
          webdavLastSync: newSettings.webdavLastSync,
          webdavSyncErrors: newSettings.webdavSyncErrors,
        },
      });
    });

    it('should clamp popup height to minimum 600 when saving settings', async () => {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        popupHeight: 500,
      };

      await storageService.saveSettings(newSettings);

      expect(browserMock.storage.sync.set).toHaveBeenCalledWith({
        settings: expect.objectContaining({
          popupHeight: 600,
        }),
      });
    });

    it('should clamp popup height to maximum 1200 when saving settings', async () => {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        popupHeight: 1400,
      };

      await storageService.saveSettings(newSettings);

      expect(browserMock.storage.sync.set).toHaveBeenCalledWith({
        settings: expect.objectContaining({
          popupHeight: 1200,
        }),
      });
    });
  });

  describe('last used category', () => {
    it('stores and returns last used category when saving a note', async () => {
      const { localStore } = setupStorageMocks(
        {
          settings: {},
          notes: [],
        },
        {
          settings: {
            ...DEFAULT_SETTINGS,
          },
        }
      );

      const note: PageNote = {
        id: 'note-1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Test',
        content: 'Content',
        categoryId: 'work',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await storageService.saveNote(note);
      const lastUsed = await storageService.getLastUsedCategoryId();

      expect(lastUsed).toBe('work');
      const localSettings = localStore.settings as Settings;
      expect(localSettings.lastUsedCategoryId).toBe('work');
    });
  });

  describe('webdav outbox', () => {
    it('persists failed uploads and retries them until success', async () => {
      const syncedSettings = {
        syncEnabled: DEFAULT_SETTINGS.syncEnabled,
        notifications: DEFAULT_SETTINGS.notifications,
        preselectLastCategory: DEFAULT_SETTINGS.preselectLastCategory,
        popupHeight: DEFAULT_SETTINGS.popupHeight,
        editViewMode: DEFAULT_SETTINGS.editViewMode,
        webdavUrl: 'https://webdav.example.com',
        webdavEnabled: true,
        categoryColors: DEFAULT_SETTINGS.categoryColors,
      };
      const { localStore } = setupStorageMocks(
        {
          settings: {
            webdavUsername: 'user',
            webdavPassword: 'pass',
            webdavBasePath: '/TabReminder/',
          },
          categories: [
            { id: 'work', name: 'Work', color: '#4a90d9', isDefault: true, webdavSync: true },
          ],
          notes: [
            {
              id: 'note-1',
              url: 'https://example.com',
              urlMatchType: 'exact',
              title: 'Test',
              content: 'Content',
              categoryId: 'work',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          webdavOutbox: {},
        },
        { settings: syncedSettings }
      );

      jest.spyOn(webdavService, 'putFile').mockRejectedValueOnce(new Error('network down'));

      await storageService.triggerWebDAVSyncImmediate('work');

      const failedEntry = (localStore.webdavOutbox as Record<string, any>).work;
      expect(failedEntry).toBeDefined();
      expect(failedEntry.attempts).toBe(1);
      expect(failedEntry.nextAttemptAt).toBeGreaterThan(Date.now());

      jest.spyOn(webdavService, 'putFile').mockResolvedValueOnce(undefined);

      (localStore.webdavOutbox as Record<string, any>).work.nextAttemptAt = Date.now() - 1;
      await storageService.flushPendingWebDAVSync('test_retry');

      expect((localStore.webdavOutbox as Record<string, any>).work).toBeUndefined();
    });

    it('avoids duplicate uploads when the same category is synced concurrently', async () => {
      const syncedSettings = {
        syncEnabled: DEFAULT_SETTINGS.syncEnabled,
        notifications: DEFAULT_SETTINGS.notifications,
        preselectLastCategory: DEFAULT_SETTINGS.preselectLastCategory,
        popupHeight: DEFAULT_SETTINGS.popupHeight,
        editViewMode: DEFAULT_SETTINGS.editViewMode,
        webdavUrl: 'https://webdav.example.com',
        webdavEnabled: true,
        categoryColors: DEFAULT_SETTINGS.categoryColors,
      };
      setupStorageMocks(
        {
          settings: {
            webdavUsername: 'user',
            webdavPassword: 'pass',
            webdavBasePath: '/TabReminder/',
          },
          categories: [
            { id: 'work', name: 'Work', color: '#4a90d9', isDefault: true, webdavSync: true },
          ],
          notes: [
            {
              id: 'note-1',
              url: 'https://example.com',
              urlMatchType: 'exact',
              title: 'Test',
              content: 'Content',
              categoryId: 'work',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
          webdavOutbox: {},
        },
        { settings: syncedSettings }
      );

      let resolveUpload: (() => void) | null = null;
      const uploadPromise = new Promise<void>((resolve) => {
        resolveUpload = resolve;
      });
      const putFileSpy = jest.spyOn(webdavService, 'putFile').mockReturnValue(uploadPromise);

      const first = storageService.triggerWebDAVSyncImmediate('work');
      const second = storageService.triggerWebDAVSyncImmediate('work');

      expect(resolveUpload).not.toBeNull();
      resolveUpload!();
      await Promise.all([first, second]);

      expect(putFileSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps hard-delete tombstones when emptying trash', async () => {
      const deletedNote: PageNote = {
        id: 'deleted-1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Deleted title',
        content: 'Deleted content',
        categoryId: 'work',
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 5_000,
        version: 7,
        deleted: true,
        deletedAt: Date.now() - 5_000,
      };
      const activeNote: PageNote = {
        id: 'active-1',
        url: 'https://example.com/active',
        urlMatchType: 'exact',
        title: 'Active title',
        content: 'Active content',
        categoryId: 'work',
        createdAt: Date.now() - 10_000,
        updatedAt: Date.now() - 5_000,
        version: 2,
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [deletedNote, activeNote],
      });

      await storageService.deleteAllTrash();

      const setCalls = browserMock.storage.local.set.mock.calls;
      const notesWrite = setCalls.find((call: any[]) => call[0]?.notes);
      expect(notesWrite).toBeDefined();
      const writtenNotes = notesWrite[0].notes as PageNote[];
      const tombstone = writtenNotes.find((note) => note.id === 'deleted-1');
      expect(tombstone).toBeDefined();
      expect(tombstone?.hardDeleted).toBe(true);
      expect(tombstone?.deleted).toBe(true);
      expect(tombstone?.title).toBe('');
      expect(tombstone?.content).toBe('');
      expect(tombstone?.version).toBe(8);
    });

    it('merge logic prefers deleted note when version and updatedAt tie', () => {
      const local: PageNote = {
        id: 'note-1',
        url: 'https://example.com',
        urlMatchType: 'exact',
        title: 'Local title',
        content: 'Local content',
        categoryId: 'work',
        createdAt: 1000,
        updatedAt: 2000,
        version: 5,
        deleted: false,
      };
      const remoteDeleted: PageNote = {
        ...local,
        deleted: true,
        deletedAt: 2500,
      };

      const merged = (storageService as any).mergeCategoryNotes([local], [remoteDeleted]) as PageNote[];
      expect(merged).toHaveLength(1);
      expect(merged[0].deleted).toBe(true);
      expect(merged[0].deletedAt).toBe(2500);
    });
  });
});
