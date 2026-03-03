// Mobile page UI for Android
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { storageService } from '../shared/services/storage';
import { Category, PageNote, ScheduleType, FrequencyType, RecurringPattern, EndCondition, Settings } from '../shared/types';
import { describeRecurringPattern, formatRelativeTime } from '../shared/utils/timeParser';
import { buildReminderFields } from '../shared/core/reminderFields';

type Tab = 'current' | 'all' | 'edit';

function MobileApp() {
  const [currentUrl, setCurrentUrl] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [notes, setNotes] = useState<PageNote[]>([]);
  const [matchingNotes, setMatchingNotes] = useState<PageNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('current');
  const [showForm, setShowForm] = useState(false);
  const [editingNote, setEditingNote] = useState<PageNote | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [showModal, setShowModal] = useState<{ title: string; content: string } | null>(null);
  const [toast, setToast] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [editViewMode, setEditViewMode] = useState<'tab' | 'modal'>('tab');
  const [returnTab, setReturnTab] = useState<Tab>('current');
  const [settings, setSettings] = useState<Settings | null>(null);

  // Note form state
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteCategoryId, setNoteCategoryId] = useState<string | null>(null);
  
  // Reminder state
  const [hasReminder, setHasReminder] = useState(false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once');
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  
  // Recurring reminder state
  const [recFrequency, setRecFrequency] = useState<FrequencyType>('daily');
  const [recInterval, setRecInterval] = useState(1);
  const [recEndType, setRecEndType] = useState<'never' | 'count' | 'date'>('never');
  const [recEndCount, setRecEndCount] = useState(1);
  const [recEndDate, setRecEndDate] = useState('');
  const [recWeekdays, setRecWeekdays] = useState<number[]>([new Date().getDay()]);
  const [recMonthlyMode, setRecMonthlyMode] = useState<'day' | 'weekday'>('day');
  const [recDayOfMonth, setRecDayOfMonth] = useState(new Date().getDate());
  const [recOrdinal, setRecOrdinal] = useState(1);
  const [recOrdinalWeekday, setRecOrdinalWeekday] = useState(new Date().getDay());
  const [recTimeHour, setRecTimeHour] = useState(9);
  const [recTimeMinute, setRecTimeMinute] = useState(0);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(''), 3000);
  }

  function handleCopyUrl(url: string, event: React.MouseEvent) {
    event.stopPropagation();
    navigator.clipboard.writeText(url).then(() => {
      showToast('URL copied to clipboard');
    }).catch((err) => {
      console.error('Failed to copy URL:', err);
      showToast('Failed to copy URL');
    });
  }

  function handleShowFullText(note: PageNote, event: React.MouseEvent) {
    event.stopPropagation();
    setShowModal({ title: note.title, content: note.content });
  }

  function handleOpenPage(url: string) {
    browser.tabs.create({ url });
  }

  useEffect(() => {
    loadData();
  }, []);

  function resolveDefaultCategory(
    sourceCategories: Category[] = categories,
    sourceSettings: Settings | null = settings
  ): string | null {
    if (
      sourceSettings?.preselectLastCategory &&
      sourceSettings.lastUsedCategoryId &&
      sourceCategories.some((category) => category.id === sourceSettings.lastUsedCategoryId)
    ) {
      return sourceSettings.lastUsedCategoryId;
    }
    return sourceCategories.length > 0 ? sourceCategories[0].id : null;
  }

  async function loadData() {
    try {
      // First, try to get URL from query parameters (passed from background script)
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('url');
      const titleParam = params.get('title');
      let resolvedUrl = '';
      
      if (urlParam) {
        // URL passed as parameter (normal case when opened from browser action)
        resolvedUrl = decodeURIComponent(urlParam);
        setCurrentUrl(resolvedUrl);
        setCurrentTitle(decodeURIComponent(titleParam || ''));
      } else {
        // Fallback: query active tab (for direct navigation to mobile page)
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        if (currentTab?.url && !currentTab.url.startsWith('moz-extension://')) {
          resolvedUrl = currentTab.url;
          setCurrentUrl(resolvedUrl);
          setCurrentTitle(currentTab.title || '');
        }
      }

      // Load categories, notes and synced view settings
      const [cats, allNotes, settingsData] = await Promise.all([
        storageService.getCategories(),
        storageService.getNotes(),
        storageService.getSettings(),
      ]);
      
      setCategories(cats);
      setNotes(allNotes);
      setSettings(settingsData);
      const configuredMode = settingsData.editViewMode === 'modal' ? 'modal' : 'tab';
      setEditViewMode(configuredMode);
      if (configuredMode !== 'tab' && activeTab === 'edit') {
        setActiveTab('current');
      }
      
      // Load matching notes for current page
      if (resolvedUrl) {
        const matching = await storageService.getNotesForUrl(resolvedUrl);
        setMatchingNotes(matching);
      }
      
      // Trigger pending WebDAV uploads on mobile wake/load.
      await storageService.flushPendingWebDAVSync('mobile_load');

      if (!noteCategoryId) {
        setNoteCategoryId(resolveDefaultCategory(cats, settingsData));
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  function resetForm(lastUsedCategoryOverride?: string | null) {
    setNoteTitle('');
    setNoteContent('');
    if (
      lastUsedCategoryOverride &&
      settings?.preselectLastCategory &&
      categories.some((category) => category.id === lastUsedCategoryOverride)
    ) {
      setNoteCategoryId(lastUsedCategoryOverride);
    } else {
      setNoteCategoryId(resolveDefaultCategory());
    }
    setHasReminder(false);
    setScheduleType('once');
    setReminderDate('');
    setReminderTime('');
    setRecFrequency('daily');
    setRecInterval(1);
    setRecEndType('never');
    setRecEndCount(1);
    setRecEndDate('');
    setRecWeekdays([new Date().getDay()]);
    setRecMonthlyMode('day');
    setRecDayOfMonth(new Date().getDate());
    setRecOrdinal(1);
    setRecOrdinalWeekday(new Date().getDay());
    setRecTimeHour(9);
    setRecTimeMinute(0);
    setEditingNote(null);
    setShowForm(false);
  }

  function openEditorSurface() {
    const previousTab = activeTab === 'edit' ? 'current' : activeTab;
    setReturnTab(previousTab);
    if (editViewMode === 'tab') {
      setActiveTab('edit');
    }
    setShowForm(true);
  }

  function handleAddNew() {
    resetForm();
    openEditorSurface();
  }

  function handleEdit(note: PageNote) {
    setEditingNote(note);
    setNoteTitle(note.title);
    setNoteContent(note.content);
    setNoteCategoryId(note.categoryId);
    setHasReminder(note.hasReminder || false);
    setScheduleType(note.scheduleType || 'once');
    
    if (note.scheduledTime) {
      const date = new Date(note.scheduledTime);
      setReminderDate(date.toISOString().split('T')[0]);
      setReminderTime(date.toTimeString().slice(0, 5));
    }
    
    if (note.recurringPattern) {
      setRecFrequency(note.recurringPattern.frequency);
      setRecInterval(note.recurringPattern.interval);
      
      const endCond = note.recurringPattern.endCondition;
      if (endCond.type === 'count') {
        setRecEndType('count');
        setRecEndCount(endCond.occurrences);
      } else if (endCond.type === 'date') {
        setRecEndType('date');
        setRecEndDate(new Date(endCond.endDate).toISOString().split('T')[0]);
      } else {
        setRecEndType('never');
      }
      
      if (note.recurringPattern.weekdays) {
        setRecWeekdays(note.recurringPattern.weekdays);
      }
      
      if (note.recurringPattern.dayOfMonth) {
        setRecMonthlyMode('day');
        setRecDayOfMonth(note.recurringPattern.dayOfMonth);
      }
      
      if (note.recurringPattern.weekdayOrdinal) {
        setRecMonthlyMode('weekday');
        setRecOrdinal(note.recurringPattern.weekdayOrdinal.ordinal);
        setRecOrdinalWeekday(note.recurringPattern.weekdayOrdinal.weekday);
      }
      
      if (note.recurringPattern.timeOfDay) {
        setRecTimeHour(note.recurringPattern.timeOfDay.hour);
        setRecTimeMinute(note.recurringPattern.timeOfDay.minute);
      }
    }
    
    openEditorSurface();
  }

  async function handleDelete(note: PageNote) {
    if (!confirm(`Delete note "${note.title}"?`)) {
      return;
    }

    try {
      await storageService.deleteNote(note.id);
      
      // Trigger WebDAV sync
      if (note.categoryId) {
        await storageService.triggerWebDAVSyncImmediate(note.categoryId);
      }
      
      // Reload data
      await loadData();
    } catch (error) {
      console.error('Error deleting note:', error);
      alert('Error deleting note: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  async function handleSave() {
    if (!noteTitle.trim()) {
      alert('Please enter a title');
      return;
    }

    // Build recurring pattern if needed
    let recurringPattern: RecurringPattern | null = null;
    let scheduledTime: number | undefined = undefined;

    if (hasReminder && reminderDate && reminderTime) {
      scheduledTime = new Date(`${reminderDate}T${reminderTime}`).getTime();

      if (scheduleType === 'recurring') {
        // Build end condition
        let endCondition: EndCondition;
        if (recEndType === 'count') {
          endCondition = { type: 'count' as const, occurrences: recEndCount };
        } else if (recEndType === 'date' && recEndDate) {
          endCondition = { type: 'date' as const, endDate: new Date(recEndDate).getTime() };
        } else {
          endCondition = { type: 'never' as const };
        }

        recurringPattern = {
          frequency: recFrequency,
          interval: recInterval,
          endCondition
        };

        // Add weekdays for weekly
        if (recFrequency === 'weekly' && recWeekdays.length > 0) {
          recurringPattern.weekdays = recWeekdays;
        }

        // Add monthly options
        if (recFrequency === 'monthly') {
          if (recMonthlyMode === 'day') {
            recurringPattern.dayOfMonth = recDayOfMonth;
          } else {
            recurringPattern.weekdayOrdinal = { ordinal: recOrdinal, weekday: recOrdinalWeekday };
          }
        }

        // Add time of day for daily/weekly/monthly/yearly
        if (['daily', 'weekly', 'monthly', 'yearly'].includes(recFrequency)) {
          recurringPattern.timeOfDay = { hour: recTimeHour, minute: recTimeMinute };
        }
      }
    }

    const reminderFields = buildReminderFields({
      editingNote,
      hasReminder,
      scheduleType,
      scheduledTime,
      recurringPattern,
      preserveRecurringWithoutPattern: true,
    });

    const note: PageNote = {
      id: editingNote?.id || Date.now().toString(),
      url: editingNote?.url || currentUrl,
      urlMatchType: editingNote?.urlMatchType || 'exact',
      title: noteTitle.trim(),
      content: noteContent.trim(),
      categoryId: noteCategoryId,
      createdAt: editingNote?.createdAt || Date.now(),
      updatedAt: Date.now(),
      ...reminderFields,
    };

    try {
      await storageService.saveNote(note);
      
      // Immediate WebDAV sync
      if (note.categoryId) {
        await storageService.triggerWebDAVSyncImmediate(note.categoryId);
      }
      
      // Reload data and reset form
      await loadData();
      resetForm(note.categoryId);
      await closeMobileEditorTab();
    } catch (error) {
      console.error('Error saving note:', error);
      alert('Error saving note: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  async function closeMobileEditorTab() {
    try {
      const params = new URLSearchParams(window.location.search);
      const sourceTabIdParam = params.get('sourceTabId');
      const sourceTabId = sourceTabIdParam ? Number(sourceTabIdParam) : NaN;

      if (!Number.isNaN(sourceTabId)) {
        try {
          await browser.tabs.update(sourceTabId, { active: true });
        } catch {
          // Source tab may no longer exist
        }
      }

      const currentTab = await browser.tabs.getCurrent();
      if (currentTab?.id) {
        await browser.tabs.remove(currentTab.id);
      }
    } catch (error) {
      console.warn('Could not auto-close mobile editor tab:', error);
    }
  }

  function handleCancel() {
    resetForm();
    if (editViewMode === 'tab') {
      setActiveTab(returnTab);
    }
  }

  async function handleForceSync() {
    setSyncing(true);
    try {
      const result = await storageService.forceSyncAllCategories();
      if (result.success) {
        await loadData();
        showToast(result.message || 'Sync completed!');
      } else {
        showToast(result.message || 'Sync failed');
      }
    } catch (error) {
      console.error('Sync error:', error);
      showToast('Sync failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setSyncing(false);
    }
  }

  function getCategoryById(categoryId: string | null): Category | undefined {
    return categories.find(c => c.id === categoryId);
  }

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

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        fontSize: '18px',
        color: '#666'
      }}>
        Loading...
      </div>
    );
  }

  const filteredNotes = activeTab === 'all'
    ? notes
        .filter(n => !n.deleted)
        .filter(n => !filterCategory || n.categoryId === filterCategory)
        .sort((a, b) => a.title.localeCompare(b.title))
    : matchingNotes.filter(n => !n.deleted);

  return (
    <div style={{
      maxWidth: '600px',
      margin: '0 auto',
      background: '#fff',
      minHeight: '100vh'
    }}>
      {/* Header with tabs */}
      <div style={{ 
        borderBottom: '2px solid #e0e0e0',
        background: '#fff',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab('current')}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '16px',
              fontWeight: 500,
              background: activeTab === 'current' ? '#f0f0f0' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'current' ? '3px solid #4a90d9' : '3px solid transparent',
              cursor: 'pointer',
              touchAction: 'manipulation'
            }}
          >
            📄 This Page
          </button>
          <button
            onClick={() => setActiveTab('all')}
            style={{
              flex: 1,
              padding: '16px',
              fontSize: '16px',
              fontWeight: 500,
              background: activeTab === 'all' ? '#f0f0f0' : 'transparent',
              border: 'none',
              borderBottom: activeTab === 'all' ? '3px solid #4a90d9' : '3px solid transparent',
              cursor: 'pointer',
              touchAction: 'manipulation'
            }}
          >
            📝 All Notes
          </button>
          {editViewMode === 'tab' && (
            <button
              onClick={() => setActiveTab('edit')}
              style={{
                flex: 1,
                padding: '16px',
                fontSize: '16px',
                fontWeight: 500,
                background: activeTab === 'edit' ? '#f0f0f0' : 'transparent',
                border: 'none',
                borderBottom: activeTab === 'edit' ? '3px solid #4a90d9' : '3px solid transparent',
                cursor: 'pointer',
                touchAction: 'manipulation'
              }}
            >
              ✏️ Edit
            </button>
          )}
          <button
            onClick={() => browser.tabs.create({ url: browser.runtime.getURL('options/index.html') })}
            style={{
              padding: '16px',
              fontSize: '20px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              touchAction: 'manipulation',
              minWidth: '56px'
            }}
            title="Settings"
          >
            ⚙️
          </button>
          <button
            onClick={handleForceSync}
            disabled={syncing}
            style={{
              padding: '16px',
              fontSize: '20px',
              background: syncing ? '#f0f0f0' : 'transparent',
              border: 'none',
              cursor: syncing ? 'not-allowed' : 'pointer',
              touchAction: 'manipulation',
              minWidth: '56px',
              opacity: syncing ? 0.6 : 1
            }}
            title={syncing ? 'Syncing...' : 'Sync Now'}
          >
            {syncing ? '⏳' : '🔄'}
          </button>
        </div>
      </div>

      <div style={{ padding: '20px' }}>
        {activeTab === 'current' && (
          <>
            {/* Page info */}
            <div style={{
              padding: '12px',
              background: '#f0f0f0',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '14px'
            }}>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                {currentTitle || 'Current Page'}
              </div>
              <div style={{ color: '#666', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUrl}
              </div>
            </div>

            {/* Notes list */}
            {filteredNotes.length > 0 && !showForm && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#666' }}>
                  📝 Notes for this page ({filteredNotes.length})
                </div>
                {filteredNotes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    category={getCategoryById(note.categoryId)}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onOpenPage={handleOpenPage}
                    onCopyUrl={handleCopyUrl}
                    onShowFullText={handleShowFullText}
                    getDisplayUrl={getDisplayUrl}
                  />
                ))}
              </div>
            )}

            {/* Add button */}
            {!showForm && (
              <button
                onClick={handleAddNew}
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '16px',
                  fontWeight: 500,
                  background: '#4a90d9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  marginBottom: '20px'
                }}
              >
                ➕ Add New Note
              </button>
            )}

            {/* Form */}
            {showForm && editViewMode === 'tab' && activeTab === 'current' && (
              <NoteForm
                title={noteTitle}
                content={noteContent}
                categoryId={noteCategoryId}
                hasReminder={hasReminder}
                scheduleType={scheduleType}
                reminderDate={reminderDate}
                reminderTime={reminderTime}
                recFrequency={recFrequency}
                recInterval={recInterval}
                recEndType={recEndType}
                recEndCount={recEndCount}
                recEndDate={recEndDate}
                recWeekdays={recWeekdays}
                recMonthlyMode={recMonthlyMode}
                recDayOfMonth={recDayOfMonth}
                recOrdinal={recOrdinal}
                recOrdinalWeekday={recOrdinalWeekday}
                recTimeHour={recTimeHour}
                recTimeMinute={recTimeMinute}
                categories={categories}
                isEditing={!!editingNote}
                onTitleChange={setNoteTitle}
                onContentChange={setNoteContent}
                onCategoryChange={setNoteCategoryId}
                onHasReminderChange={setHasReminder}
                onScheduleTypeChange={setScheduleType}
                onReminderDateChange={setReminderDate}
                onReminderTimeChange={setReminderTime}
                onRecFrequencyChange={setRecFrequency}
                onRecIntervalChange={setRecInterval}
                onRecEndTypeChange={setRecEndType}
                onRecEndCountChange={setRecEndCount}
                onRecEndDateChange={setRecEndDate}
                onRecWeekdaysChange={setRecWeekdays}
                onRecMonthlyModeChange={setRecMonthlyMode}
                onRecDayOfMonthChange={setRecDayOfMonth}
                onRecOrdinalChange={setRecOrdinal}
                onRecOrdinalWeekdayChange={setRecOrdinalWeekday}
                onRecTimeHourChange={setRecTimeHour}
                onRecTimeMinuteChange={setRecTimeMinute}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            )}
          </>
        )}

        {activeTab === 'all' && (
          <>
            {/* Category filter */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontWeight: 500, marginBottom: '8px', fontSize: '14px' }}>
                Filter by Category
              </label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '16px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  background: '#fff'
                }}
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {filterCategory && (() => {
                const selectedCat = categories.find(c => c.id === filterCategory);
                return selectedCat?.lastSyncTime ? (
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                    Last synced: {formatRelativeTime(selectedCat.lastSyncTime)}
                  </div>
                ) : null;
              })()}
            </div>

            {/* Notes list */}
            {filteredNotes.length > 0 ? (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: '#666' }}>
                  {filterCategory ? `${filteredNotes.length} notes` : `All notes (${filteredNotes.length})`}
                </div>
                {filteredNotes.map(note => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    category={getCategoryById(note.categoryId)}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onOpenPage={handleOpenPage}
                    onCopyUrl={handleCopyUrl}
                    onShowFullText={handleShowFullText}
                    getDisplayUrl={getDisplayUrl}
                  />
                ))}
              </div>
            ) : (
              <div style={{ 
                padding: '40px 20px', 
                textAlign: 'center', 
                color: '#999',
                fontSize: '16px'
              }}>
                {filterCategory ? 'No notes in this category' : 'No notes yet'}
              </div>
            )}
          </>
        )}

        {activeTab === 'edit' && editViewMode === 'tab' && (
          <>
            {!showForm ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: '#666' }}>
                <div style={{ marginBottom: '10px' }}>Select a note to edit from "This Page" or "All Notes".</div>
                <button
                  onClick={handleAddNew}
                  style={{
                    padding: '12px 18px',
                    fontSize: '15px',
                    fontWeight: 500,
                    background: '#4a90d9',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    touchAction: 'manipulation'
                  }}
                >
                  ➕ Add New Note
                </button>
              </div>
            ) : (
              <NoteForm
                title={noteTitle}
                content={noteContent}
                categoryId={noteCategoryId}
                hasReminder={hasReminder}
                scheduleType={scheduleType}
                reminderDate={reminderDate}
                reminderTime={reminderTime}
                recFrequency={recFrequency}
                recInterval={recInterval}
                recEndType={recEndType}
                recEndCount={recEndCount}
                recEndDate={recEndDate}
                recWeekdays={recWeekdays}
                recMonthlyMode={recMonthlyMode}
                recDayOfMonth={recDayOfMonth}
                recOrdinal={recOrdinal}
                recOrdinalWeekday={recOrdinalWeekday}
                recTimeHour={recTimeHour}
                recTimeMinute={recTimeMinute}
                categories={categories}
                isEditing={!!editingNote}
                onTitleChange={setNoteTitle}
                onContentChange={setNoteContent}
                onCategoryChange={setNoteCategoryId}
                onHasReminderChange={setHasReminder}
                onScheduleTypeChange={setScheduleType}
                onReminderDateChange={setReminderDate}
                onReminderTimeChange={setReminderTime}
                onRecFrequencyChange={setRecFrequency}
                onRecIntervalChange={setRecInterval}
                onRecEndTypeChange={setRecEndType}
                onRecEndCountChange={setRecEndCount}
                onRecEndDateChange={setRecEndDate}
                onRecWeekdaysChange={setRecWeekdays}
                onRecMonthlyModeChange={setRecMonthlyMode}
                onRecDayOfMonthChange={setRecDayOfMonth}
                onRecOrdinalChange={setRecOrdinal}
                onRecOrdinalWeekdayChange={setRecOrdinalWeekday}
                onRecTimeHourChange={setRecTimeHour}
                onRecTimeMinuteChange={setRecTimeMinute}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            )}
          </>
        )}
      </div>

      {showForm && editViewMode === 'modal' && (
        <div style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0, 
          background: '#fff',
          zIndex: 100,
          overflowY: 'auto',
          padding: '20px'
        }}>
          <NoteForm
            title={noteTitle}
            content={noteContent}
            categoryId={noteCategoryId}
            hasReminder={hasReminder}
            scheduleType={scheduleType}
            reminderDate={reminderDate}
            reminderTime={reminderTime}
            recFrequency={recFrequency}
            recInterval={recInterval}
            recEndType={recEndType}
            recEndCount={recEndCount}
            recEndDate={recEndDate}
            recWeekdays={recWeekdays}
            recMonthlyMode={recMonthlyMode}
            recDayOfMonth={recDayOfMonth}
            recOrdinal={recOrdinal}
            recOrdinalWeekday={recOrdinalWeekday}
            recTimeHour={recTimeHour}
            recTimeMinute={recTimeMinute}
            categories={categories}
            isEditing={!!editingNote}
            onTitleChange={setNoteTitle}
            onContentChange={setNoteContent}
            onCategoryChange={setNoteCategoryId}
            onHasReminderChange={setHasReminder}
            onScheduleTypeChange={setScheduleType}
            onReminderDateChange={setReminderDate}
            onReminderTimeChange={setReminderTime}
            onRecFrequencyChange={setRecFrequency}
            onRecIntervalChange={setRecInterval}
            onRecEndTypeChange={setRecEndType}
            onRecEndCountChange={setRecEndCount}
            onRecEndDateChange={setRecEndDate}
            onRecWeekdaysChange={setRecWeekdays}
            onRecMonthlyModeChange={setRecMonthlyMode}
            onRecDayOfMonthChange={setRecDayOfMonth}
            onRecOrdinalChange={setRecOrdinal}
            onRecOrdinalWeekdayChange={setRecOrdinalWeekday}
            onRecTimeHourChange={setRecTimeHour}
            onRecTimeMinuteChange={setRecTimeMinute}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      )}

      {/* Footer with version */}
      <div style={{
        padding: '16px 20px',
        textAlign: 'center',
        fontSize: '12px',
        color: '#999',
        borderTop: '1px solid #e0e0e0'
      }}>
        v{process.env.APP_VERSION} ({process.env.GIT_HASH})
      </div>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#333',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontSize: '14px',
          zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          {toast}
        </div>
      )}

      {/* Modal for full text */}
      {showModal && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowModal(null)}
        >
          <div 
            style={{
              background: '#fff',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '500px',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'flex-start',
              marginBottom: '16px'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, flex: 1 }}>
                {showModal.title}
              </h3>
              <button
                onClick={() => setShowModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0 8px',
                  marginLeft: '12px'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ 
              fontSize: '15px', 
              lineHeight: '1.6', 
              color: '#333',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {showModal.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Note card component
interface NoteCardProps {
  note: PageNote;
  category?: Category;
  onEdit: (note: PageNote) => void;
  onDelete: (note: PageNote) => void;
  onOpenPage: (url: string) => void;
  onCopyUrl: (url: string, event: React.MouseEvent) => void;
  onShowFullText: (note: PageNote, event: React.MouseEvent) => void;
  getDisplayUrl: (note: PageNote) => string;
}

function NoteCard({ note, category, onEdit, onDelete, onOpenPage, onCopyUrl, onShowFullText, getDisplayUrl }: NoteCardProps) {
  const preview = note.content.length > 80 ? note.content.slice(0, 80) + '...' : note.content;
  
  return (
    <div style={{
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      padding: '12px',
      marginBottom: '12px',
      background: category ? category.color + '0D' : '#fff'  // Light background based on category
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '8px' }}>
        <div style={{ flex: 1 }}>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              marginBottom: '4px',
              cursor: 'pointer'
            }}
            onClick={() => onOpenPage(note.url)}
          >
            <span>{note.hasReminder ? '🔔' : '📝'}</span>
            <span style={{ fontWeight: 500, fontSize: '15px', color: '#4a90d9' }}>
              {note.title}
            </span>
          </div>
          <div 
            style={{ 
              fontSize: '12px', 
              color: '#666', 
              marginBottom: '4px',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
            onClick={(e) => onCopyUrl(note.url, e)}
          >
            {getDisplayUrl(note)}
          </div>
          {preview && (
            <div 
              style={{ 
                fontSize: '13px', 
                color: '#333', 
                marginTop: '6px',
                cursor: note.content.length > 80 ? 'pointer' : 'default'
              }}
              onClick={note.content.length > 80 ? (e) => onShowFullText(note, e) : undefined}
            >
              {preview}
            </div>
          )}
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {category && (
          <span style={{
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 500,
            background: category.color + '26',
            color: category.color
          }}>
            {category.name}
          </span>
        )}
        
        <span style={{
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          background: '#f0f0f0',
          color: '#666'
        }}>
          {note.urlMatchType || 'exact'}
        </span>
        
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => onEdit(note)}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              touchAction: 'manipulation',
              minWidth: '44px',
              minHeight: '44px'
            }}
          >
            ✏️ Edit
          </button>
          <button
            onClick={() => onDelete(note)}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: '4px',
              cursor: 'pointer',
              touchAction: 'manipulation',
              minWidth: '44px',
              minHeight: '44px',
              color: '#d32f2f'
            }}
          >
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// Note form component
interface NoteFormProps {
  title: string;
  content: string;
  categoryId: string | null;
  hasReminder: boolean;
  scheduleType: ScheduleType;
  reminderDate: string;
  reminderTime: string;
  recFrequency: FrequencyType;
  recInterval: number;
  recEndType: 'never' | 'count' | 'date';
  recEndCount: number;
  recEndDate: string;
  recWeekdays: number[];
  recMonthlyMode: 'day' | 'weekday';
  recDayOfMonth: number;
  recOrdinal: number;
  recOrdinalWeekday: number;
  recTimeHour: number;
  recTimeMinute: number;
  categories: Category[];
  isEditing: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onCategoryChange: (value: string | null) => void;
  onHasReminderChange: (value: boolean) => void;
  onScheduleTypeChange: (value: ScheduleType) => void;
  onReminderDateChange: (value: string) => void;
  onReminderTimeChange: (value: string) => void;
  onRecFrequencyChange: (value: FrequencyType) => void;
  onRecIntervalChange: (value: number) => void;
  onRecEndTypeChange: (value: 'never' | 'count' | 'date') => void;
  onRecEndCountChange: (value: number) => void;
  onRecEndDateChange: (value: string) => void;
  onRecWeekdaysChange: (value: number[]) => void;
  onRecMonthlyModeChange: (value: 'day' | 'weekday') => void;
  onRecDayOfMonthChange: (value: number) => void;
  onRecOrdinalChange: (value: number) => void;
  onRecOrdinalWeekdayChange: (value: number) => void;
  onRecTimeHourChange: (value: number) => void;
  onRecTimeMinuteChange: (value: number) => void;
  onSave: () => void;
  onCancel: () => void;
}

function NoteForm({
  title,
  content,
  categoryId,
  hasReminder,
  scheduleType,
  reminderDate,
  reminderTime,
  recFrequency,
  recInterval,
  recEndType,
  recEndCount,
  recEndDate,
  recWeekdays,
  recMonthlyMode,
  recDayOfMonth,
  recOrdinal,
  recOrdinalWeekday,
  recTimeHour,
  recTimeMinute,
  categories,
  isEditing,
  onTitleChange,
  onContentChange,
  onCategoryChange,
  onHasReminderChange,
  onScheduleTypeChange,
  onReminderDateChange,
  onReminderTimeChange,
  onRecFrequencyChange,
  onRecIntervalChange,
  onRecEndTypeChange,
  onRecEndCountChange,
  onRecEndDateChange,
  onRecWeekdaysChange,
  onRecMonthlyModeChange,
  onRecDayOfMonthChange,
  onRecOrdinalChange,
  onRecOrdinalWeekdayChange,
  onRecTimeHourChange,
  onRecTimeMinuteChange,
  onSave,
  onCancel
}: NoteFormProps) {
  // Build recurring pattern for preview
  function buildRecurringPatternPreview(): RecurringPattern | null {
    if (!hasReminder || scheduleType !== 'recurring') {
      return null;
    }

    let endCondition: EndCondition;
    if (recEndType === 'count') {
      endCondition = { type: 'count' as const, occurrences: recEndCount };
    } else if (recEndType === 'date' && recEndDate) {
      endCondition = { type: 'date' as const, endDate: new Date(recEndDate).getTime() };
    } else {
      endCondition = { type: 'never' as const };
    }

    const pattern: RecurringPattern = {
      frequency: recFrequency,
      interval: recInterval,
      endCondition
    };

    if (recFrequency === 'weekly' && recWeekdays.length > 0) {
      pattern.weekdays = recWeekdays;
    }

    if (recFrequency === 'monthly') {
      if (recMonthlyMode === 'day') {
        pattern.dayOfMonth = recDayOfMonth;
      } else {
        pattern.weekdayOrdinal = { ordinal: recOrdinal, weekday: recOrdinalWeekday };
      }
    }

    if (['daily', 'weekly', 'monthly', 'yearly'].includes(recFrequency)) {
      pattern.timeOfDay = { hour: recTimeHour, minute: recTimeMinute };
    }

    return pattern;
  }

  return (
    <div>
      <h2 style={{ 
        fontSize: '20px',
        marginBottom: '20px',
        color: '#333'
      }}>
        {isEditing ? 'Edit Note' : 'Add New Note'}
      </h2>

      {/* Title input */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: '8px' }}>
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Enter note title"
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            border: '1px solid #ddd',
            borderRadius: '4px'
          }}
          autoFocus
        />
      </div>

      {/* Content textarea */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: '8px' }}>
          Content
        </label>
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="Enter note content"
          rows={6}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontFamily: 'inherit',
            resize: 'vertical'
          }}
        />
      </div>

      {/* Category selector */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 500, marginBottom: '8px' }}>
          Category
        </label>
        <select
          value={categoryId || ''}
          onChange={(e) => onCategoryChange(e.target.value || null)}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            background: '#fff'
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
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px' }}>
          <input
            type="checkbox"
            checked={hasReminder}
            onChange={(e) => {
              const enabled = e.target.checked;
              onHasReminderChange(enabled);
              // Set default time 1 hour from now when enabling
              if (enabled && !reminderDate) {
                const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
                onReminderDateChange(defaultTime.toISOString().split('T')[0]);
                onReminderTimeChange(defaultTime.toTimeString().slice(0, 5));
              }
            }}
            style={{ width: '18px', height: '18px' }}
          />
          <span style={{ fontSize: '16px', fontWeight: 500 }}>⏰ Add reminder for this note</span>
        </label>

        {hasReminder && (
          <div style={{ 
            padding: '12px', 
            background: '#f9f9f9', 
            borderRadius: '4px', 
            border: '1px solid #e0e0e0' 
          }}>
            <div style={{ marginBottom: '8px', fontSize: '14px', color: '#666' }}>
              ℹ️ Note: Reminders sync across devices but alarms only trigger on desktop
            </div>
            
            {/* Schedule type toggle */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                Schedule Type
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => onScheduleTypeChange('once')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    fontSize: '16px',
                    border: scheduleType === 'once' ? '2px solid #0066cc' : '1px solid #ddd',
                    borderRadius: '4px',
                    background: scheduleType === 'once' ? '#e6f2ff' : '#fff',
                    color: scheduleType === 'once' ? '#0066cc' : '#333',
                    cursor: 'pointer',
                    fontWeight: scheduleType === 'once' ? 600 : 400,
                    minHeight: '44px'
                  }}
                >
                  One-time
                </button>
                <button
                  type="button"
                  onClick={() => onScheduleTypeChange('recurring')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    fontSize: '16px',
                    border: scheduleType === 'recurring' ? '2px solid #0066cc' : '1px solid #ddd',
                    borderRadius: '4px',
                    background: scheduleType === 'recurring' ? '#e6f2ff' : '#fff',
                    color: scheduleType === 'recurring' ? '#0066cc' : '#333',
                    cursor: 'pointer',
                    fontWeight: scheduleType === 'recurring' ? 600 : 400,
                    minHeight: '44px'
                  }}
                >
                  Recurring
                </button>
              </div>
            </div>

            {/* One-time: Date and Time */}
            {scheduleType === 'once' && (
              <>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                    Date
                  </label>
                  <input
                    type="date"
                    value={reminderDate}
                    onChange={(e) => onReminderDateChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '4px'
                    }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                    Time
                  </label>
                  <input
                    type="time"
                    value={reminderTime}
                    onChange={(e) => onReminderTimeChange(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '4px'
                    }}
                  />
                </div>
              </>
            )}
            {/* Recurring options */}
            {scheduleType === 'recurring' && (
              <div style={{
                padding: '12px',
                background: '#fff3e0',
                borderRadius: '4px',
                border: '1px solid #ffb74d',
                marginBottom: '12px'
              }}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                    Repeat every
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="number"
                      min="1"
                      value={recInterval}
                      onChange={(e) => onRecIntervalChange(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{
                        width: '80px',
                        padding: '12px',
                        fontSize: '16px',
                        border: '1px solid #ddd',
                        borderRadius: '4px'
                      }}
                    />
                    <select
                      value={recFrequency}
                      onChange={(e) => onRecFrequencyChange(e.target.value as FrequencyType)}
                      style={{
                        flex: 1,
                        padding: '12px',
                        fontSize: '16px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        background: '#fff'
                      }}
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
                </div>

                {/* Weekday checkboxes for weekly */}
                {recFrequency === 'weekly' && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                      On days:
                    </label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                        <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', minWidth: '80px' }}>
                          <input
                            type="checkbox"
                            checked={recWeekdays.includes(idx)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                onRecWeekdaysChange([...recWeekdays, idx].sort());
                              } else if (recWeekdays.length > 1) {
                                onRecWeekdaysChange(recWeekdays.filter((d) => d !== idx));
                              }
                            }}
                            style={{ width: '18px', height: '18px' }}
                          />
                          {day}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Monthly options */}
                {recFrequency === 'monthly' && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        checked={recMonthlyMode === 'day'} 
                        onChange={() => onRecMonthlyModeChange('day')}
                        style={{ width: '18px', height: '18px' }}
                      />
                      <span style={{ fontSize: '14px' }}>On day</span>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={recDayOfMonth}
                        onChange={(e) => onRecDayOfMonthChange(Math.min(31, Math.max(1, parseInt(e.target.value) || 1)))}
                        disabled={recMonthlyMode !== 'day'}
                        style={{ 
                          width: '60px', 
                          padding: '8px', 
                          fontSize: '14px',
                          border: '1px solid #ddd', 
                          borderRadius: '4px',
                          background: recMonthlyMode === 'day' ? '#fff' : '#f0f0f0'
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        checked={recMonthlyMode === 'weekday'} 
                        onChange={() => onRecMonthlyModeChange('weekday')}
                        style={{ width: '18px', height: '18px' }}
                      />
                      <span style={{ fontSize: '14px' }}>On the</span>
                      <select
                        value={recOrdinal}
                        onChange={(e) => onRecOrdinalChange(parseInt(e.target.value))}
                        disabled={recMonthlyMode !== 'weekday'}
                        style={{ 
                          padding: '8px', 
                          fontSize: '14px',
                          border: '1px solid #ddd', 
                          borderRadius: '4px',
                          background: recMonthlyMode === 'weekday' ? '#fff' : '#f0f0f0'
                        }}
                      >
                        {['1st', '2nd', '3rd', '4th', 'Last'].map((lbl, idx) => (
                          <option key={idx} value={idx + 1}>{lbl}</option>
                        ))}
                      </select>
                      <select
                        value={recOrdinalWeekday}
                        onChange={(e) => onRecOrdinalWeekdayChange(parseInt(e.target.value))}
                        disabled={recMonthlyMode !== 'weekday'}
                        style={{ 
                          padding: '8px', 
                          fontSize: '14px',
                          border: '1px solid #ddd', 
                          borderRadius: '4px',
                          background: recMonthlyMode === 'weekday' ? '#fff' : '#f0f0f0'
                        }}
                      >
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                          <option key={idx} value={idx}>{day}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {/* Time of day for daily/weekly/monthly/yearly */}
                {['daily', 'weekly', 'monthly', 'yearly'].includes(recFrequency) && (
                  <div style={{ marginBottom: '12px', paddingTop: '12px', borderTop: '1px solid #e0e0e0' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
                      Trigger at:
                    </label>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={recTimeHour}
                        onChange={(e) => onRecTimeHourChange(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                        style={{ 
                          width: '60px', 
                          padding: '12px', 
                          fontSize: '16px',
                          border: '1px solid #ddd', 
                          borderRadius: '4px',
                          textAlign: 'center'
                        }}
                      />
                      <span style={{ fontSize: '20px' }}>:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={recTimeMinute}
                        onChange={(e) => onRecTimeMinuteChange(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                        style={{ 
                          width: '60px', 
                          padding: '12px', 
                          fontSize: '16px',
                          border: '1px solid #ddd', 
                          borderRadius: '4px',
                          textAlign: 'center'
                        }}
                      />
                      <span style={{ fontSize: '14px', color: '#666' }}>
                        ({String(recTimeHour).padStart(2, '0')}:{String(recTimeMinute).padStart(2, '0')})
                      </span>
                    </div>
                  </div>
                )}

                {/* End condition */}
                <div style={{ paddingTop: '12px', borderTop: '1px solid #e0e0e0' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                    End condition
                  </label>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                      <input
                        type="radio"
                        checked={recEndType === 'never'}
                        onChange={() => onRecEndTypeChange('never')}
                        style={{ width: '18px', height: '18px' }}
                      />
                      <span style={{ fontSize: '16px' }}>Never</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                      <input
                        type="radio"
                        checked={recEndType === 'date'}
                        onChange={() => onRecEndTypeChange('date')}
                        style={{ width: '18px', height: '18px' }}
                      />
                      <span style={{ fontSize: '16px' }}>On date:</span>
                      <input
                        type="date"
                        value={recEndDate}
                        onChange={(e) => onRecEndDateChange(e.target.value)}
                        disabled={recEndType !== 'date'}
                        style={{
                          padding: '8px',
                          fontSize: '14px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          background: recEndType === 'date' ? '#fff' : '#f0f0f0'
                        }}
                      />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        checked={recEndType === 'count'}
                        onChange={() => onRecEndTypeChange('count')}
                        style={{ width: '18px', height: '18px' }}
                      />
                      <span style={{ fontSize: '16px' }}>After</span>
                      <input
                        type="number"
                        min="1"
                        value={recEndCount}
                        onChange={(e) => onRecEndCountChange(Math.max(1, parseInt(e.target.value) || 1))}
                        disabled={recEndType !== 'count'}
                        style={{
                          width: '70px',
                          padding: '8px',
                          fontSize: '16px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          background: recEndType === 'count' ? '#fff' : '#f0f0f0'
                        }}
                      />
                      <span style={{ fontSize: '16px' }}>time(s)</span>
                    </label>
                  </div>
                </div>

                {/* Pattern preview */}
                <div style={{ 
                  marginTop: '12px', 
                  padding: '12px', 
                  background: '#f5f5f5', 
                  borderRadius: '4px', 
                  fontSize: '14px', 
                  color: '#666' 
                }}>
                  📅 {buildRecurringPatternPreview() ? describeRecurringPattern(buildRecurringPatternPreview()!) : 'Set up recurring reminder...'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={onSave}
          style={{
            flex: 1,
            padding: '14px',
            fontSize: '16px',
            fontWeight: 500,
            background: '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            touchAction: 'manipulation',
            minHeight: '48px'
          }}
        >
          {isEditing ? 'Update Note' : 'Save Note'}
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '14px',
            fontSize: '16px',
            fontWeight: 500,
            background: '#eee',
            color: '#333',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            touchAction: 'manipulation',
            minHeight: '48px'
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Initialize
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<MobileApp />);
}
