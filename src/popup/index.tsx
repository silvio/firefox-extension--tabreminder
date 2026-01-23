import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { storageService } from '../shared/services/storage';
import { alarmService } from '../shared/services/alarms';
import { PageNote, TimeReminder, Category, UrlMatchType, TriggeredReminder, RecurringPattern, FrequencyType, EndCondition } from '../shared/types';
import { createNote, createReminder, getUrlMatchPreview } from '../shared/utils/helpers';
import { parseTimeInput, formatDate, formatRelativeTime, getNextOccurrences, calculateNextTrigger, describeRecurringPattern } from '../shared/utils/timeParser';
import { usePopupState } from '../shared/hooks/usePopupState';

type Tab = 'current' | 'notes' | 'reminders' | 'triggered';

function Popup() {
  const { state: popupState, updateState: updatePopupState, resetNoteForm, resetReminderForm } = usePopupState();
  const [activeTab, setActiveTab] = useState<Tab>(popupState.activeTab as Tab);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [currentPageTitle, setCurrentPageTitle] = useState<string>('');
  const [matchingNotes, setMatchingNotes] = useState<PageNote[]>([]);
  const [pageReminders, setPageReminders] = useState<TimeReminder[]>([]);
  const [notes, setNotes] = useState<PageNote[]>([]);
  const [reminders, setReminders] = useState<TimeReminder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [triggeredReminders, setTriggeredReminders] = useState<TriggeredReminder[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>(popupState.filterCategory);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    updatePopupState({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    updatePopupState({ filterCategory });
  }, [filterCategory]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [tabs, notesData, remindersData, categoriesData, triggeredData] = await Promise.all([
        browser.tabs.query({ active: true, currentWindow: true }),
        storageService.getNotes(),
        storageService.getReminders(),
        storageService.getCategories(),
        storageService.getTriggeredReminders(),
      ]);

      const url = tabs[0]?.url || '';
      const title = tabs[0]?.title || '';
      setCurrentUrl(url);
      setCurrentPageTitle(title);
      setNotes(notesData);
      setReminders(remindersData);
      setCategories(categoriesData);
      setTriggeredReminders(triggeredData);

      if (url) {
        const matching = await storageService.getNotesForUrl(url);
        setMatchingNotes(matching);

        // Find reminders for this page (exact URL match)
        const pageRems = remindersData.filter((r) => {
          try {
            const rUrl = new URL(r.url);
            const pUrl = new URL(url);
            return rUrl.hostname === pUrl.hostname && rUrl.pathname === pUrl.pathname;
          } catch {
            return false;
          }
        });
        setPageReminders(pageRems);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div style={{ padding: '16px' }}>Loading...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '500px' }}>
      <header style={{ padding: '12px 16px', borderBottom: '2px solid #ddd', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
          TabReminder
        </h1>
      </header>

      <nav style={{ display: 'flex', borderBottom: '2px solid #ddd', flexShrink: 0 }}>
        {(['current', 'notes', 'reminders', 'triggered'] as Tab[]).map((tab) => {
          const tabLabels: Record<Tab, string> = {
            current: '📄 This Page',
            notes: '📝 Notes',
            reminders: '⏰ Reminders',
            triggered: '🔔',
          };
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                background: activeTab === tab ? '#f0f0f0' : 'transparent',
                cursor: 'pointer',
                fontWeight: activeTab === tab ? 600 : 400,
                borderBottom:
                  activeTab === tab ? '2px solid #4a90d9' : '2px solid transparent',
                position: 'relative',
                fontSize: '12px',
              }}
            >
              {tabLabels[tab]}
              {tab === 'triggered' && triggeredReminders.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  backgroundColor: '#e53935',
                  color: '#fff',
                  borderRadius: '50%',
                  fontSize: '10px',
                  width: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {triggeredReminders.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <main style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {activeTab === 'current' && (
          <CurrentPageTab
            url={currentUrl}
            pageTitle={currentPageTitle}
            matchingNotes={matchingNotes}
            pageReminders={pageReminders}
            categories={categories}
            savedState={{
              title: popupState.noteTitle,
              content: popupState.noteContent,
              urlMatchType: popupState.noteUrlMatchType as UrlMatchType,
              categoryId: popupState.noteCategoryId,
              matchUrl: popupState.noteMatchUrl || currentUrl,
            }}
            onStateChange={(state) => updatePopupState({
              noteTitle: state.title,
              noteContent: state.content,
              noteUrlMatchType: state.urlMatchType,
              noteCategoryId: state.categoryId,
              noteMatchUrl: state.matchUrl,
            })}
            onSave={async (note) => {
              await storageService.saveNote(note);
              setNotes(await storageService.getNotes());
              setMatchingNotes(await storageService.getNotesForUrl(currentUrl));
              browser.runtime.sendMessage({ type: 'NOTE_UPDATED' });
              resetNoteForm();
            }}
            onDelete={async (id) => {
              await storageService.deleteNote(id);
              setNotes(await storageService.getNotes());
              setMatchingNotes(await storageService.getNotesForUrl(currentUrl));
              browser.runtime.sendMessage({ type: 'NOTE_DELETED' });
              resetNoteForm();
            }}
            onEditNote={(note) => {
              updatePopupState({
                noteTitle: note.title,
                noteContent: note.content,
                noteUrlMatchType: note.urlMatchType,
                noteCategoryId: note.categoryId || '',
                noteMatchUrl: note.url,
              });
            }}
            onDeleteReminder={async (id) => {
              await storageService.deleteReminder(id);
              setReminders(await storageService.getReminders());
              const pageRems = reminders.filter((r) => {
                try {
                  const rUrl = new URL(r.url);
                  const pUrl = new URL(currentUrl);
                  return rUrl.hostname === pUrl.hostname && rUrl.pathname === pUrl.pathname && r.id !== id;
                } catch {
                  return false;
                }
              });
              setPageReminders(pageRems);
              browser.runtime.sendMessage({ type: 'REMINDER_DELETED' });
            }}
          />
        )}

        {activeTab === 'notes' && (
          <NotesListTab
            notes={notes}
            categories={categories}
            filterCategory={filterCategory}
            onFilterChange={setFilterCategory}
            onDelete={async (id) => {
              await storageService.deleteNote(id);
              setNotes(await storageService.getNotes());
              browser.runtime.sendMessage({ type: 'NOTE_DELETED' });
            }}
          />
        )}

        {activeTab === 'reminders' && (
          <RemindersTab
            reminders={reminders}
            categories={categories}
            currentUrl={currentUrl}
            savedState={{
              title: popupState.reminderTitle,
              timeInput: popupState.reminderTimeInput,
              categoryId: popupState.reminderCategoryId,
              matchUrl: popupState.reminderMatchUrl || currentUrl,
            }}
            onStateChange={(state) => updatePopupState({
              reminderTitle: state.title,
              reminderTimeInput: state.timeInput,
              reminderCategoryId: state.categoryId,
              reminderMatchUrl: state.matchUrl,
            })}
            onAdd={async (reminder) => {
              await storageService.saveReminder(reminder);
              setReminders(await storageService.getReminders());
              browser.runtime.sendMessage({ type: 'REMINDER_CREATED' });
              resetReminderForm();
            }}
            onDelete={async (id) => {
              await storageService.deleteReminder(id);
              setReminders(await storageService.getReminders());
              browser.runtime.sendMessage({ type: 'REMINDER_DELETED' });
            }}
            onClearOverdue={async () => {
              const now = Date.now();
              for (const reminder of reminders) {
                if (reminder.nextTrigger <= now) {
                  if (reminder.scheduleType === 'recurring' && reminder.recurringPattern) {
                    reminder.nextTrigger = calculateNextTrigger(reminder.recurringPattern);
                    await storageService.saveReminder(reminder);
                  } else {
                    await storageService.deleteReminder(reminder.id);
                  }
                }
              }
              setReminders(await storageService.getReminders());
              browser.runtime.sendMessage({ type: 'REMINDER_DELETED' });
            }}
          />
        )}

        {activeTab === 'triggered' && (
          <TriggeredTab
            triggeredReminders={triggeredReminders}
            onNavigate={async (triggered) => {
              // Find existing tab with URL or open new tab
              const tabs = await browser.tabs.query({ url: triggered.url });
              if (tabs.length > 0 && tabs[0].id) {
                await browser.tabs.update(tabs[0].id, { active: true });
                if (tabs[0].windowId) {
                  await browser.windows.update(tabs[0].windowId, { focused: true });
                }
              } else {
                await browser.tabs.create({ url: triggered.url });
              }
              // Dismiss and update badge
              await storageService.dismissTriggeredReminder(triggered.id);
              setTriggeredReminders(await storageService.getTriggeredReminders());
              await alarmService.updateTriggeredBadge();
            }}
            onDismiss={async (id) => {
              await storageService.dismissTriggeredReminder(id);
              setTriggeredReminders(await storageService.getTriggeredReminders());
              await alarmService.updateTriggeredBadge();
            }}
            onClearAll={async () => {
              await storageService.clearAllTriggeredReminders();
              setTriggeredReminders([]);
              await alarmService.updateTriggeredBadge();
            }}
          />
        )}
      </main>

      <footer style={{
        padding: '8px 16px',
        borderTop: '2px solid #ddd',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f9f9f9',
      }}>
        <span style={{ fontSize: '10px', color: '#999' }}>
          v{process.env.APP_VERSION} ({process.env.GIT_HASH})
        </span>
        <button
          onClick={() => browser.runtime.openOptionsPage()}
          title="Settings"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px 8px',
            color: '#666',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          ⚙️ Settings
        </button>
      </footer>
    </div>
  );
}

interface NoteFormState {
  title: string;
  content: string;
  urlMatchType: UrlMatchType;
  categoryId: string;
  matchUrl: string;
}

interface CurrentPageTabProps {
  url: string;
  pageTitle: string;
  matchingNotes: PageNote[];
  pageReminders: TimeReminder[];
  categories: Category[];
  savedState: NoteFormState;
  onStateChange: (state: NoteFormState) => void;
  onSave: (note: PageNote) => void;
  onDelete: (id: string) => void;
  onEditNote: (note: PageNote) => void;
  onDeleteReminder: (id: string) => void;
}

function CurrentPageTab({
  url,
  pageTitle,
  matchingNotes,
  pageReminders,
  categories,
  savedState,
  onStateChange,
  onSave,
  onDelete,
  onEditNote,
  onDeleteReminder,
}: CurrentPageTabProps) {
  const [editingNote, setEditingNote] = useState<PageNote | null>(null);
  const [title, setTitle] = useState(savedState.title || pageTitle);
  const [content, setContent] = useState(savedState.content);
  const [urlMatchType, setUrlMatchType] = useState<UrlMatchType>(
    savedState.urlMatchType || 'exact'
  );
  const [categoryId, setCategoryId] = useState<string>(savedState.categoryId);
  const [matchUrl, setMatchUrl] = useState<string>(savedState.matchUrl || url);

  useEffect(() => {
    if (editingNote) {
      setTitle(editingNote.title);
      setContent(editingNote.content);
      setUrlMatchType(editingNote.urlMatchType);
      setCategoryId(editingNote.categoryId || '');
      setMatchUrl(editingNote.url);
    } else {
      if (!savedState.title && pageTitle) {
        setTitle(pageTitle);
      }
      setMatchUrl(url);
    }
  }, [editingNote, url, pageTitle]);

  useEffect(() => {
    onStateChange({ title, content, urlMatchType, categoryId, matchUrl });
  }, [title, content, urlMatchType, categoryId, matchUrl]);

  if (!url || url.startsWith('about:') || url.startsWith('moz-extension:')) {
    return (
      <div style={{ color: '#666', textAlign: 'center' }}>
        Cannot add notes to this page.
      </div>
    );
  }

  function handleSave() {
    const updatedNote = editingNote
      ? {
          ...editingNote,
          url: matchUrl,
          title,
          content,
          urlMatchType,
          categoryId: categoryId || null,
          updatedAt: Date.now(),
        }
      : createNote(matchUrl, title, content, urlMatchType, categoryId || null);
    onSave(updatedNote);
    setEditingNote(null);
    setTitle(pageTitle);
    setContent('');
  }

  function resetUrlTo(type: UrlMatchType) {
    setUrlMatchType(type);
    setMatchUrl(url);
  }

  return (
    <div>
      {/* Existing notes for this page */}
      {matchingNotes.length > 0 && (
        <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #ddd' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
            📝 Notes for this page ({matchingNotes.length})
          </div>
          {matchingNotes.map((note) => (
            <div
              key={note.id}
              className="hover-item"
              style={{
                padding: '8px',
                marginBottom: '4px',
                backgroundColor: editingNote?.id === note.id ? '#e3f2fd' : '#f9f9f9',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <strong>{note.title || 'Untitled'}</strong>
                  <span style={{ marginLeft: '8px', fontSize: '10px', color: '#999', textTransform: 'uppercase' }}>
                    {note.urlMatchType}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setEditingNote(note)}
                    className="icon-btn"
                    title="Edit"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: '#4a90d9' }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => onDelete(note.id)}
                    className="icon-btn"
                    title="Delete"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: '#e53935' }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <div style={{ color: '#666', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {note.content.substring(0, 80)}{note.content.length > 80 ? '...' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reminders for this page */}
      {pageReminders.length > 0 && (
        <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #ddd' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
            ⏰ Reminders for this page ({pageReminders.length})
          </div>
          {pageReminders.map((reminder) => (
            <div
              key={reminder.id}
              className="hover-item"
              style={{
                padding: '8px',
                marginBottom: '4px',
                backgroundColor: reminder.nextTrigger <= Date.now() ? '#fff3f3' : '#f9f9f9',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong>{reminder.title}</strong>
                  {reminder.scheduleType === 'recurring' && (
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: '#1976d2', backgroundColor: '#e3f2fd', padding: '1px 4px', borderRadius: '4px' }}>
                      Recurring
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onDeleteReminder(reminder.id)}
                  className="icon-btn"
                  title="Delete"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', color: '#e53935' }}
                >
                  🗑️
                </button>
              </div>
              <div style={{ color: reminder.nextTrigger <= Date.now() ? '#e53935' : '#666', marginTop: '4px', fontSize: '11px' }}>
                {formatRelativeTime(reminder.nextTrigger)} • {formatDate(new Date(reminder.nextTrigger))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Note form */}
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
        {editingNote ? '✏️ Edit Note' : '➕ Add New Note'}
        {editingNote && (
          <button
            onClick={() => { setEditingNote(null); setTitle(pageTitle); setContent(''); }}
            style={{ marginLeft: '8px', fontSize: '11px', color: '#4a90d9', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Cancel edit
          </button>
        )}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
          Match URL
        </label>
        <input
          type="text"
          value={matchUrl}
          onChange={(e) => setMatchUrl(e.target.value)}
          placeholder="URL to match..."
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxSizing: 'border-box',
            fontSize: '11px',
          }}
        />
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
          {(['exact', 'path', 'domain'] as UrlMatchType[]).map((type) => (
            <button
              key={type}
              onClick={() => resetUrlTo(type)}
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                background: urlMatchType === type ? '#4a90d9' : '#fff',
                color: urlMatchType === type ? '#fff' : '#666',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
          Note (supports **bold**, *italic*, `code`, [links](url))
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter your note..."
          rows={4}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div
          style={{
            padding: '6px 8px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#666',
            wordBreak: 'break-all',
          }}
        >
          <strong>Will match:</strong> {getUrlMatchPreview(matchUrl, urlMatchType)}
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
          Category
        </label>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        >
          <option value="">⬜ No category</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id} style={{ color: cat.color }}>
              ● {cat.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleSave}
          disabled={!content.trim()}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: content.trim() ? 'pointer' : 'not-allowed',
            opacity: content.trim() ? 1 : 0.5,
          }}
        >
          {editingNote ? 'Update Note' : 'Save Note'}
        </button>
      </div>
    </div>
  );
}

interface NotesListTabProps {
  notes: PageNote[];
  categories: Category[];
  filterCategory: string;
  onFilterChange: (category: string) => void;
  onDelete: (id: string) => void;
}

function NotesListTab({
  notes,
  categories,
  filterCategory,
  onFilterChange,
  onDelete,
}: NotesListTabProps) {
  const filteredNotes =
    filterCategory === 'all'
      ? notes
      : notes.filter((n) => n.categoryId === filterCategory);

  function openNote(url: string) {
    browser.tabs.create({ url });
  }

  return (
    <div>
      <div style={{ marginBottom: '12px' }}>
        <select
          value={filterCategory}
          onChange={(e) => onFilterChange(e.target.value)}
          style={{
            width: '100%',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        >
          <option value="all">All categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id} style={{ color: cat.color }}>
              ● {cat.name}
            </option>
          ))}
        </select>
      </div>

      {filteredNotes.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
          No notes found.
        </div>
      ) : (
        <div>
          {filteredNotes.map((note) => {
            const category = categories.find((c) => c.id === note.categoryId);
            return (
              <div
                key={note.id}
                className="hover-item"
                style={{
                  padding: '10px',
                  borderBottom: '2px solid #ddd',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                    {note.title || 'Untitled'}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#666',
                      wordBreak: 'break-all',
                      marginBottom: '4px',
                    }}
                  >
                    {note.url}
                  </div>
                  {category && (
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        backgroundColor: category.color + '20',
                        color: category.color,
                      }}
                    >
                      {category.name}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <button
                    onClick={() => openNote(note.url)}
                    title="Open page"
                    className="icon-btn"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4a90d9',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '14px',
                      borderRadius: '4px',
                    }}
                  >
                    🔗
                  </button>
                  <button
                    onClick={() => onDelete(note.id)}
                    title="Delete note"
                    className="icon-btn"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#e53935',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '14px',
                      borderRadius: '4px',
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ReminderFormState {
  title: string;
  timeInput: string;
  categoryId: string;
  matchUrl: string;
}

type ScheduleMode = 'once' | 'recurring' | 'relative';

interface RemindersTabProps {
  reminders: TimeReminder[];
  categories: Category[];
  currentUrl: string;
  savedState: ReminderFormState;
  onStateChange: (state: ReminderFormState) => void;
  onAdd: (reminder: TimeReminder) => void;
  onDelete: (id: string) => void;
  onClearOverdue: () => void;
}

function RemindersTab({
  reminders,
  categories,
  currentUrl,
  savedState,
  onStateChange,
  onAdd,
  onDelete,
  onClearOverdue,
}: RemindersTabProps) {
  const [title, setTitle] = useState(savedState.title);
  const [timeInput, setTimeInput] = useState(savedState.timeInput);
  const [categoryId, setCategoryId] = useState(savedState.categoryId);
  const [matchUrl, setMatchUrl] = useState(savedState.matchUrl || currentUrl);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('relative');
  const [error, setError] = useState('');
  const [expandedReminder, setExpandedReminder] = useState<string | null>(null);

  // Evolution-style recurrence state
  const [recFrequency, setRecFrequency] = useState<FrequencyType>('daily');
  const [recInterval, setRecInterval] = useState(1);
  const [recWeekdays, setRecWeekdays] = useState<number[]>([1]); // Mon default
  const [recDayOfMonth, setRecDayOfMonth] = useState(1);
  const [recMonthlyMode, setRecMonthlyMode] = useState<'day' | 'weekday'>('day');
  const [recOrdinal, setRecOrdinal] = useState(1);
  const [recOrdinalWeekday, setRecOrdinalWeekday] = useState(1);
  const [recEndType, setRecEndType] = useState<'never' | 'date' | 'count'>('never');
  const [recEndDate, setRecEndDate] = useState('');
  const [recEndCount, setRecEndCount] = useState(10);
  const now = new Date();
  const defaultHour = now.getMinutes() >= 59 ? (now.getHours() + 1) % 24 : now.getHours();
  const defaultMinute = (now.getMinutes() + 1) % 60;
  const [recTimeHour, setRecTimeHour] = useState(defaultHour);
  const [recTimeMinute, setRecTimeMinute] = useState(defaultMinute);

  useEffect(() => {
    setMatchUrl(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    onStateChange({ title, timeInput, categoryId, matchUrl });
  }, [title, timeInput, categoryId, matchUrl]);

  const canAddReminder =
    currentUrl && !currentUrl.startsWith('about:') && !currentUrl.startsWith('moz-extension:');

  function buildRecurringPattern(): RecurringPattern {
    let endCondition: EndCondition = { type: 'never' };
    if (recEndType === 'date' && recEndDate) {
      endCondition = { type: 'date', endDate: new Date(recEndDate).getTime() };
    } else if (recEndType === 'count') {
      endCondition = { type: 'count', occurrences: recEndCount };
    }

    const pattern: RecurringPattern = {
      frequency: recFrequency,
      interval: recInterval,
      endCondition,
      timeOfDay: { hour: recTimeHour, minute: recTimeMinute },
    };

    if (recFrequency === 'weekly') {
      pattern.weekdays = recWeekdays;
    } else if (recFrequency === 'monthly') {
      if (recMonthlyMode === 'day') {
        pattern.dayOfMonth = recDayOfMonth;
      } else {
        pattern.weekdayOrdinal = { ordinal: recOrdinal, weekday: recOrdinalWeekday };
      }
    }

    return pattern;
  }

  function handleAdd() {
    let nextTrigger: number;
    let recurringPattern: RecurringPattern | null = null;
    let isRecurring = false;

    if (scheduleMode === 'recurring') {
      recurringPattern = buildRecurringPattern();
      nextTrigger = calculateNextTrigger(recurringPattern);
      isRecurring = true;
    } else if (timeInput.trim()) {
      const parsed = parseTimeInput(timeInput);
      if (!parsed) {
        setError('Please configure a valid schedule');
        return;
      }
      nextTrigger = parsed.timestamp;
      isRecurring = parsed.isRecurring;
      recurringPattern = parsed.recurringPattern;
    } else {
      setError('Please configure a valid schedule');
      return;
    }

    const reminder = createReminder(
      matchUrl || currentUrl,
      title || `Reminder for ${new URL(matchUrl || currentUrl).hostname}`,
      nextTrigger,
      categoryId || null
    );

    if (isRecurring && recurringPattern) {
      reminder.scheduleType = 'recurring';
      reminder.recurringPattern = recurringPattern;
    }

    onAdd(reminder);
    setTitle('');
    setTimeInput('');
    setCategoryId('');
    setMatchUrl(currentUrl);
    setError('');
  }

  function openUrl(url: string) {
    browser.tabs.create({ url });
  }

  const sortedReminders = [...reminders].sort((a, b) => a.nextTrigger - b.nextTrigger);

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ordinalLabels = ['1st', '2nd', '3rd', '4th', 'Last'];

  const onceOptions = [
    { value: '', label: 'Select a time...' },
    { value: 'tomorrow 9am', label: 'Tomorrow morning (9 AM)' },
    { value: 'tomorrow 2pm', label: 'Tomorrow afternoon (2 PM)' },
    { value: 'next monday 9am', label: 'Next Monday (9 AM)' },
    { value: 'next friday 5pm', label: 'Next Friday (5 PM)' },
  ];

  const relativeOptions = [
    { value: '', label: 'Select duration...' },
    { value: 'in 1 minute', label: 'In 1 minute' },
    { value: 'in 5 minutes', label: 'In 5 minutes' },
    { value: 'in 15 minutes', label: 'In 15 minutes' },
    { value: 'in 30 minutes', label: 'In 30 minutes' },
    { value: 'in 1 hour', label: 'In 1 hour' },
    { value: 'in 2 hours', label: 'In 2 hours' },
    { value: 'in 4 hours', label: 'In 4 hours' },
    { value: 'in 1 day', label: 'In 1 day' },
  ];

  const modeLabels: Record<ScheduleMode, string> = {
    once: 'One time',
    recurring: 'Recurring',
    relative: 'From now',
  };

  return (
    <div>
      {canAddReminder && (
        <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '2px solid #ddd' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
              URL
            </label>
            <input
              type="text"
              value={matchUrl}
              onChange={(e) => setMatchUrl(e.target.value)}
              placeholder="URL for reminder..."
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                boxSizing: 'border-box',
                fontSize: '11px',
              }}
            />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Reminder title (optional)"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
              {(['once', 'recurring', 'relative'] as ScheduleMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setScheduleMode(mode);
                    setTimeInput('');
                    setError('');
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    background: scheduleMode === mode ? '#4a90d9' : '#fff',
                    color: scheduleMode === mode ? '#fff' : '#333',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: scheduleMode === mode ? 600 : 400,
                  }}
                >
                  {modeLabels[mode]}
                </button>
              ))}
            </div>

            {scheduleMode === 'recurring' ? (
              <div style={{ fontSize: '12px' }}>
                {/* Frequency + Interval */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <span>Every</span>
                  <input
                    type="number"
                    min="1"
                    value={recInterval}
                    onChange={(e) => setRecInterval(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ width: '50px', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                  />
                  <select
                    value={recFrequency}
                    onChange={(e) => setRecFrequency(e.target.value as FrequencyType)}
                    style={{ padding: '6px', border: '1px solid #ddd', borderRadius: '4px' }}
                  >
                    <option value="seconds">Second(s)</option>
                    <option value="minutes">Minute(s)</option>
                    <option value="hours">Hour(s)</option>
                    <option value="daily">Day(s)</option>
                    <option value="weekly">Week(s)</option>
                    <option value="monthly">Month(s)</option>
                    <option value="yearly">Year(s)</option>
                  </select>
                </div>

                {/* Weekday checkboxes for weekly */}
                {recFrequency === 'weekly' && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ marginBottom: '4px' }}>On:</div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {dayNames.map((day, idx) => (
                        <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: '2px', fontSize: '11px' }}>
                          <input
                            type="checkbox"
                            checked={recWeekdays.includes(idx)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setRecWeekdays([...recWeekdays, idx].sort());
                              } else if (recWeekdays.length > 1) {
                                setRecWeekdays(recWeekdays.filter((d) => d !== idx));
                              }
                            }}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Monthly options */}
                {recFrequency === 'monthly' && (
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                      <input type="radio" checked={recMonthlyMode === 'day'} onChange={() => setRecMonthlyMode('day')} />
                      <span>On day</span>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={recDayOfMonth}
                        onChange={(e) => setRecDayOfMonth(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                        disabled={recMonthlyMode !== 'day'}
                        style={{ width: '45px', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input type="radio" checked={recMonthlyMode === 'weekday'} onChange={() => setRecMonthlyMode('weekday')} />
                      <span>On the</span>
                      <select
                        value={recOrdinal}
                        onChange={(e) => setRecOrdinal(parseInt(e.target.value))}
                        disabled={recMonthlyMode !== 'weekday'}
                        style={{ padding: '4px', border: '1px solid #ddd', borderRadius: '4px' }}
                      >
                        {ordinalLabels.map((lbl, idx) => (
                          <option key={idx} value={idx + 1}>{lbl}</option>
                        ))}
                      </select>
                      <select
                        value={recOrdinalWeekday}
                        onChange={(e) => setRecOrdinalWeekday(parseInt(e.target.value))}
                        disabled={recMonthlyMode !== 'weekday'}
                        style={{ padding: '4px', border: '1px solid #ddd', borderRadius: '4px' }}
                      >
                        {dayNames.map((day, idx) => (
                          <option key={idx} value={idx}>{day}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {/* End condition */}
                <div style={{ borderTop: '1px solid #eee', paddingTop: '8px', marginTop: '8px' }}>
                  <div style={{ marginBottom: '4px' }}>Ends:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input type="radio" checked={recEndType === 'never'} onChange={() => setRecEndType('never')} />
                      Never
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input type="radio" checked={recEndType === 'date'} onChange={() => setRecEndType('date')} />
                      On date:
                      <input
                        type="date"
                        value={recEndDate}
                        onChange={(e) => setRecEndDate(e.target.value)}
                        disabled={recEndType !== 'date'}
                        style={{ padding: '4px', border: '1px solid #ddd', borderRadius: '4px' }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input type="radio" checked={recEndType === 'count'} onChange={() => setRecEndType('count')} />
                      After
                      <input
                        type="number"
                        min="1"
                        value={recEndCount}
                        onChange={(e) => setRecEndCount(Math.max(1, parseInt(e.target.value) || 1))}
                        disabled={recEndType !== 'count'}
                        style={{ width: '50px', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                      />
                      occurrences
                    </label>
                  </div>
                </div>

                {/* Trigger time (for daily/weekly/monthly/yearly) */}
                {!['seconds', 'minutes', 'hours'].includes(recFrequency) && (
                  <div style={{ borderTop: '1px solid #eee', paddingTop: '8px', marginTop: '8px' }}>
                    <div style={{ marginBottom: '4px' }}>Trigger at:</div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={recTimeHour}
                        onChange={(e) => setRecTimeHour(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                        style={{ width: '45px', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                      />
                      <span>:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={recTimeMinute}
                        onChange={(e) => setRecTimeMinute(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                        style={{ width: '45px', padding: '4px', border: '1px solid #ddd', borderRadius: '4px', textAlign: 'center' }}
                      />
                      <span style={{ fontSize: '11px', color: '#666' }}>
                        ({String(recTimeHour).padStart(2, '0')}:{String(recTimeMinute).padStart(2, '0')})
                      </span>
                    </div>
                  </div>
                )}

                {/* Preview */}
                <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#f5f5f5', borderRadius: '4px', fontSize: '11px', color: '#666' }}>
                  📅 {describeRecurringPattern(buildRecurringPattern())}
                </div>
              </div>
            ) : (
              <select
                value={timeInput}
                onChange={(e) => {
                  setTimeInput(e.target.value);
                  setError('');
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: `1px solid ${error ? '#e53935' : '#ddd'}`,
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              >
                {(scheduleMode === 'once' ? onceOptions : relativeOptions).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {scheduleMode !== 'recurring' && (
              <div style={{ marginTop: '4px', fontSize: '11px', color: '#666' }}>
                Or type: <input
                  type="text"
                  value={timeInput}
                  onChange={(e) => {
                    setTimeInput(e.target.value);
                    setError('');
                  }}
                  placeholder="e.g., next tuesday 3pm"
                  style={{
                    padding: '4px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '11px',
                    width: '150px',
                  }}
                />
              </div>
            )}

            {error && (
              <div style={{ color: '#e53935', fontSize: '12px', marginTop: '4px' }}>
                {error}
              </div>
            )}
          </div>
          <div style={{ marginBottom: '8px' }}>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ddd',
                borderRadius: '4px',
              }}
            >
              <option value="">⬜ No category</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id} style={{ color: cat.color }}>
                  ● {cat.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAdd}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: '#4a90d9',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Add Reminder
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#666' }}>
          Scheduled Reminders
        </div>
        {reminders.filter((r) => r.nextTrigger <= Date.now()).length > 0 && (
          <button
            onClick={onClearOverdue}
            className="icon-btn"
            style={{
              padding: '4px 8px',
              backgroundColor: '#e53935',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
            }}
          >
            Clear Overdue
          </button>
        )}
      </div>

      {sortedReminders.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
          No reminders scheduled.
        </div>
      ) : (
        <div style={{ maxHeight: '250px', overflow: 'auto' }}>
          {sortedReminders.map((reminder) => {
            const category = categories.find((c) => c.id === reminder.categoryId);
            const isOverdue = reminder.nextTrigger <= Date.now();
            return (
              <div
                key={reminder.id}
                style={{
                  padding: '10px',
                  borderBottom: '2px solid #ddd',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  backgroundColor: isOverdue ? '#fff3f3' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                    {reminder.title}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: isOverdue ? '#e53935' : '#666',
                      marginBottom: '4px',
                    }}
                  >
                    {formatRelativeTime(reminder.nextTrigger)} •{' '}
                    {formatDate(new Date(reminder.nextTrigger))}
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#999',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {new URL(reminder.url).hostname}
                  </div>
                  <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    {reminder.scheduleType === 'recurring' && (
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#e3f2fd',
                          color: '#1976d2',
                          cursor: 'pointer',
                        }}
                        onClick={() => setExpandedReminder(
                          expandedReminder === reminder.id ? null : reminder.id
                        )}
                      >
                        Recurring {expandedReminder === reminder.id ? '▲' : '▼'}
                      </span>
                    )}
                    {category && (
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: category.color + '20',
                          color: category.color,
                        }}
                      >
                        {category.name}
                      </span>
                    )}
                  </div>
                  {expandedReminder === reminder.id && reminder.recurringPattern && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
                      <div style={{ fontWeight: 500, marginBottom: '4px' }}>Next occurrences:</div>
                      {getNextOccurrences(reminder.recurringPattern, 5).map((ts, i) => (
                        <div key={i} style={{ marginLeft: '8px' }}>
                          • {formatDate(new Date(ts))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <button
                    onClick={() => openUrl(reminder.url)}
                    title="Open page"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4a90d9',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '14px',
                    }}
                  >
                    🔗
                  </button>
                  <button
                    onClick={() => onDelete(reminder.id)}
                    title="Delete reminder"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#e53935',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '14px',
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TriggeredTabProps {
  triggeredReminders: TriggeredReminder[];
  onNavigate: (triggered: TriggeredReminder) => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

function TriggeredTab({ triggeredReminders, onNavigate, onDismiss, onClearAll }: TriggeredTabProps) {
  function formatTriggeredAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  }

  if (triggeredReminders.length === 0) {
    return (
      <div style={{ color: '#666', textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔔</div>
        <div>No triggered reminders.</div>
        <div style={{ fontSize: '12px', marginTop: '8px' }}>
          Reminders will appear here when they fire.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#666' }}>
          {triggeredReminders.length} reminder{triggeredReminders.length !== 1 ? 's' : ''} triggered
        </div>
        <button
          onClick={onClearAll}
          style={{
            background: 'none',
            border: 'none',
            color: '#e53935',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Clear all
        </button>
      </div>

      <div style={{ maxHeight: '300px', overflow: 'auto' }}>
        {triggeredReminders.map((triggered) => (
          <div
            key={triggered.id}
            className="hover-item"
            style={{
              padding: '10px',
              borderBottom: '2px solid #ddd',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
            }}
            onClick={() => onNavigate(triggered)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                {triggered.title || 'Reminder'}
              </div>
              <div style={{ fontSize: '11px', color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {triggered.url}
              </div>
              <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                📅 {formatDate(new Date(triggered.triggeredAt))}
              </div>
              <div style={{ fontSize: '10px', color: '#e53935', marginTop: '2px' }}>
                ⏱️ Triggered {formatTriggeredAgo(triggered.triggeredAt)}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(triggered.id);
              }}
              className="icon-btn"
              style={{
                background: 'none',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: '16px',
              }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
