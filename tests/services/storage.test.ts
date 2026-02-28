import { storageService } from '../../src/shared/services/storage';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  PageNote,
  Category,
} from '../../src/shared/types';

const browserMock = (global as any).browser;

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
        notes: [note],
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
      };

      browserMock.storage.local.get.mockResolvedValue({
        settings: DEFAULT_SETTINGS,
        notes: [existingNote],
      });

      const updatedNote = { ...existingNote, title: 'New Title' };
      await storageService.saveNote(updatedNote);

      expect(browserMock.storage.local.set).toHaveBeenCalledWith({
        notes: [updatedNote],
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
        categoryId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
      expect(deletedNote.hasReminder).toBe(false);
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
});
