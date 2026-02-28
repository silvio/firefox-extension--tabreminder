import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { storageService } from '../shared/services/storage';
import { Settings, PageNote, TimeReminder, Category } from '../shared/types';

const SYSTEM_FONTS = [
  'system-ui, sans-serif',
  'Arial, sans-serif',
  'Helvetica, sans-serif',
  'Georgia, serif',
  'Times New Roman, serif',
  'Courier New, monospace',
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
];

const TIMEOUT_OPTIONS = [
  { value: 0, label: 'Never (manual close)' },
  { value: 2000, label: '2 seconds' },
  { value: 5000, label: '5 seconds' },
  { value: 10000, label: '10 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute' },
];

interface Stats {
  notesTotal: number;
  notesExact: number;
  notesPath: number;
  notesDomain: number;
  notesRegex: number;
  remindersTotal: number;
  remindersRecurring: number;
  remindersOverdue: number;
  categoriesTotal: number;
  storageBytes: number;
}

interface ImportPreview {
  notes: number;
  reminders: number;
  categories: number;
  hasSettings: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pendingImportData, setPendingImportData] = useState<string | null>(null);
  const [customFont, setCustomFont] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [notes, setNotes] = useState<PageNote[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#4a90d9');
  const [categoryError, setCategoryError] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [deletedNotesCount, setDeletedNotesCount] = useState(0);
  const [deleteAction, setDeleteAction] = useState<'move' | 'remove' | 'delete'>('remove');
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [deleteFromWebDAV, setDeleteFromWebDAV] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [editingCategoryColor, setEditingCategoryColor] = useState('');
  
  // WebDAV sync state
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [webdavBasePath, setWebdavBasePath] = useState('/TabReminder/');
  const [webdavSyncInterval, setWebdavSyncInterval] = useState(30);
  const [webdavTesting, setWebdavTesting] = useState(false);
  const [webdavTestResult, setWebdavTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [webdavSyncing, setWebdavSyncing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [discoveredCategories, setDiscoveredCategories] = useState<{
    categoryId: string;
    categoryName: string;
    noteCount: number;
    existsLocally: boolean;
    filename: string;
  }[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [loadingRemoteFile, setLoadingRemoteFile] = useState<string | null>(null);
  const [remoteFilePreview, setRemoteFilePreview] = useState<{ title: string; content: string } | null>(null);


  // Pagination for Notes with Reminders
  const [reminderNotesPage, setReminderNotesPage] = useState(0);
  const REMINDERS_PER_PAGE = 10;

  useEffect(() => {
    loadSettings();
    loadStats();
    loadCategories();
    loadDeletedNotesCount();
  }, []);

  async function loadSettings() {
    try {
      const data = await storageService.getSettings();
      setSettings(data);
      if (data.notifications.overlayStyle?.fontFamily &&
          !SYSTEM_FONTS.includes(data.notifications.overlayStyle.fontFamily)) {
        setCustomFont(data.notifications.overlayStyle.fontFamily);
      }
      
      // Load WebDAV settings
      setWebdavUrl(data.webdavUrl || '');
      setWebdavUsername(data.webdavUsername || '');
      setWebdavPassword(data.webdavPassword || '');
      setWebdavBasePath(data.webdavBasePath || '/TabReminder/');
      setWebdavSyncInterval(data.webdavSyncInterval || 30);
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const [notes, reminders, categories] = await Promise.all([
        storageService.getNotes(),
        storageService.getReminders(),
        storageService.getCategories(),
      ]);

      const now = Date.now();
      const { rawBytes } = await storageService.getStorageStats();

      setStats({
        notesTotal: notes.length,
        notesExact: notes.filter((n) => n.urlMatchType === 'exact').length,
        notesPath: notes.filter((n) => n.urlMatchType === 'path').length,
        notesDomain: notes.filter((n) => n.urlMatchType === 'domain').length,
        notesRegex: notes.filter((n) => n.urlMatchType === 'regex').length,
        remindersTotal: reminders.length,
        remindersRecurring: reminders.filter((r) => r.scheduleType === 'recurring').length,
        remindersOverdue: reminders.filter((r) => r.nextTrigger <= now).length,
        categoriesTotal: categories.length,
        storageBytes: rawBytes,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  async function loadCategories() {
    try {
      const [categoriesData, notesData] = await Promise.all([
        storageService.getCategories(),
        storageService.getNotes(),
      ]);
      setCategories(categoriesData);
      setNotes(notesData);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;

    const exists = categories.some((c) => c.name.toLowerCase() === newCategoryName.trim().toLowerCase());
    if (exists) {
      setCategoryError(`Category "${newCategoryName.trim()}" already exists`);
      return;
    }

    const newCategory: Category = {
      id: newCategoryName.toLowerCase().replace(/\s+/g, '-'),
      name: newCategoryName.trim(),
      color: newCategoryColor,
      isDefault: false,
    };

    await storageService.saveCategory(newCategory);
    setCategories(await storageService.getCategories());
    setNewCategoryName('');
    setNewCategoryColor('#4a90d9');
    setCategoryError('');
    await loadStats();
  }

  async function handleDeleteCategory() {
    if (!deletingCategory) return;

    try {
      const affectedNotes = notes.filter((n) => n.categoryId === deletingCategory.id);

      for (const note of affectedNotes) {
        if (deleteAction === 'delete') {
          // Permanently delete the note
          await storageService.deleteNote(note.id);
        } else if (deleteAction === 'move' && targetCategoryId) {
          note.categoryId = targetCategoryId;
          note.updatedAt = Date.now();
          await storageService.saveNote(note);
        } else {
          // Remove category tag (make uncategorized)
          note.categoryId = null;
          note.updatedAt = Date.now();
          await storageService.saveNote(note);
        }
      }

      await storageService.deleteCategory(deletingCategory.id, deleteFromWebDAV);
      setCategories(await storageService.getCategories());
      setNotes(await storageService.getNotes());
      setDeletingCategory(null);
      setDeleteAction('remove');
      setTargetCategoryId('');
      setDeleteFromWebDAV(false);
      await loadStats();
    } catch (error) {
      alert(`Error deleting category: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  function handleEditCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategoryColor(category.color);
  }

  async function handleSaveCategoryEdit() {
    if (!editingCategoryId) return;
    
    const category = categories.find(c => c.id === editingCategoryId);
    if (!category) return;

    const updated: Category = {
      ...category,
      name: editingCategoryName.trim(),
      color: editingCategoryColor,
    };

    await storageService.saveCategory(updated);
    await loadCategories();
    setEditingCategoryId(null);
    setEditingCategoryName('');
    setEditingCategoryColor('');
  }

  function handleCancelCategoryEdit() {
    setEditingCategoryId(null);
    setEditingCategoryName('');
    setEditingCategoryColor('');
  }

  async function handleSave() {
    if (!settings) return;
    await storageService.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // OLD FIREFOX SYNC - DEPRECATED
  // WebDAV sync will replace this in Phase 4
  async function handleSyncToggle(enabled: boolean) {
    if (!settings) return;
    try {
      // DEPRECATED: Firefox Sync for notes/categories removed
      // Keep syncEnabled setting for backwards compatibility
      const updatedSettings = { ...settings, syncEnabled: enabled };
      await storageService.saveSettings(updatedSettings);
      setSettings(updatedSettings);
    } catch (error) {
      console.error('Error toggling sync:', error);
    }
  }

  async function handleResync() {
    // DEPRECATED: Old Firefox Sync resync removed
    alert('Firefox Sync for notes has been replaced with WebDAV sync. Please configure WebDAV below.');
  }

  async function handleForcePush() {
    // DEPRECATED: Old Firefox Sync force push removed
    alert('Firefox Sync for notes has been replaced with WebDAV sync. Please configure WebDAV below.');
  }

  async function handleForcePull() {
    // DEPRECATED: Old Firefox Sync force pull removed
    alert('Firefox Sync for notes has been replaced with WebDAV sync. Please configure WebDAV below.');
  }

  // WebDAV handlers
  async function handleWebDAVToggle(enabled: boolean) {
    if (!settings) return;
    try {
      const updatedSettings = { 
        ...settings, 
        webdavEnabled: enabled,
        webdavUrl,
        webdavUsername,
        webdavPassword,
        webdavBasePath,
        webdavSyncInterval,
      };
      await storageService.saveSettings(updatedSettings);
      setSettings(updatedSettings);

      if (enabled) {
        await storageService.startAutoSync();
      } else {
        storageService.stopAutoSync();
      }
    } catch (error) {
      console.error('Error toggling WebDAV:', error);
    }
  }

  async function handleWebDAVSave() {
    if (!settings) return;
    try {
      const updatedSettings = {
        ...settings,
        webdavUrl,
        webdavUsername,
        webdavPassword,
        webdavBasePath,
        webdavSyncInterval,
      };
      await storageService.saveSettings(updatedSettings);
      setSettings(updatedSettings);
      
      // Restart auto-sync with new interval
      if (updatedSettings.webdavEnabled) {
        await storageService.startAutoSync();
      }
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Error saving WebDAV settings:', error);
      alert('Failed to save settings: ' + (error as Error).message);
    }
  }

  async function handleWebDAVTest() {
    if (!webdavUrl || !webdavUsername || !webdavPassword) {
      setWebdavTestResult({ success: false, message: 'Please fill in all required fields' });
      return;
    }

    setWebdavTesting(true);
    setWebdavTestResult(null);

    try {
      const result = await storageService.testWebDAVConnection(
        webdavUrl,
        webdavUsername,
        webdavPassword,
        webdavBasePath
      );
      setWebdavTestResult({
        success: result.success,
        message: result.success ? 'Connection successful!' : (result.error || 'Connection failed'),
      });
    } catch (error) {
      setWebdavTestResult({
        success: false,
        message: 'Connection failed: ' + (error as Error).message,
      });
    } finally {
      setWebdavTesting(false);
    }
  }

  async function handleWebDAVSyncNow() {
    if (!settings?.webdavEnabled) {
      alert('Please enable and configure WebDAV sync first');
      return;
    }

    setWebdavSyncing(true);
    try {
      const result = await storageService.forceSyncAllCategories();
      if (result.success) {
        await loadStats();
        await loadCategories();
        alert(result.message || 'Sync completed successfully!');
      } else {
        alert(result.message || 'Sync failed: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Sync error:', error);
      alert('Sync failed: ' + (error as Error).message);
    } finally {
      setWebdavSyncing(false);
    }
  }

  async function handleDiscoverCategories() {
    setDiscovering(true);
    setRemoteFilePreview(null);
    try {
      const discovered = await storageService.discoverCategoriesOnServer();
      setDiscoveredCategories(discovered);
    } catch (error) {
      console.error('Discover error:', error);
      alert('Failed to discover categories: ' + (error as Error).message);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleImportCategory(categoryId: string) {
    setImporting(categoryId);
    try {
      await storageService.importCategoryFromServer(categoryId);
      await loadCategories();
      await loadStats();
      setNotes(await storageService.getNotes());
      // Refresh discovered list
      const discovered = await storageService.discoverCategoriesOnServer();
      setDiscoveredCategories(discovered);
      alert('Category imported successfully!');
    } catch (error) {
      console.error('Import error:', error);
      alert('Failed to import category: ' + (error as Error).message);
    } finally {
      setImporting(null);
    }
  }

  async function handleViewCategoryFile(category: { categoryName: string; filename: string }) {
    setLoadingRemoteFile(category.filename);
    try {
      const file = await storageService.getCategoryFileFromServer(category.filename);
      if (!file) {
        alert('Category file not found on server');
        return;
      }

      setRemoteFilePreview({
        title: `${category.categoryName} (${category.filename})`,
        content: JSON.stringify(file, null, 2),
      });
    } catch (error) {
      console.error('View remote file error:', error);
      alert('Failed to load remote file: ' + (error as Error).message);
    } finally {
      setLoadingRemoteFile(null);
    }
  }


  async function handleExport() {
    const data = await storageService.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tabreminder-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    file.text().then((text) => {
      try {
        const data = JSON.parse(text);
        setImportPreview({
          notes: data.notes?.length || 0,
          reminders: data.reminders?.length || 0,
          categories: data.categories?.length || 0,
          hasSettings: !!data.settings,
        });
        setPendingImportData(text);
      } catch {
        alert('Invalid JSON file');
      }
    });
    event.target.value = '';
  }

  async function handleImportConfirm() {
    if (!pendingImportData) return;
    try {
      await storageService.importData(pendingImportData);
      await loadSettings();
      await loadStats();
      setImportPreview(null);
      setPendingImportData(null);
      alert('Data imported successfully!');
    } catch (error) {
      alert('Failed to import data: ' + (error as Error).message);
    }
  }

  function handleImportCancel() {
    setImportPreview(null);
    setPendingImportData(null);
  }

  async function loadDeletedNotesCount() {
    try {
      const deletedNotes = await storageService.getDeletedNotes();
      setDeletedNotesCount(deletedNotes.length);
    } catch (error) {
      console.error('Error loading deleted notes count:', error);
    }
  }

  async function handleDeleteAllTrash() {
    if (!settings) return;

    const confirmMsg = `This will permanently delete ${deletedNotesCount} notes from trash. This action cannot be undone and will sync across all devices. Continue?`;
    if (!confirm(confirmMsg)) return;

    try {
      await storageService.deleteAllTrash();
      await loadDeletedNotesCount();
      await loadStats();
      alert('Trash emptied successfully!');
    } catch (error) {
      alert('Failed to delete trash: ' + (error as Error).message);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (loading || !settings) {
    return <div style={{ padding: '20px' }}>Loading...</div>;
  }

  const overlayStyle = settings.notifications.overlayStyle || {};

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <h1 style={{ marginBottom: '30px' }}>TabReminder Settings</h1>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          Firefox Account Sync
        </h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(e) => handleSyncToggle(e.target.checked)}
            style={{ width: '18px', height: '18px' }}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Sync extension settings with Firefox Account</div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Syncs preferences and WebDAV configuration to your other Firefox devices
            </div>
          </div>
        </label>
      </section>


      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          WebDAV Sync
        </h2>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}>
          <input
            type="checkbox"
            checked={settings.webdavEnabled || false}
            onChange={(e) => handleWebDAVToggle(e.target.checked)}
            style={{ width: '18px', height: '18px' }}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Enable WebDAV Sync</div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Sync notes to your WebDAV server (Nextcloud, ownCloud, etc.)
            </div>
            {settings.webdavLastSync && (
              <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                Last synced: {formatRelativeTime(settings.webdavLastSync)}
              </div>
            )}
          </div>
        </label>

        {settings.webdavEnabled && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* WebDAV URL */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500, fontSize: '14px' }}>
              WebDAV Server URL *
            </label>
            <input
              type="url"
              value={webdavUrl}
              onChange={(e) => setWebdavUrl(e.target.value)}
              placeholder="https://cloud.example.com/remote.php/dav/files/username"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              For Nextcloud: https://your-server.com/remote.php/dav/files/username
            </div>
          </div>

          {/* Username */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500, fontSize: '14px' }}>
              Username *
            </label>
            <input
              type="text"
              value={webdavUsername}
              onChange={(e) => setWebdavUsername(e.target.value)}
              placeholder="username"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500, fontSize: '14px' }}>
              Password / App Token *
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder="password or app-specific token"
                style={{
                  width: '100%',
                  padding: '8px',
                  paddingRight: '80px',
                  fontSize: '14px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: '4px 8px',
                  fontSize: '12px',
                  border: 'none',
                  background: 'transparent',
                  color: '#4a90d9',
                  cursor: 'pointer',
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              ⚠️ For Nextcloud: Use an app-specific password (Settings → Security)
            </div>
          </div>

          {/* Base Path */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500, fontSize: '14px' }}>
              Base Path
            </label>
            <input
              type="text"
              value={webdavBasePath}
              onChange={(e) => setWebdavBasePath(e.target.value)}
              placeholder="/TabReminder/"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              Directory on server where files will be stored (will be created if needed)
            </div>
          </div>

          {/* Sync Interval */}
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500, fontSize: '14px' }}>
              Auto-sync Interval (seconds)
            </label>
            <input
              type="number"
              value={webdavSyncInterval}
              onChange={(e) => setWebdavSyncInterval(parseInt(e.target.value) || 30)}
              min="10"
              max="3600"
              style={{
                width: '150px',
                padding: '8px',
                fontSize: '14px',
                border: '1px solid #ccc',
                borderRadius: '4px',
              }}
            />
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              How often to check for changes (default: 30 seconds, min: 10)
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button
              onClick={handleWebDAVTest}
              disabled={webdavTesting}
              style={{
                padding: '10px 20px',
                backgroundColor: '#4a90d9',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: webdavTesting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                opacity: webdavTesting ? 0.6 : 1,
              }}
            >
              {webdavTesting ? '🔄 Testing...' : '🔌 Test Connection'}
            </button>

            <button
              onClick={handleWebDAVSave}
              disabled={!webdavUrl || !webdavUsername || !webdavPassword}
              style={{
                padding: '10px 20px',
                backgroundColor: '#7cb342',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: (!webdavUrl || !webdavUsername || !webdavPassword) ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 500,
                opacity: (!webdavUrl || !webdavUsername || !webdavPassword) ? 0.6 : 1,
              }}
            >
              💾 Save Settings
            </button>

            {settings.webdavEnabled && (
              <button
                onClick={handleWebDAVSyncNow}
                disabled={webdavSyncing}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#ff9800',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: webdavSyncing ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                  opacity: webdavSyncing ? 0.6 : 1,
                }}
              >
                {webdavSyncing ? '🔄 Syncing...' : '🔄 Sync Now'}
              </button>
            )}
          </div>

          {/* Test Result */}
          {webdavTestResult && (
            <div style={{
              padding: '12px',
              backgroundColor: webdavTestResult.success ? '#e8f5e9' : '#ffebee',
              border: `1px solid ${webdavTestResult.success ? '#7cb342' : '#f44336'}`,
              borderRadius: '4px',
              fontSize: '14px',
              color: webdavTestResult.success ? '#2e7d32' : '#c62828',
            }}>
              {webdavTestResult.success ? '✅' : '❌'} {webdavTestResult.message}
            </div>
          )}

          {/* Error Display */}
          {settings.webdavSyncErrors && (
            <div style={{
              padding: '12px',
              backgroundColor: '#ffebee',
              border: '1px solid #f44336',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#c62828',
            }}>
              🚨 Sync Error: {
                typeof settings.webdavSyncErrors === 'string' 
                  ? settings.webdavSyncErrors 
                  : settings.webdavSyncErrors.message
              }
              {typeof settings.webdavSyncErrors === 'object' && settings.webdavSyncErrors.timestamp && (
                <div style={{ fontSize: '12px', marginTop: '4px', color: '#999' }}>
                  {new Date(settings.webdavSyncErrors.timestamp).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* Security Warning */}
          <div style={{
            padding: '12px',
            backgroundColor: '#fff3e0',
            border: '1px solid #ff9800',
            borderRadius: '4px',
            fontSize: '13px',
          }}>
            <strong>🔒 Security Note:</strong> Credentials (username/password) are stored LOCALLY on this device only
            and do NOT sync via Firefox Account. Only the WebDAV URL syncs across devices for convenience.
          </div>

          {/* Discover Categories Section */}
          {settings.webdavEnabled && (
            <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f9f9f9', borderRadius: '8px', border: '1px solid #ddd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>📂 Categories on Server</h3>
                <button
                  onClick={handleDiscoverCategories}
                  disabled={discovering}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#4a90d9',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: discovering ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    opacity: discovering ? 0.6 : 1,
                  }}
                >
                  {discovering ? '🔄 Scanning...' : '🔍 Discover Categories'}
                </button>
              </div>

              {discoveredCategories.length > 0 ? (
                <div>
                  {discoveredCategories.map((cat) => (
                    <div
                      key={cat.categoryId}
                      style={{
                        padding: '12px',
                        marginBottom: '8px',
                        backgroundColor: '#fff',
                        borderRadius: '4px',
                        border: '1px solid #e0e0e0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                          {cat.existsLocally ? '✅' : '📥'} {cat.categoryName}
                        </div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {cat.noteCount} notes • {cat.existsLocally ? 'Already imported' : 'Server only'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => handleViewCategoryFile(cat)}
                          disabled={loadingRemoteFile === cat.filename}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#4a90d9',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: loadingRemoteFile === cat.filename ? 'not-allowed' : 'pointer',
                            fontSize: '12px',
                            fontWeight: 500,
                            opacity: loadingRemoteFile === cat.filename ? 0.6 : 1,
                          }}
                        >
                          {loadingRemoteFile === cat.filename ? '⏳ Loading...' : '📄 View JSON'}
                        </button>
                        {!cat.existsLocally && (
                          <button
                            onClick={() => handleImportCategory(cat.categoryId)}
                            disabled={importing === cat.categoryId}
                            style={{
                              padding: '6px 12px',
                              backgroundColor: '#7cb342',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: importing === cat.categoryId ? 'not-allowed' : 'pointer',
                              fontSize: '12px',
                              fontWeight: 500,
                              opacity: importing === cat.categoryId ? 0.6 : 1,
                            }}
                          >
                            {importing === cat.categoryId ? '⏳ Importing...' : '📥 Import'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '13px' }}>
                  {discovering ? 'Scanning server...' : 'Click "Discover Categories" to scan the WebDAV server for category files.'}
                </div>
              )}

              {remoteFilePreview && (
                <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #ddd' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>
                    📄 Remote File Preview
                  </h4>
                  <div style={{ marginBottom: '8px', fontSize: '13px', fontWeight: 500 }}>
                    {remoteFilePreview.title}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px',
                      backgroundColor: '#1e1e1e',
                      color: '#d4d4d4',
                      borderRadius: '8px',
                      overflowX: 'auto',
                      maxHeight: '360px',
                      fontSize: '12px',
                      lineHeight: 1.45,
                    }}
                  >
                    {remoteFilePreview.content}
                  </pre>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => navigator.clipboard.writeText(remoteFilePreview.content)}
                      style={{
                        padding: '8px 12px',
                        backgroundColor: '#4a90d9',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Copy JSON
                    </button>
                    <button
                      onClick={() => setRemoteFilePreview(null)}
                      style={{
                        padding: '8px 12px',
                        backgroundColor: '#666',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      Close Preview
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        )}
      </section>
      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          Notifications
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.notifications.system}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, system: e.target.checked },
                })
              }
              style={{ width: '18px', height: '18px' }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>System Notifications</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Show desktop notifications for time reminders
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.notifications.overlay}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, overlay: e.target.checked },
                })
              }
              style={{ width: '18px', height: '18px' }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Page Overlay</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Show note overlay when visiting a page with a note
              </div>
            </div>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.notifications.badge}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notifications: { ...settings.notifications, badge: e.target.checked },
                })
              }
              style={{ width: '18px', height: '18px' }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Toolbar Badge</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Show badge on toolbar icon when there are notes or due reminders
              </div>
            </div>
          </label>

          {settings.notifications.overlay && (
            <div style={{ marginTop: '12px', padding: '16px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ fontWeight: 500, marginBottom: '16px' }}>Overlay Style</div>

              {/* Colors */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Background:</span>
                  <input
                    type="color"
                    value={overlayStyle.backgroundColor || '#000000'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, backgroundColor: e.target.value },
                        },
                      })
                    }
                    style={{ width: '40px', height: '30px', cursor: 'pointer' }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Border:</span>
                  <input
                    type="color"
                    value={overlayStyle.borderColor || '#e53935'}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, borderColor: e.target.value },
                        },
                      })
                    }
                    style={{ width: '40px', height: '30px', cursor: 'pointer' }}
                  />
                </label>
              </div>

              {/* Border Width */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Border Width: {overlayStyle.borderWidth || 2}px</span>
                  <input
                    type="range"
                    min="1"
                    max="6"
                    value={overlayStyle.borderWidth || 2}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, borderWidth: Number(e.target.value) },
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </label>
              </div>

              {/* Font Size */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Font Size: {overlayStyle.fontSize || 14}px</span>
                  <input
                    type="range"
                    min="10"
                    max="24"
                    value={overlayStyle.fontSize || 14}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, fontSize: Number(e.target.value) },
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </label>
              </div>

              {/* Font Family */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>Font Family:</label>
                <select
                  value={SYSTEM_FONTS.includes(overlayStyle.fontFamily || '') ? overlayStyle.fontFamily : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') {
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, fontFamily: e.target.value },
                        },
                      });
                      setCustomFont('');
                    }
                  }}
                  style={{ width: '100%', padding: '8px', marginBottom: '8px' }}
                >
                  {SYSTEM_FONTS.map((font) => (
                    <option key={font} value={font} style={{ fontFamily: font }}>
                      {font.split(',')[0]}
                    </option>
                  ))}
                  <option value="custom">Custom (webfont URL or name)</option>
                </select>
                {(!SYSTEM_FONTS.includes(overlayStyle.fontFamily || '') || customFont) && (
                  <input
                    type="text"
                    value={customFont || overlayStyle.fontFamily || ''}
                    onChange={(e) => {
                      setCustomFont(e.target.value);
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, fontFamily: e.target.value },
                        },
                      });
                    }}
                    placeholder="e.g., 'Roboto', sans-serif or URL"
                    style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
                  />
                )}
              </div>

              {/* Auto-hide Timeout */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px' }}>Auto-hide Timeout:</label>
                <select
                  value={overlayStyle.timeout || 0}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      notifications: {
                        ...settings.notifications,
                        overlayStyle: { ...overlayStyle, timeout: Number(e.target.value) },
                      },
                    })
                  }
                  style={{ width: '100%', padding: '8px' }}
                >
                  {TIMEOUT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Opacity */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>Opacity: {Math.round((overlayStyle.opacity ?? 1.0) * 100)}%</span>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={Math.round((overlayStyle.opacity ?? 1.0) * 100)}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        notifications: {
                          ...settings.notifications,
                          overlayStyle: { ...overlayStyle, opacity: Number(e.target.value) / 100 },
                        },
                      })
                    }
                    style={{ flex: 1 }}
                  />
                </label>
              </div>

              {/* Preview */}
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px',
                  backgroundColor: overlayStyle.backgroundColor || '#000000',
                  border: `${overlayStyle.borderWidth || 2}px solid ${overlayStyle.borderColor || '#e53935'}`,
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: `${overlayStyle.fontSize || 14}px`,
                  fontFamily: overlayStyle.fontFamily || 'system-ui, sans-serif',
                  opacity: overlayStyle.opacity ?? 1.0,
                }}
              >
                Preview: This is how the overlay will look
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          style={{
            marginTop: '16px',
            padding: '10px 20px',
            backgroundColor: saved ? '#4caf50' : '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          General
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.preselectLastCategory}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  preselectLastCategory: e.target.checked,
                })
              }
              style={{ width: '18px', height: '18px' }}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Preselect Last Used Category</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                When creating a new note, preselect the last category you used
              </div>
            </div>
          </label>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Popup Window Height:
            </label>
            <input
              type="number"
              min="600"
              max="1200"
              step="50"
              value={settings.popupHeight}
              placeholder="600"
              onChange={(e) => {
                const parsedValue = Number(e.target.value);
                const popupHeight = Number.isFinite(parsedValue)
                  ? Math.max(600, Math.min(1200, parsedValue))
                  : 600;
                setSettings({
                  ...settings,
                  popupHeight,
                });
              }}
              style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
            <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
              Height of the popup window in pixels (600-1200px, default: 600px)
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
              Edit View Mode:
            </label>
            <select
              value={settings.editViewMode || 'tab'}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  editViewMode: e.target.value === 'modal' ? 'modal' : 'tab',
                })
              }
              style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
            >
              <option value="tab">Edit Tab (recommended)</option>
              <option value="modal">Modal Window</option>
            </select>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
              Choose how note editing opens in popup and mobile views.
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          style={{
            marginTop: '16px',
            padding: '10px 20px',
            backgroundColor: saved ? '#4caf50' : '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          🏷️ Categories
        </h2>

        {/* Add new category */}
        <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid #eee' }}>
          <div style={{ marginBottom: '8px', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => { setNewCategoryName(e.target.value); setCategoryError(''); }}
              placeholder="New category name"
              style={{
                flex: 1,
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            />
            <input
              type="color"
              value={newCategoryColor}
              onChange={(e) => setNewCategoryColor(e.target.value)}
              style={{
                width: '40px',
                height: '36px',
                padding: '2px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            />
          </div>
          <button
            onClick={handleAddCategory}
            disabled={!newCategoryName.trim()}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: newCategoryName.trim() ? '#4a90d9' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: newCategoryName.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            Add Category
          </button>
          {categoryError && (
            <div style={{ color: '#e53935', fontSize: '12px', marginTop: '8px' }}>
              {categoryError}
            </div>
          )}
        </div>

        {/* List categories */}
        <div>
          {categories.length === 0 ? (
            <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
              No categories yet. Add one above.
            </div>
          ) : (
            categories.map((category) => {
              const noteCount = notes.filter((n) => n.categoryId === category.id).length;
              const isEditing = editingCategoryId === category.id;
              
              return (
                <div
                  key={category.id}
                  style={{
                    padding: '12px',
                    borderBottom: '1px solid #eee',
                  }}
                >
                  {isEditing ? (
                    // Edit mode
                    <div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                        <input
                          type="color"
                          value={editingCategoryColor}
                          onChange={(e) => setEditingCategoryColor(e.target.value)}
                          style={{
                            width: '40px',
                            height: '40px',
                            padding: '2px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        />
                        <input
                          type="text"
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          style={{
                            flex: 1,
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '14px',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '11px', color: '#999', marginBottom: '8px', marginLeft: '48px' }}>
                        UUID: {category.id}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginLeft: '48px' }}>
                        <button
                          onClick={handleSaveCategoryEdit}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#7cb342',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                          }}
                        >
                          ✓ Save
                        </button>
                        <button
                          onClick={handleCancelCategoryEdit}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#999',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Display mode
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div
                          onClick={() => handleEditCategory(category)}
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '4px',
                            backgroundColor: category.color,
                            cursor: 'pointer',
                            border: '2px solid transparent',
                            transition: 'border-color 0.2s',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.borderColor = '#4a90d9'}
                          onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                          title="Click to edit category"
                        />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span
                            onClick={() => handleEditCategory(category)}
                            style={{ cursor: 'pointer', fontWeight: 500 }}
                            title="Click to edit category"
                          >
                            {category.name}
                          </span>
                          <span style={{ fontSize: '10px', color: '#999' }}>
                            {category.id}
                          </span>
                        </div>
                        <span style={{ fontSize: '11px', color: '#666' }}>({noteCount} notes)</span>
                        
                        {/* WebDAV sync checkbox */}
                        {settings.webdavEnabled && (
                          <label 
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px', fontSize: '12px', cursor: 'pointer' }}
                            title="Enable/disable WebDAV synchronization for this category"
                          >
                            <input
                              type="checkbox"
                              checked={category.webdavSync || false}
                              onChange={async (e) => {
                                const updated = { ...category, webdavSync: e.target.checked };
                                await storageService.saveCategory(updated);
                                await loadCategories();
                              }}
                              style={{ width: '14px', height: '14px' }}
                            />
                            <span style={{ color: '#666' }}>Sync to server</span>
                          </label>
                        )}
                      </div>
                      <button
                        onClick={() => setDeletingCategory(category)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#e53935',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          fontSize: '16px',
                        }}
                        title="Delete category"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Delete category modal */}
        {deletingCategory && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
              zIndex: 1000,
            }}
            onClick={() => setDeletingCategory(null)}
          >
            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: '8px',
                padding: '20px',
                width: '100%',
                maxWidth: '400px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>
                Delete Category "{deletingCategory.name}"
              </h3>

              {notes.filter((n) => n.categoryId === deletingCategory.id).length > 0 ? (
                <>
                  <p style={{ color: '#666', marginBottom: '16px' }}>
                    This category has {notes.filter((n) => n.categoryId === deletingCategory.id).length} note(s).
                    What should happen to them?
                  </p>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                      <input
                        type="radio"
                        name="deleteAction"
                        checked={deleteAction === 'remove'}
                        onChange={() => setDeleteAction('remove')}
                      />
                      <span>Remove category tag (items become uncategorized)</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                      <input
                        type="radio"
                        name="deleteAction"
                        checked={deleteAction === 'move'}
                        onChange={() => setDeleteAction('move')}
                        style={{ marginTop: '4px' }}
                      />
                      <div style={{ flex: 1 }}>
                        <span>Move items to another category:</span>
                        {deleteAction === 'move' && (
                          <select
                            value={targetCategoryId}
                            onChange={(e) => setTargetCategoryId(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              marginTop: '8px',
                            }}
                          >
                            <option value="">Select category...</option>
                            {categories.filter((c) => c.id !== deletingCategory.id).map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '8px', backgroundColor: '#ffebee', borderRadius: '4px', border: '1px solid #ef5350' }}>
                      <input
                        type="radio"
                        name="deleteAction"
                        checked={deleteAction === 'delete'}
                        onChange={() => setDeleteAction('delete')}
                      />
                      <span style={{ fontWeight: 500, color: '#c62828' }}>Delete all notes permanently ⚠️</span>
                    </label>
                  </div>
                </>
              ) : (
                <p style={{ color: '#666', marginBottom: '16px' }}>
                  This category has no items. Are you sure you want to delete it?
                </p>
              )}

              {/* WebDAV delete option */}
              {settings.webdavEnabled && deletingCategory.webdavSync && (
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#fff3cd', borderRadius: '4px', border: '1px solid #ffc107' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={deleteFromWebDAV}
                      onChange={(e) => setDeleteFromWebDAV(e.target.checked)}
                      style={{ width: '16px', height: '16px' }}
                    />
                    <span style={{ fontWeight: 500 }}>Also delete from WebDAV server</span>
                  </label>
                  <p style={{ fontSize: '12px', color: '#666', marginTop: '8px', marginLeft: '24px' }}>
                    {deleteFromWebDAV ? 
                      'The category file will be permanently deleted from the server.' : 
                      'The category file will remain on the server.'}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  onClick={handleDeleteCategory}
                  disabled={deleteAction === 'move' && !targetCategoryId}
                  style={{
                    flex: 1,
                    padding: '10px',
                    backgroundColor: deleteAction === 'move' && !targetCategoryId ? '#ccc' : '#e53935',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: deleteAction === 'move' && !targetCategoryId ? 'not-allowed' : 'pointer',
                  }}
                >
                  Delete Category
                </button>
                <button
                  onClick={() => setDeletingCategory(null)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#eee',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          ⏰ Notes with Reminders
        </h2>
        {(() => {
          const notesWithReminders = notes
            .filter((n) => n.hasReminder && n.nextTrigger)
            .sort((a, b) => (a.nextTrigger || 0) - (b.nextTrigger || 0));

          if (notesWithReminders.length === 0) {
            return (
              <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                No notes with reminders yet.
              </div>
            );
          }

          const totalPages = Math.ceil(notesWithReminders.length / REMINDERS_PER_PAGE);
          const startIdx = reminderNotesPage * REMINDERS_PER_PAGE;
          const endIdx = startIdx + REMINDERS_PER_PAGE;
          const paginatedNotes = notesWithReminders.slice(startIdx, endIdx);

          return (
            <div>
              {/* Pagination info */}
              <div style={{ marginBottom: '12px', fontSize: '13px', color: '#666', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  Showing {startIdx + 1}-{Math.min(endIdx, notesWithReminders.length)} of {notesWithReminders.length} notes
                </span>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setReminderNotesPage(Math.max(0, reminderNotesPage - 1))}
                      disabled={reminderNotesPage === 0}
                      style={{
                        padding: '4px 12px',
                        backgroundColor: reminderNotesPage === 0 ? '#ccc' : '#4a90d9',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: reminderNotesPage === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      ← Prev
                    </button>
                    <span style={{ padding: '4px 8px' }}>
                      Page {reminderNotesPage + 1} of {totalPages}
                    </span>
                    <button
                      onClick={() => setReminderNotesPage(Math.min(totalPages - 1, reminderNotesPage + 1))}
                      disabled={reminderNotesPage >= totalPages - 1}
                      style={{
                        padding: '4px 12px',
                        backgroundColor: reminderNotesPage >= totalPages - 1 ? '#ccc' : '#4a90d9',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: reminderNotesPage >= totalPages - 1 ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>

              {paginatedNotes.map((note) => {
                const category = categories.find((c) => c.id === note.categoryId);
                const isOverdue = note.nextTrigger ? note.nextTrigger <= Date.now() : false;
                const nextDate = note.nextTrigger ? new Date(note.nextTrigger) : null;
                const isoStr = nextDate ? nextDate.toISOString() : '';
                const timeStr = nextDate ? nextDate.toLocaleString() : '';
                const firstLine = note.content ? note.content.split('\n')[0] : '';
                const truncatedContent = firstLine.length > 80 ? firstLine.substring(0, 80) + '…' : firstLine;

                return (
                  <div
                    key={note.id}
                    title={`${note.title || 'Untitled'}\n\n${note.content}`}
                    style={{
                      padding: '12px',
                      marginBottom: '8px',
                      borderRadius: '8px',
                      backgroundColor: category ? category.color + '15' : '#f5f5f5',
                      borderLeft: category ? `4px solid ${category.color}` : '4px solid #ddd',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '16px' }}>🔔</span>
                      <span style={{ fontWeight: 600 }}>{note.title || 'Untitled'}</span>
                      {isOverdue && (
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#ffebee',
                          color: '#e53935',
                        }}>
                          Overdue
                        </span>
                      )}
                      {note.scheduleType === 'recurring' && (
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#e3f2fd',
                          color: '#1976d2',
                        }}>
                          Recurring
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      {note.url}
                    </div>
                    {truncatedContent && (
                      <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                        {truncatedContent}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {category && (
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: category.color + '20',
                          color: category.color,
                        }}>
                          {category.name}
                        </span>
                      )}
                      <span
                        title={isoStr}
                        style={{ fontSize: '11px', color: isOverdue ? '#e53935' : '#666' }}
                      >
                        📅 {timeStr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          Statistics
        </h2>
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>📝 Notes ({stats.notesTotal})</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Exact: {stats.notesExact} | Path: {stats.notesPath} | Domain: {stats.notesDomain} | Regex: {stats.notesRegex}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>⏰ Reminders ({stats.remindersTotal})</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Recurring: {stats.remindersRecurring} | Overdue: {stats.remindersOverdue}
              </div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>🏷️ Categories</div>
              <div style={{ fontSize: '13px', color: '#666' }}>{stats.categoriesTotal} categories</div>
            </div>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>💾 Storage Used</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                {formatBytes(stats.storageBytes)}
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          Data Management
        </h2>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleExport}
            style={{
              padding: '10px 20px',
              backgroundColor: '#fff',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Export Data
          </button>

          <label
            style={{
              padding: '10px 20px',
              backgroundColor: '#fff',
              color: '#333',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'inline-block',
            }}
          >
            Import Data
            <input
              type="file"
              accept=".json"
              onChange={handleImportSelect}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {importPreview && (
          <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#fff3cd', borderRadius: '8px', border: '1px solid #ffc107' }}>
            <div style={{ fontWeight: 600, marginBottom: '12px' }}>📦 Import Preview</div>
            <div style={{ marginBottom: '12px', fontSize: '14px' }}>
              <div>📝 Notes: {importPreview.notes}</div>
              <div>⏰ Reminders: {importPreview.reminders}</div>
              <div>🏷️ Categories: {importPreview.categories}</div>
              <div>⚙️ Settings: {importPreview.hasSettings ? 'Yes' : 'No'}</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleImportConfirm}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#4caf50',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Confirm Import
              </button>
              <button
                onClick={handleImportCancel}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f44336',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          🗑️ Trash
        </h2>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px' }}>Deleted Notes: {deletedNotesCount}</div>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
              Deleted notes are kept for synchronization across devices. Use "Empty Trash" to permanently remove them.
            </div>
            {settings?.lastDeleteAllTimestamp && (
              <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
                Last emptied: {new Date(settings.lastDeleteAllTimestamp).toLocaleString()}
              </div>
            )}
            <button
              onClick={handleDeleteAllTrash}
              disabled={deletedNotesCount === 0}
              style={{
                padding: '10px 20px',
                backgroundColor: deletedNotesCount === 0 ? '#ccc' : '#f44336',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: deletedNotesCount === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Empty Trash ({deletedNotesCount})
            </button>
          </div>
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '18px', marginBottom: '16px', borderBottom: '2px solid #ddd', paddingBottom: '8px' }}>
          About
        </h2>
        <p style={{ color: '#666' }}>
          TabReminder v{process.env.APP_VERSION || '1.0.0'}
          <br />
          <span style={{ fontSize: '12px', color: '#999' }}>Build: {process.env.GIT_HASH || 'dev'}</span>
          <br /><br />
          Remind yourself with notes when revisiting pages and schedule time-based reminders.
        </p>
      </section>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Options />);
}
