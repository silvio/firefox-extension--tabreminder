import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import DateTimePicker from 'react-datetime-picker';
import 'react-datetime-picker/dist/DateTimePicker.css';
import 'react-calendar/dist/Calendar.css';
import 'react-clock/dist/Clock.css';
import { storageService } from '../shared/services/storage';
import { alarmService } from '../shared/services/alarms';
import { PageNote, TimeReminder, Category, UrlMatchType, TriggeredReminder, RecurringPattern, FrequencyType, EndCondition, ScheduleType } from '../shared/types';
import { createNote, createReminder, getUrlMatchPreview } from '../shared/utils/helpers';
import { parseTimeInput, formatDate, formatRelativeTime, getNextOccurrences, describeRecurringPattern } from '../shared/utils/timeParser';
import { usePopupState } from '../shared/hooks/usePopupState';
import { buildReminderFields } from '../shared/core/reminderFields';

type Tab = 'current' | 'notes' | 'reminders' | 'triggered' | 'edit';

// Helper function to get light background color from category color
function getLightColor(color: string, opacity: number = 0.15): string {
  // Convert hex to RGB and apply opacity for light background
  return color + Math.round(opacity * 255).toString(16).padStart(2, '0');
}

// Helper function to format URL based on match type
function getDisplayUrl(note: PageNote): string {
  try {
    if (note.urlMatchType === 'regex') {
      return `regex: ${note.url}`;
    }
    const url = new URL(note.url);
    switch (note.urlMatchType) {
      case 'domain':
        return url.hostname;
      case 'path':
        return url.hostname + url.pathname;
      case 'exact':
      default:
        return note.url;
    }
  } catch {
    return note.url;
  }
}

// Helper function to format note tooltip
function getNoteTooltip(note: PageNote): string {
  return `${note.title || 'Untitled'}\n\n${note.content}`;
}

function noteToReminder(note: PageNote): TimeReminder | null {
  if (!note.hasReminder || note.nextTrigger === undefined) {
    return null;
  }

  return {
    id: note.id,
    url: note.url,
    title: note.title,
    scheduleType: note.scheduleType || 'once',
    scheduledTime: note.scheduledTime ?? null,
    recurringPattern: note.recurringPattern ?? null,
    nextTrigger: note.nextTrigger,
    categoryId: note.categoryId,
    createdAt: note.createdAt,
  };
}

function getPageRemindersFromNotes(notes: PageNote[]): TimeReminder[] {
  return notes
    .map(noteToReminder)
    .filter((reminder): reminder is TimeReminder => reminder !== null)
    .sort((a, b) => a.nextTrigger - b.nextTrigger);
}

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
  const [settings, setSettings] = useState<any>(null);
  const [lastUsedCategoryId, setLastUsedCategoryId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<PageNote | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    updatePopupState({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    updatePopupState({ filterCategory });
  }, [filterCategory]);

  useEffect(() => {
    if (activeTab === 'edit' && getEditViewMode() !== 'tab') {
      setActiveTab('notes');
    }
  }, [activeTab, settings]);

  useEffect(() => {
    if (activeTab === 'edit' && !editingNote) {
      setActiveTab('notes');
    }
  }, [activeTab, editingNote]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [tabs, notesData, remindersData, categoriesData, triggeredData, settingsData, lastUsedCategory] = await Promise.all([
        browser.tabs.query({ active: true, currentWindow: true }),
        storageService.getNotes(),
        storageService.getReminders(),
        storageService.getCategories(),
        storageService.getTriggeredReminders(),
        storageService.getSettings(),
        storageService.getLastUsedCategoryId(),
      ]);

      const url = tabs[0]?.url || '';
      const title = tabs[0]?.title || '';
      setCurrentUrl(url);
      setCurrentPageTitle(title);
      setNotes(notesData);
      setReminders(remindersData);
      setCategories(categoriesData);
      setTriggeredReminders(triggeredData);
      setSettings(settingsData);
      setLastUsedCategoryId(lastUsedCategory);

      if (url) {
        const matching = await storageService.getNotesForUrl(url);
        setMatchingNotes(matching);
        setPageReminders(getPageRemindersFromNotes(matching));
      }
      
      // Check for pending edit from overlay
      const { pendingEditNoteId } = await browser.storage.local.get('pendingEditNoteId');
      if (pendingEditNoteId) {
        // Find the note
        const noteToEdit = notesData.find((n) => n.id === pendingEditNoteId);
        if (noteToEdit) {
          openEditor(noteToEdit, settingsData.editViewMode === 'modal' ? 'modal' : 'tab');
        }
        // Clear the pending edit
        await browser.storage.local.remove('pendingEditNoteId');
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function refreshReminderViews(): Promise<void> {
    const [updatedNotes, updatedReminders, updatedTriggered] = await Promise.all([
      storageService.getNotes(),
      storageService.getReminders(),
      storageService.getTriggeredReminders(),
    ]);
    setNotes(updatedNotes);
    setReminders(updatedReminders);
    setTriggeredReminders(updatedTriggered);

    if (currentUrl) {
      const updatedMatching = await storageService.getNotesForUrl(currentUrl);
      setMatchingNotes(updatedMatching);
      setPageReminders(getPageRemindersFromNotes(updatedMatching));
    } else {
      setMatchingNotes([]);
      setPageReminders([]);
    }
  }

  async function dismissTriggeredEntries(entries: TriggeredReminder[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const notesData = await storageService.getNotes();
    const notesById = new Map(notesData.map((note) => [note.id, note]));
    const noteIdsToClear = new Set<string>();

    for (const entry of entries) {
      const note = notesById.get(entry.reminderId);
      if (note?.hasReminder && note.scheduleType !== 'recurring') {
        noteIdsToClear.add(note.id);
      }
    }

    for (const noteId of noteIdsToClear) {
      const note = notesById.get(noteId);
      if (!note) continue;

      const updatedNote: PageNote = {
        ...note,
        hasReminder: false,
        scheduleType: undefined,
        scheduledTime: undefined,
        recurringPattern: undefined,
        nextTrigger: undefined,
        updatedAt: Date.now(),
      };
      await storageService.saveNote(updatedNote);
    }

    if (entries.length === 1) {
      await storageService.dismissTriggeredReminder(entries[0].id);
    } else {
      await storageService.clearAllTriggeredReminders();
    }

    await refreshReminderViews();
    await alarmService.updateTriggeredBadge();
  }

  function getEditViewMode(fallback?: { editViewMode?: string }): 'tab' | 'modal' {
    const mode = fallback?.editViewMode || settings?.editViewMode;
    return mode === 'modal' ? 'modal' : 'tab';
  }

  function openEditor(note: PageNote, modeOverride?: 'tab' | 'modal'): void {
    setEditingNote(note);
    updatePopupState({
      noteTitle: note.title,
      noteContent: note.content,
      noteUrlMatchType: note.urlMatchType,
      noteCategoryId: note.categoryId || '',
      noteMatchUrl: note.url,
    });

    const mode = modeOverride || getEditViewMode();
    if (mode === 'modal') {
      setShowEditModal(true);
    } else {
      setShowEditModal(false);
      setActiveTab('edit');
    }
  }

  function closeEditor(fallbackTab: Tab = 'notes'): void {
    setEditingNote(null);
    setShowEditModal(false);
    if (activeTab === 'edit') {
      setActiveTab(fallbackTab);
    }
  }

  async function persistNoteAndRefresh(note: PageNote): Promise<void> {
    const oldCategoryId = editingNote?.categoryId ?? null;
    const categoryChanged = oldCategoryId !== note.categoryId;
    await storageService.saveNote(note);
    // Trigger immediate sync (no debounce) so sync happens even if popup closes immediately.
    if (note.categoryId) {
      await storageService.triggerWebDAVSyncImmediate(note.categoryId);
      setLastUsedCategoryId(note.categoryId);
    }
    // Bug 2: sync old category when note was moved away from it
    if (categoryChanged && oldCategoryId) {
      await storageService.triggerWebDAVSyncImmediate(oldCategoryId);
    }
    const [updatedNotes, updatedMatchingNotes, updatedReminders] = await Promise.all([
      storageService.getNotes(),
      storageService.getNotesForUrl(currentUrl),
      storageService.getReminders(),
    ]);
    setNotes(updatedNotes);
    setMatchingNotes(updatedMatchingNotes);
    setPageReminders(getPageRemindersFromNotes(updatedMatchingNotes));
    setReminders(updatedReminders);
    browser.runtime.sendMessage({ type: 'NOTE_UPDATED' });
    // Bug 1: keep the notes-list filter coherent after a category move
    if (categoryChanged && filterCategory !== 'all' && filterCategory === oldCategoryId) {
      setFilterCategory(note.categoryId ?? 'all');
    }
    resetNoteForm();
  }

  async function deleteNoteAndRefresh(id: string): Promise<void> {
    await storageService.deleteNote(id);
    const [updatedNotes, updatedMatchingNotes, updatedReminders] = await Promise.all([
      storageService.getNotes(),
      storageService.getNotesForUrl(currentUrl),
      storageService.getReminders(),
    ]);
    setNotes(updatedNotes);
    setMatchingNotes(updatedMatchingNotes);
    setPageReminders(getPageRemindersFromNotes(updatedMatchingNotes));
    setReminders(updatedReminders);
    browser.runtime.sendMessage({ type: 'NOTE_DELETED' });
    resetNoteForm();
  }

  async function deleteReminderAndRefresh(id: string): Promise<void> {
    await storageService.deleteReminder(id);
    const [updatedReminders, updatedMatchingNotes] = await Promise.all([
      storageService.getReminders(),
      storageService.getNotesForUrl(currentUrl),
    ]);
    setReminders(updatedReminders);
    setMatchingNotes(updatedMatchingNotes);
    setPageReminders(getPageRemindersFromNotes(updatedMatchingNotes));
    browser.runtime.sendMessage({ type: 'REMINDER_DELETED' });
  }

  if (loading) {
    return <div style={{ padding: '16px' }}>Loading...</div>;
  }

  const configuredPopupHeight = Number(settings?.popupHeight);
  const popupHeight = Math.max(
    600,
    Number.isFinite(configuredPopupHeight) ? configuredPopupHeight : 600
  );
  const editViewMode = getEditViewMode();
  const isEditTabEnabled = Boolean(editingNote);
  const visibleTabs: Tab[] = editViewMode === 'tab'
    ? ['current', 'notes', 'reminders', 'edit', 'triggered']
    : ['current', 'notes', 'reminders', 'triggered'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: `${popupHeight}px`, position: 'relative' }}>
      <header style={{ padding: '12px 16px', borderBottom: '2px solid #ddd', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
          TabReminder
        </h1>
      </header>

      <nav style={{ display: 'flex', borderBottom: '2px solid #ddd', flexShrink: 0 }}>
        {visibleTabs.map((tab) => {
          const tabLabels: Record<Tab, string> = {
            current: '📄 This Page',
            notes: '📝 Notes',
            reminders: '⏰ Reminders',
            triggered: '🔔',
            edit: '✏️ Edit',
          };
          const isEditTab = tab === 'edit';
          const isDisabled = isEditTab && !isEditTabEnabled;

          return (
            <button
              key={tab}
              onClick={() => {
                if (isDisabled) return;
                setActiveTab(tab);
              }}
              disabled={isDisabled}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                background: activeTab === tab ? '#f0f0f0' : 'transparent',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                fontWeight: activeTab === tab ? 600 : 400,
                borderBottom:
                  activeTab === tab ? '2px solid #4a90d9' : '2px solid transparent',
                position: 'relative',
                fontSize: '12px',
                opacity: isDisabled ? 0.55 : 1,
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

      <main style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'current' && settings && (
          <CurrentPageTab
            url={currentUrl}
            pageTitle={currentPageTitle}
            matchingNotes={matchingNotes}
            pageReminders={pageReminders}
            categories={categories}
            preselectLastCategory={settings.preselectLastCategory}
            lastUsedCategoryId={lastUsedCategoryId}
            recurringPreviewCount={settings.recurringPreviewCount ?? 5}
            editingNote={null}
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
              await persistNoteAndRefresh(note);
            }}
            onDelete={async (id) => {
              await deleteNoteAndRefresh(id);
            }}
            onEditNote={(note) => {
              openEditor(note);
            }}
            onCancelEdit={() => closeEditor('current')}
            onDeleteReminder={async (id) => {
              await deleteReminderAndRefresh(id);
            }}
          />
        )}

        {activeTab === 'notes' && (
          <NotesListTab
            notes={notes}
            categories={categories}
            filterCategory={filterCategory}
            currentUrl={currentUrl}
            onFilterChange={setFilterCategory}
            onDelete={async (id) => {
              await storageService.deleteNote(id);
              setNotes(await storageService.getNotes());
              browser.runtime.sendMessage({ type: 'NOTE_DELETED' });
            }}
            onEdit={(note) => {
              openEditor(note);
            }}
          />
        )}

        {activeTab === 'reminders' && (
          <RemindersTab
            notes={notes}
            categories={categories}
            currentUrl={currentUrl}
            onEdit={(note) => {
              openEditor(note);
            }}
            onDelete={async (id) => {
              await storageService.deleteNote(id);
              setNotes(await storageService.getNotes());
              setMatchingNotes(await storageService.getNotesForUrl(currentUrl));
              browser.runtime.sendMessage({ type: 'NOTE_DELETED' });
            }}
          />
        )}

        {activeTab === 'edit' && settings && editViewMode === 'tab' && (
          <CurrentPageTab
            url={currentUrl}
            pageTitle={currentPageTitle}
            matchingNotes={matchingNotes}
            pageReminders={pageReminders}
            categories={categories}
            preselectLastCategory={settings.preselectLastCategory}
            lastUsedCategoryId={lastUsedCategoryId}
            recurringPreviewCount={settings.recurringPreviewCount ?? 5}
            editingNote={editingNote}
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
              await persistNoteAndRefresh(note);
            }}
            onDelete={async (id) => {
              await deleteNoteAndRefresh(id);
              closeEditor('notes');
            }}
            onEditNote={(note) => openEditor(note)}
            onCancelEdit={() => closeEditor('notes')}
            onDeleteReminder={async (id) => {
              await deleteReminderAndRefresh(id);
            }}
            editorOnly
            requireEditingNote
          />
        )}

        {activeTab === 'triggered' && (
          <TriggeredTab
            triggeredReminders={triggeredReminders}
            categories={categories}
            reminders={reminders}
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
              await dismissTriggeredEntries([triggered]);
            }}
            onDismiss={async (triggered) => {
              await dismissTriggeredEntries([triggered]);
            }}
            onClearAll={async () => {
              await dismissTriggeredEntries(triggeredReminders);
            }}
          />
        )}
      </main>

      {showEditModal && settings && (
        <div
          onClick={() => closeEditor(activeTab)}
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.35)',
            zIndex: 20,
            padding: '10px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#fff',
              borderRadius: '8px',
              height: '100%',
              overflow: 'auto',
              padding: '12px',
            }}
          >
            <CurrentPageTab
              url={currentUrl}
              pageTitle={currentPageTitle}
              matchingNotes={matchingNotes}
              pageReminders={pageReminders}
              categories={categories}
              preselectLastCategory={settings.preselectLastCategory}
              lastUsedCategoryId={lastUsedCategoryId}
              recurringPreviewCount={settings.recurringPreviewCount ?? 5}
              editingNote={editingNote}
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
                await persistNoteAndRefresh(note);
              }}
              onDelete={async (id) => {
                await deleteNoteAndRefresh(id);
                closeEditor(activeTab);
              }}
              onEditNote={(note) => openEditor(note, 'modal')}
              onCancelEdit={() => closeEditor(activeTab)}
              onDeleteReminder={async (id) => {
                await deleteReminderAndRefresh(id);
              }}
              editorOnly
              requireEditingNote
            />
          </div>
        </div>
      )}

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
  preselectLastCategory: boolean;
  lastUsedCategoryId: string | null;
  savedState: NoteFormState;
  editingNote: PageNote | null;
  onStateChange: (state: NoteFormState) => void;
  onSave: (note: PageNote) => void;
  onDelete: (id: string) => void;
  onEditNote: (note: PageNote) => void;
  onCancelEdit: () => void;
  onDeleteReminder: (id: string) => void;
  editorOnly?: boolean;
  requireEditingNote?: boolean;
  recurringPreviewCount?: number;
}

function CurrentPageTab({
  url,
  pageTitle,
  matchingNotes,
  pageReminders,
  categories,
  preselectLastCategory,
  lastUsedCategoryId,
  savedState,
  editingNote,
  onStateChange,
  onSave,
  onDelete,
  onEditNote,
  onCancelEdit,
  onDeleteReminder,
  editorOnly = false,
  requireEditingNote = false,
  recurringPreviewCount = 5,
}: CurrentPageTabProps) {
  function resolveInitialCategory(): string {
    if (savedState.categoryId) {
      return savedState.categoryId;
    }
    if (
      preselectLastCategory &&
      lastUsedCategoryId &&
      categories.some((category) => category.id === lastUsedCategoryId)
    ) {
      return lastUsedCategoryId;
    }
    return '';
  }

  const [title, setTitle] = useState(savedState.title || pageTitle);
  const [content, setContent] = useState(savedState.content);
  const [urlMatchType, setUrlMatchType] = useState<UrlMatchType>(
    savedState.urlMatchType || 'exact'
  );
  const [categoryId, setCategoryId] = useState<string>(resolveInitialCategory());
  const [matchUrl, setMatchUrl] = useState<string>(savedState.matchUrl || url);
  
  // Reminder state
  const [hasReminder, setHasReminder] = useState(false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once');
  const [scheduledTime, setScheduledTime] = useState<number | null>(null);
  const [recurringPattern, setRecurringPattern] = useState<RecurringPattern | null>(null);
  
  // Recurring reminder state
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
    if (editingNote) {
      setTitle(editingNote.title);
      setContent(editingNote.content);
      setUrlMatchType(editingNote.urlMatchType);
      setCategoryId(editingNote.categoryId || '');
      setMatchUrl(editingNote.url);
      // Load reminder fields if present
      setHasReminder(editingNote.hasReminder || false);
      setScheduleType(editingNote.scheduleType || 'once');
      setScheduledTime(editingNote.scheduledTime || null);
      setRecurringPattern(editingNote.recurringPattern || null);
      
      // Load recurring pattern if present
      if (editingNote.recurringPattern) {
        const p = editingNote.recurringPattern;
        setRecFrequency(p.frequency);
        setRecInterval(p.interval);
        setRecWeekdays(p.weekdays || [1]);
        setRecDayOfMonth(p.dayOfMonth || 1);
        setRecMonthlyMode(p.dayOfMonth ? 'day' : 'weekday');
        setRecOrdinal(p.weekdayOrdinal?.ordinal || 1);
        setRecOrdinalWeekday(p.weekdayOrdinal?.weekday || 1);
        setRecEndType(p.endCondition.type);
        setRecEndDate(p.endCondition.type === 'date' ? new Date(p.endCondition.endDate!).toISOString().slice(0, 10) : '');
        setRecEndCount(p.endCondition.type === 'count' ? p.endCondition.occurrences! : 10);
        setRecTimeHour(p.timeOfDay?.hour ?? defaultHour);
        setRecTimeMinute(p.timeOfDay?.minute ?? defaultMinute);
      }
    } else {
      if (!savedState.title && pageTitle) {
        setTitle(pageTitle);
      }
      setCategoryId(resolveInitialCategory());
      setMatchUrl(url);
      // Reset reminder fields
      setHasReminder(false);
      setScheduleType('once');
      setScheduledTime(null);
      setRecurringPattern(null);
      // Reset recurring state
      setRecFrequency('daily');
      setRecInterval(1);
      setRecWeekdays([1]);
      setRecDayOfMonth(1);
      setRecMonthlyMode('day');
      setRecOrdinal(1);
      setRecOrdinalWeekday(1);
      setRecEndType('never');
      setRecEndDate('');
      setRecEndCount(10);
      setRecTimeHour(defaultHour);
      setRecTimeMinute(defaultMinute);
    }
  }, [editingNote, url, pageTitle, preselectLastCategory, lastUsedCategoryId, categories]);

  useEffect(() => {
    onStateChange({ title, content, urlMatchType, categoryId, matchUrl });
  }, [title, content, urlMatchType, categoryId, matchUrl]);

  if (requireEditingNote && !editingNote) {
    return (
      <div style={{ color: '#666', textAlign: 'center', paddingTop: '24px' }}>
        Select a note first to start editing.
      </div>
    );
  }

  if (!editingNote && (!url || url.startsWith('about:') || url.startsWith('moz-extension:'))) {
    return (
      <div style={{ color: '#666', textAlign: 'center' }}>
        Cannot add notes to this page.
      </div>
    );
  }

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

  function handleSave() {
    const baseNote = editingNote
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
    
    const finalRecurringPattern = hasReminder && scheduleType === 'recurring'
      ? buildRecurringPattern()
      : null;
    const reminderFields = buildReminderFields({
      editingNote,
      hasReminder,
      scheduleType,
      scheduledTime,
      recurringPattern: finalRecurringPattern,
    });

    const updatedNote: PageNote = {
      ...baseNote,
      ...reminderFields,
    };
    
    onSave(updatedNote);
    onCancelEdit();
    setTitle(pageTitle);
    setContent('');
    setHasReminder(false);
    setScheduleType('once');
    setScheduledTime(null);
    setRecurringPattern(null);
  }

  function resetUrlTo(type: UrlMatchType) {
    setUrlMatchType(type);
    if (type === 'regex') {
      // For regex, clear the URL so user can enter pattern
      setMatchUrl('');
    } else {
      // For other types, use current page URL
      setMatchUrl(url);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: editorOnly ? 0 : '16px' }}>
        {/* Existing notes for this page */}
        {!editorOnly && matchingNotes.length > 0 && (
          <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #ddd' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
              📝 Notes for this page ({matchingNotes.length})
            </div>
          {matchingNotes.map((note) => {
            const category = categories.find((c) => c.id === note.categoryId);
            return (
              <div
                key={note.id}
                className="hover-item"
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  backgroundColor: category ? getLightColor(category.color, 0.15) : '#f5f5f5',
                  borderLeft: category ? `4px solid ${category.color}` : 'none',
                  paddingLeft: category ? '8px' : '12px',
                }}
              >
                <div style={{ fontSize: '14px', marginTop: '2px' }}>{note.hasReminder ? '🔔' : '📝'}</div>
                <div style={{ flex: 1, minWidth: 0 }} title={getNoteTooltip(note)}>
                  <div
                    title={note.title || 'Untitled'}
                    onClick={() => {
                      // Navigate to note URL
                      browser.tabs.query({ url: note.url }).then((tabs) => {
                        if (tabs.length > 0 && tabs[0].id) {
                          browser.tabs.update(tabs[0].id, { active: true }).then(() => {
                            if (tabs[0].windowId) {
                              browser.windows.update(tabs[0].windowId, { focused: true });
                            }
                          });
                        } else {
                          browser.tabs.create({ url: note.url });
                        }
                      });
                    }}
                    style={{
                      fontWeight: 600,
                      marginBottom: '4px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {note.title || 'Untitled'}
                  </div>
                  <div
                    title={getDisplayUrl(note)}
                    style={{
                      fontSize: '11px',
                      color: '#999',
                      marginBottom: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {getDisplayUrl(note)}
                  </div>
                  {note.content && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#666',
                        marginBottom: '4px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {note.content.substring(0, 80)}{note.content.length > 80 ? '...' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                      {category && (
                        <span
                          style={{
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
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#f5f5f5',
                          color: '#666',
                          textTransform: 'uppercase',
                        }}
                      >
                        {note.urlMatchType}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => onEditNote(note)}
                        className="icon-btn"
                        title="Edit"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '14px', color: '#4a90d9' }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => onDelete(note.id)}
                        className="icon-btn"
                        title="Delete"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '14px', color: '#e53935' }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reminders for this page */}
      {!editorOnly && pageReminders.length > 0 && (
        <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '2px solid #ddd' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
            ⏰ Reminders for this page ({pageReminders.length})
          </div>
          {pageReminders.map((reminder) => {
            const category = categories.find((c) => c.id === reminder.categoryId);
            const isOverdue = reminder.nextTrigger <= Date.now();
            const timeInfo = formatReminderTime(reminder.nextTrigger);
            return (
              <div
                key={reminder.id}
                className="hover-item"
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  backgroundColor: category ? getLightColor(category.color, 0.15) : '#f5f5f5',
                  borderLeft: category ? `4px solid ${category.color}` : 'none',
                  paddingLeft: category ? '8px' : '12px',
                }}
              >
                <div style={{ fontSize: '14px', marginTop: '2px' }}>⌚</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    title={reminder.title}
                    onClick={() => {
                      // Navigate to reminder URL
                      browser.tabs.query({ url: reminder.url }).then((tabs) => {
                        if (tabs.length > 0 && tabs[0].id) {
                          browser.tabs.update(tabs[0].id, { active: true }).then(() => {
                            if (tabs[0].windowId) {
                              browser.windows.update(tabs[0].windowId, { focused: true });
                            }
                          });
                        } else {
                          browser.tabs.create({ url: reminder.url });
                        }
                      });
                    }}
                    style={{
                      fontWeight: 600,
                      marginBottom: '4px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reminder.title}
                  </div>
                  <div
                    title={reminder.url}
                    style={{
                      fontSize: '11px',
                      color: '#999',
                      marginBottom: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {reminder.url}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                      {isOverdue && (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            backgroundColor: '#ffebee',
                            color: '#e53935',
                          }}
                        >
                          Overdue
                        </span>
                      )}
                      {reminder.scheduleType === 'recurring' && (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            backgroundColor: '#e3f2fd',
                            color: '#1976d2',
                          }}
                        >
                          Recurring
                        </span>
                      )}
                      {category && (
                        <span
                          style={{
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
                      <span
                        title={timeInfo.iso}
                        style={{ fontSize: '11px', color: isOverdue ? '#e53935' : '#666' }}
                      >
                        {timeInfo.relative}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => onDeleteReminder(reminder.id)}
                        className="icon-btn"
                        title="Delete"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '14px', color: '#e53935' }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>

      <div style={{ borderTop: editorOnly ? 'none' : '2px solid #ddd', paddingTop: editorOnly ? 0 : '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px' }}>
          {editingNote ? '✏️ Edit Note' : '➕ Add New Note'}
          {editingNote && (
            <button
              onClick={() => { onCancelEdit(); setTitle(pageTitle); setContent(''); }}
              style={{ marginLeft: '8px', fontSize: '11px', color: '#4a90d9', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Cancel edit
            </button>
          )}
        </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
          {urlMatchType === 'regex' ? 'Regex Pattern' : 'Match URL'}
        </label>
        <input
          type="text"
          value={matchUrl}
          onChange={(e) => setMatchUrl(e.target.value)}
          placeholder={urlMatchType === 'regex' ? 'e.g., ^https://.*\\.example\\.com/.*$' : 'URL to match...'}
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
          {(['exact', 'path', 'domain', 'regex'] as UrlMatchType[]).map((type) => (
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
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', color: '#666' }}>
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
          <option value="">No category</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* Reminder toggle */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={hasReminder}
            onChange={(e) => {
              const enabled = e.target.checked;
              setHasReminder(enabled);
              // Set default time 1 hour from now when enabling reminder
              if (enabled && !scheduledTime) {
                const defaultTime = Date.now() + 60 * 60 * 1000; // 1 hour from now
                setScheduledTime(defaultTime);
              }
            }}
          />
          <span style={{ fontSize: '13px', fontWeight: 500 }}>⏰ Add reminder for this note</span>
        </label>
        
        {hasReminder && (
          <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f9f9f9', borderRadius: '4px', border: '1px solid #e0e0e0' }}>
            {/* Schedule type selector */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                <button
                  onClick={() => setScheduleType('once')}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    background: scheduleType === 'once' ? '#4a90d9' : '#fff',
                    color: scheduleType === 'once' ? '#fff' : '#333',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: scheduleType === 'once' ? 600 : 400,
                  }}
                >
                  One-time
                </button>
                <button
                  onClick={() => setScheduleType('recurring')}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    background: scheduleType === 'recurring' ? '#4a90d9' : '#fff',
                    color: scheduleType === 'recurring' ? '#fff' : '#333',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: scheduleType === 'recurring' ? 600 : 400,
                  }}
                >
                  Recurring
                </button>
              </div>
            </div>

            {scheduleType === 'once' ? (
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
                  When to remind
                </label>
                <DateTimePicker
                  value={scheduledTime ? new Date(scheduledTime) : null}
                  onChange={(date: Date | null) => {
                    setScheduledTime(date ? date.getTime() : null);
                  }}
                  disableClock={true}
                  clearIcon={null}
                  calendarIcon={null}
                  format="y-MM-dd HH:mm"
                  className="datetime-picker-custom"
                />
              </div>
            ) : (
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
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
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
                        {['1st', '2nd', '3rd', '4th', 'Last'].map((lbl, idx) => (
                          <option key={idx} value={idx + 1}>{lbl}</option>
                        ))}
                      </select>
                      <select
                        value={recOrdinalWeekday}
                        onChange={(e) => setRecOrdinalWeekday(parseInt(e.target.value))}
                        disabled={recMonthlyMode !== 'weekday'}
                        style={{ padding: '4px', border: '1px solid #ddd', borderRadius: '4px' }}
                      >
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
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
                  {recurringPreviewCount > 0 && (() => {
                    const occurrences = getNextOccurrences(buildRecurringPattern(), recurringPreviewCount);
                    if (occurrences.length === 0) return null;
                    return (
                      <div style={{ marginTop: '6px', borderTop: '1px solid #ddd', paddingTop: '6px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>Next {occurrences.length} occurrence{occurrences.length !== 1 ? 's' : ''}:</div>
                        {occurrences.map((ts, i) => (
                          <div key={i}>{formatDate(new Date(ts))}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={handleSave}
          disabled={!content.trim() && !hasReminder}
          style={{
            flex: 1,
            padding: '10px',
            backgroundColor: '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: content.trim() || hasReminder ? 'pointer' : 'not-allowed',
            opacity: content.trim() || hasReminder ? 1 : 0.5,
          }}
        >
          {editingNote ? 'Update Note' : 'Save Note'}
        </button>
      </div>
      </div>
    </div>
  );
}

interface NotesListTabProps {
  notes: PageNote[];
  categories: Category[];
  filterCategory: string;
  currentUrl: string;
  onFilterChange: (category: string) => void;
  onDelete: (id: string) => void;
  onEdit: (note: PageNote) => void;
}

function NotesListTab({
  notes,
  categories,
  filterCategory,
  currentUrl,
  onFilterChange,
  onDelete,
  onEdit,
}: NotesListTabProps) {
  const filteredNotes =
    filterCategory === 'all'
      ? notes
      : notes.filter((n) => n.categoryId === filterCategory);

  function openNote(url: string) {
    // Find existing tab with URL or open new tab
    browser.tabs.query({ url }).then((tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        browser.tabs.update(tabs[0].id, { active: true }).then(() => {
          if (tabs[0].windowId) {
            browser.windows.update(tabs[0].windowId, { focused: true });
          }
        });
      } else {
        browser.tabs.create({ url });
      }
    });
  }

  function isCurrentPageNote(note: PageNote): boolean {
    if (!currentUrl || currentUrl.startsWith('about:') || currentUrl.startsWith('moz-extension:')) {
      return false;
    }
    try {
      const noteUrl = new URL(note.url);
      const pageUrl = new URL(currentUrl);
      switch (note.urlMatchType) {
        case 'exact':
          return note.url === currentUrl;
        case 'path':
          return noteUrl.hostname === pageUrl.hostname && noteUrl.pathname === pageUrl.pathname;
        case 'domain':
          return noteUrl.hostname === pageUrl.hostname;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: '12px', flexShrink: 0 }}>
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
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        {filterCategory !== 'all' && (() => {
          const selectedCat = categories.find(c => c.id === filterCategory);
          return selectedCat?.lastSyncTime ? (
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', paddingLeft: '4px' }}>
              Last synced: {formatRelativeTime(selectedCat.lastSyncTime)}
            </div>
          ) : null;
        })()}
      </div>

      {filteredNotes.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
          No notes found.
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {filteredNotes.map((note) => {
            const category = categories.find((c) => c.id === note.categoryId);
            const isForCurrentPage = isCurrentPageNote(note);
            return (
              <div
                key={note.id}
                className="hover-item"
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  borderRadius: '4px',
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'flex-start',
                  backgroundColor: category ? getLightColor(category.color, isForCurrentPage ? 0.25 : 0.1) : (isForCurrentPage ? '#f0f0f0' : '#fff'),
                  borderLeft: category ? `4px solid ${category.color}` : 'none',
                  paddingLeft: category ? '8px' : '12px',
                }}
              >
                <div style={{ fontSize: '14px', marginTop: '2px' }}>{note.hasReminder ? '🔔' : '📝'}</div>
                <div style={{ flex: 1, minWidth: 0 }} title={getNoteTooltip(note)}>
                  <div
                    title={note.title || 'Untitled'}
                    onClick={() => openNote(note.url)}
                    style={{
                      fontWeight: 600,
                      marginBottom: '4px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {note.title || 'Untitled'}
                  </div>
                  <div
                    title={getDisplayUrl(note)}
                    style={{
                      fontSize: '11px',
                      color: '#999',
                      marginBottom: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {getDisplayUrl(note)}
                  </div>
                  {note.content && (
                    <div
                      style={{
                        fontSize: '11px',
                        color: '#666',
                        marginBottom: '4px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {note.content.substring(0, 80)}{note.content.length > 80 ? '...' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                      {note.hasReminder && note.nextTrigger && note.nextTrigger <= Date.now() && (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            backgroundColor: '#ffebee',
                            color: '#e53935',
                          }}
                        >
                          Overdue
                        </span>
                      )}
                      {note.hasReminder && note.scheduleType === 'recurring' && (
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '10px',
                            backgroundColor: '#e3f2fd',
                            color: '#1976d2',
                          }}
                        >
                          Recurring
                        </span>
                      )}
                      {category && (
                        <span
                          style={{
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
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#f5f5f5',
                          color: '#666',
                          textTransform: 'uppercase',
                        }}
                      >
                        {note.urlMatchType}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => onEdit(note)}
                        title="Edit note"
                        className="icon-btn"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#4a90d9',
                          cursor: 'pointer',
                          padding: '2px',
                          fontSize: '14px',
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => openNote(note.url)}
                        title="Open page"
                        className="icon-btn"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#4a90d9',
                          cursor: 'pointer',
                          padding: '2px',
                          fontSize: '14px',
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
                          padding: '2px',
                          fontSize: '14px',
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
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

// Helper to format relative time with time of day
function formatReminderTime(timestamp: number): { relative: string; iso: string } {
  const now = Date.now();
  const diff = timestamp - now;
  const date = new Date(timestamp);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isoStr = date.toISOString();

  if (diff < 0) {
    return { relative: 'Overdue', iso: isoStr };
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const longDateThresholdDays = 30;

  if (days > longDateThresholdDays) {
    const absolute = date.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return { relative: absolute, iso: isoStr };
  }

  if (days > 0) {
    return { relative: `${days}d at ${timeStr}`, iso: isoStr };
  }
  if (hours > 0) {
    return { relative: `${hours}h at ${timeStr}`, iso: isoStr };
  }
  if (minutes > 0) {
    return { relative: `${minutes}m`, iso: isoStr };
  }
  return { relative: 'Soon', iso: isoStr };
}

interface RemindersTabProps {
  notes: PageNote[];
  categories: Category[];
  currentUrl: string;
  onEdit: (note: PageNote) => void;
  onDelete: (id: string) => void;
}

function RemindersTab({
  notes,
  categories,
  currentUrl,
  onEdit,
  onDelete,
}: RemindersTabProps) {
  // Filter notes that have reminders and sort by next trigger
  const notesWithReminders = notes
    .filter((n) => n.hasReminder && n.nextTrigger)
    .sort((a, b) => (a.nextTrigger || 0) - (b.nextTrigger || 0));

  function openNote(url: string) {
    browser.tabs.query({ url }).then((tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        browser.tabs.update(tabs[0].id, { active: true }).then(() => {
          if (tabs[0].windowId) {
            browser.windows.update(tabs[0].windowId, { focused: true });
          }
        });
      } else {
        browser.tabs.create({ url });
      }
    });
  }

  if (notesWithReminders.length === 0) {
    return (
      <div style={{ color: '#666', textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏰</div>
        <div>No notes with reminders.</div>
        <div style={{ fontSize: '12px', marginTop: '8px' }}>
          Add reminders to notes in the "📄 This Page" tab.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: '#666', marginBottom: '8px', flexShrink: 0 }}>
        Notes with Reminders ({notesWithReminders.length})
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {notesWithReminders.map((note) => {
          const category = categories.find((c) => c.id === note.categoryId);
          const isOverdue = note.nextTrigger ? note.nextTrigger <= Date.now() : false;
          const timeInfo = note.nextTrigger ? formatReminderTime(note.nextTrigger) : null;
          const firstLine = note.content ? note.content.split('\n')[0] : '';
          const truncatedContent = firstLine.length > 60 ? firstLine.substring(0, 60) + '…' : firstLine;

          return (
            <div
              key={note.id}
              className="hover-item"
              title={`${note.title || 'Untitled'}\n\n${note.content}`}
              style={{
                padding: '8px',
                marginBottom: '4px',
                borderRadius: '4px',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
                backgroundColor: category ? getLightColor(category.color, 0.15) : '#f5f5f5',
                borderLeft: category ? `4px solid ${category.color}` : 'none',
                paddingLeft: category ? '8px' : '12px',
              }}
            >
              <div style={{ fontSize: '14px', marginTop: '2px' }}>🔔</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  title={note.title || 'Untitled'}
                  onClick={() => openNote(note.url)}
                  style={{
                    fontWeight: 600,
                    marginBottom: '4px',
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {note.title || 'Untitled'}
                </div>
                <div
                  title={getDisplayUrl(note)}
                  style={{
                    fontSize: '11px',
                    color: '#999',
                    marginBottom: '4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getDisplayUrl(note)}
                </div>
                {truncatedContent && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#666',
                      marginBottom: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {truncatedContent}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    {isOverdue && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#ffebee',
                          color: '#e53935',
                        }}
                      >
                        Overdue
                      </span>
                    )}
                    {note.scheduleType === 'recurring' && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          borderRadius: '10px',
                          backgroundColor: '#e3f2fd',
                          color: '#1976d2',
                        }}
                      >
                        Recurring
                      </span>
                    )}
                    {category && (
                      <span
                        style={{
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
                    {timeInfo && (
                      <span
                        title={timeInfo.iso}
                        style={{ fontSize: '11px', color: isOverdue ? '#e53935' : '#666' }}
                      >
                        {timeInfo.relative}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => onEdit(note)}
                      title="Edit note"
                      className="icon-btn"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#4a90d9',
                        cursor: 'pointer',
                        padding: '2px',
                        fontSize: '14px',
                      }}
                    >
                      ✏️
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
                        padding: '2px',
                        fontSize: '14px',
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


interface TriggeredTabProps {
  triggeredReminders: TriggeredReminder[];
  categories: Category[];
  reminders: TimeReminder[];
  onNavigate: (triggered: TriggeredReminder) => void;
  onDismiss: (triggered: TriggeredReminder) => void;
  onClearAll: () => void;
}

function TriggeredTab({ triggeredReminders, categories, reminders, onNavigate, onDismiss, onClearAll }: TriggeredTabProps) {
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
        {triggeredReminders.map((triggered) => {
          const reminder = reminders.find(r => r.id === triggered.reminderId);
          const category = reminder ? categories.find((c) => c.id === reminder.categoryId) : undefined;
          return (
            <div
              key={triggered.id}
              className="hover-item"
              style={{
                padding: '8px',
                marginBottom: '4px',
                borderRadius: '4px',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
                backgroundColor: '#ffebee',
                borderLeft: category ? `4px solid ${category.color}` : '4px solid #e53935',
                paddingLeft: '8px',
                cursor: 'pointer',
              }}
              onClick={() => onNavigate(triggered)}
            >
              <div style={{ fontSize: '14px', marginTop: '2px' }}>🔔</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: '4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {triggered.title || 'Reminder'}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#999',
                    marginBottom: '4px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {triggered.url}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    {category && (
                      <span
                        style={{
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
                    <span style={{ fontSize: '11px', color: '#666' }}>
                      📅 {formatDate(new Date(triggered.triggeredAt))}
                    </span>
                    <span style={{ fontSize: '11px', color: '#e53935' }}>
                      ⏱️ {formatTriggeredAgo(triggered.triggeredAt)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(triggered);
                    }}
                    className="icon-btn"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#e53935',
                      cursor: 'pointer',
                      padding: '2px',
                      fontSize: '14px',
                    }}
                    title="Dismiss"
                  >
                    ✖
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
