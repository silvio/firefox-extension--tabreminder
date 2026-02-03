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
  remindersTotal: number;
  remindersRecurring: number;
  remindersOverdue: number;
  categoriesTotal: number;
  storageBytes: number;
  compressedBytes: number;
}

interface ImportPreview {
  notes: number;
  reminders: number;
  categories: number;
  hasSettings: boolean;
}

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [pendingImportData, setPendingImportData] = useState<string | null>(null);
  const [customFont, setCustomFont] = useState('');

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  async function loadSettings() {
    try {
      const data = await storageService.getSettings();
      setSettings(data);
      if (data.notifications.overlayStyle?.fontFamily &&
          !SYSTEM_FONTS.includes(data.notifications.overlayStyle.fontFamily)) {
        setCustomFont(data.notifications.overlayStyle.fontFamily);
      }
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
      const { rawBytes, compressedBytes } = await storageService.getStorageStats();

      setStats({
        notesTotal: notes.length,
        notesExact: notes.filter((n) => n.urlMatchType === 'exact').length,
        notesPath: notes.filter((n) => n.urlMatchType === 'path').length,
        notesDomain: notes.filter((n) => n.urlMatchType === 'domain').length,
        remindersTotal: reminders.length,
        remindersRecurring: reminders.filter((r) => r.scheduleType === 'recurring').length,
        remindersOverdue: reminders.filter((r) => r.nextTrigger <= now).length,
        categoriesTotal: categories.length,
        storageBytes: rawBytes,
        compressedBytes,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  async function handleSave() {
    if (!settings) return;
    await storageService.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleSyncToggle(enabled: boolean) {
    if (!settings) return;
    try {
      await storageService.setSyncEnabled(enabled);
      setSettings({ ...settings, syncEnabled: enabled });
    } catch (error) {
      console.error('Error toggling sync:', error);
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
          Sync
        </h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(e) => handleSyncToggle(e.target.checked)}
            style={{ width: '18px', height: '18px' }}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Sync with Firefox Account</div>
            <div style={{ fontSize: '13px', color: '#666' }}>
              Sync your notes and reminders across devices (max ~100KB)
            </div>
          </div>
        </label>
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
              min="400"
              max="1200"
              step="50"
              value={settings.popupHeight}
              placeholder="600"
              onChange={(e) =>
                setSettings({
                  ...settings,
                  popupHeight: Number(e.target.value),
                })
              }
              style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
            />
            <div style={{ fontSize: '13px', color: '#666', marginTop: '4px' }}>
              Height of the popup window in pixels (400-1200px, default: 600px)
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
          Statistics
        </h2>
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>📝 Notes ({stats.notesTotal})</div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Exact: {stats.notesExact} | Path: {stats.notesPath} | Domain: {stats.notesDomain}
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
                Raw: {formatBytes(stats.storageBytes)}
              </div>
              <div style={{ fontSize: '13px', color: '#666' }}>
                Compressed: {formatBytes(stats.compressedBytes)} ({Math.round((stats.compressedBytes / stats.storageBytes) * 100)}%)
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
