import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { storageService } from '../shared/services/storage';
import { PageNote, TimeReminder, Category, UrlMatchType } from '../shared/types';
import { createNote, createReminder } from '../shared/utils/helpers';
import { parseTimeInput, formatDate, formatRelativeTime } from '../shared/utils/timeParser';

type View = 'notes' | 'reminders' | 'categories' | 'settings';

interface DeleteCategoryState {
  category: Category;
  action: 'move' | 'remove';
  targetCategoryId: string;
}

function Sidebar() {
  const [view, setView] = useState<View>('notes');
  const [notes, setNotes] = useState<PageNote[]>([]);
  const [reminders, setReminders] = useState<TimeReminder[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState<PageNote | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<DeleteCategoryState | null>(null);

  useEffect(() => {
    loadData();
    checkForEditRequest();

    // Listen for storage changes to auto-refresh
    const handleStorageChange = () => {
      loadData();
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Check if opened from overlay edit button
  async function checkForEditRequest() {
    try {
      const data = await browser.storage.local.get('editNoteId');
      if (data.editNoteId) {
        await browser.storage.local.remove('editNoteId');
        const allNotes = await storageService.getNotes();
        const noteToEdit = allNotes.find((n) => n.id === data.editNoteId);
        if (noteToEdit) {
          setEditingNote(noteToEdit);
          setView('notes');
        }
      }
    } catch (error) {
      console.error('Error checking edit request:', error);
    }
  }

  async function loadData() {
    try {
      const [notesData, remindersData, categoriesData] = await Promise.all([
        storageService.getNotes(),
        storageService.getReminders(),
        storageService.getCategories(),
      ]);
      setNotes(notesData);
      setReminders(remindersData);
      setCategories(categoriesData);
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #ddd' }}>
        <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>TabReminder</h1>
      </header>

      <nav style={{ display: 'flex', borderBottom: '1px solid #ddd', flexShrink: 0 }}>
        {(['notes', 'reminders', 'categories'] as View[]).map((v) => {
          const viewLabels: Record<string, string> = {
            notes: '📝 Notes',
            reminders: '⏰ Reminders',
            categories: '🏷️ Categories',
          };
          return (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                flex: 1,
                padding: '10px',
                border: 'none',
                background: view === v ? '#f0f0f0' : 'transparent',
                cursor: 'pointer',
                fontWeight: view === v ? 600 : 400,
                borderBottom: view === v ? '2px solid #4a90d9' : '2px solid transparent',
              }}
            >
              {viewLabels[v]}
            </button>
          );
        })}
      </nav>

      <main style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {view === 'notes' && (
          <NotesView
            notes={notes}
            categories={categories}
            filterCategory={filterCategory}
            onFilterChange={setFilterCategory}
            onEdit={setEditingNote}
            onDelete={async (id) => {
              await storageService.deleteNote(id);
              setNotes(await storageService.getNotes());
              browser.runtime.sendMessage({ type: 'NOTE_DELETED' });
            }}
          />
        )}

        {view === 'reminders' && (
          <RemindersView
            reminders={reminders}
            categories={categories}
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
                    // Reschedule recurring to next occurrence
                    const { calculateNextTrigger } = await import('../shared/utils/timeParser');
                    reminder.nextTrigger = calculateNextTrigger(reminder.recurringPattern);
                    await storageService.saveReminder(reminder);
                  } else {
                    // Delete one-time overdue
                    await storageService.deleteReminder(reminder.id);
                  }
                }
              }
              setReminders(await storageService.getReminders());
              browser.runtime.sendMessage({ type: 'REMINDER_DELETED' });
            }}
          />
        )}

        {view === 'categories' && (
          <CategoriesView
            categories={categories}
            notes={notes}
            reminders={reminders}
            onAdd={async (category) => {
              await storageService.saveCategory(category);
              setCategories(await storageService.getCategories());
            }}
            onRequestDelete={(category) => {
              setDeletingCategory({
                category,
                action: 'remove',
                targetCategoryId: '',
              });
            }}
          />
        )}
      </main>

      {editingNote && (
        <EditNoteModal
          note={editingNote}
          categories={categories}
          onSave={async (note) => {
            await storageService.saveNote(note);
            setNotes(await storageService.getNotes());
            browser.runtime.sendMessage({ type: 'NOTE_UPDATED' });
            setEditingNote(null);
          }}
          onClose={() => setEditingNote(null)}
        />
      )}

      {deletingCategory && (
        <DeleteCategoryModal
          category={deletingCategory.category}
          categories={categories}
          notes={notes}
          reminders={reminders}
          onConfirm={async (action, targetCategoryId) => {
            const categoryId = deletingCategory.category.id;

            // Update notes
            for (const note of notes) {
              if (note.categoryId === categoryId) {
                const updatedNote = {
                  ...note,
                  categoryId: action === 'move' ? targetCategoryId : null,
                  updatedAt: Date.now(),
                };
                await storageService.saveNote(updatedNote);
              }
            }

            // Update reminders
            for (const reminder of reminders) {
              if (reminder.categoryId === categoryId) {
                const updatedReminder = {
                  ...reminder,
                  categoryId: action === 'move' ? targetCategoryId : null,
                };
                await storageService.saveReminder(updatedReminder);
              }
            }

            // Delete the category
            await storageService.deleteCategory(categoryId);

            // Refresh data
            setNotes(await storageService.getNotes());
            setReminders(await storageService.getReminders());
            setCategories(await storageService.getCategories());
            setDeletingCategory(null);
          }}
          onClose={() => setDeletingCategory(null)}
        />
      )}

      <footer style={{
        padding: '8px 16px',
        borderTop: '1px solid #ddd',
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

interface NotesViewProps {
  notes: PageNote[];
  categories: Category[];
  filterCategory: string;
  onFilterChange: (category: string) => void;
  onEdit: (note: PageNote) => void;
  onDelete: (id: string) => void;
}

function NotesView({
  notes,
  categories,
  filterCategory,
  onFilterChange,
  onEdit,
  onDelete,
}: NotesViewProps) {
  const filteredNotes =
    filterCategory === 'all'
      ? notes
      : notes.filter((n) => n.categoryId === filterCategory);

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
          <option value="all">All categories ({notes.length})</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({notes.filter((n) => n.categoryId === cat.id).length})
            </option>
          ))}
        </select>
      </div>

      {filteredNotes.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '40px' }}>
          No notes found.
        </div>
      ) : (
        <div>
          {filteredNotes.map((note) => {
            const category = categories.find((c) => c.id === note.categoryId);
            return (
              <div
                key={note.id}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid #eee',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                      {note.title || 'Untitled'}
                    </div>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                      {note.content.substring(0, 100)}
                      {note.content.length > 100 && '...'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#999' }}>
                      {new URL(note.url).hostname} • {note.urlMatchType}
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
                          marginTop: '4px',
                        }}
                      >
                        {category.name}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button
                      onClick={() => browser.tabs.create({ url: note.url })}
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
                      onClick={() => onEdit(note)}
                      title="Edit note"
                      className="icon-btn"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#666',
                        cursor: 'pointer',
                        padding: '4px',
                        fontSize: '14px',
                        borderRadius: '4px',
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
                        padding: '4px',
                        fontSize: '14px',
                        borderRadius: '4px',
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', wordBreak: 'break-all' }}>
                  {note.url}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface RemindersViewProps {
  reminders: TimeReminder[];
  categories: Category[];
  onDelete: (id: string) => void;
  onClearOverdue: () => void;
}

function RemindersView({ reminders, categories, onDelete, onClearOverdue }: RemindersViewProps) {
  const sortedReminders = [...reminders].sort((a, b) => a.nextTrigger - b.nextTrigger);
  const overdueCount = reminders.filter((r) => r.nextTrigger <= Date.now()).length;

  return (
    <div>
      {overdueCount > 0 && (
        <div style={{ marginBottom: '12px', padding: '8px', backgroundColor: '#fff3f3', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#e53935', fontSize: '13px' }}>
            {overdueCount} overdue reminder{overdueCount > 1 ? 's' : ''}
          </span>
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
              fontSize: '12px',
            }}
          >
            Clear Overdue
          </button>
        </div>
      )}

      {sortedReminders.length === 0 ? (
        <div style={{ color: '#666', textAlign: 'center', padding: '40px' }}>
          No reminders scheduled.
        </div>
      ) : (
        <div>
          {sortedReminders.map((reminder) => {
            const category = categories.find((c) => c.id === reminder.categoryId);
            const isOverdue = reminder.nextTrigger <= Date.now();
            return (
              <div
                key={reminder.id}
                className="hover-item"
                style={{
                  padding: '12px',
                  borderBottom: '1px solid #eee',
                  backgroundColor: isOverdue ? '#fff3f3' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
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
                    <div style={{ fontSize: '11px', color: '#666', wordBreak: 'break-all', marginBottom: '4px' }}>
                      {reminder.url}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {reminder.scheduleType === 'recurring' && (
                        <span
                          style={{
                            display: 'inline-block',
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
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button
                      onClick={() => browser.tabs.create({ url: reminder.url })}
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
                      onClick={() => onDelete(reminder.id)}
                      title="Delete reminder"
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CategoriesViewProps {
  categories: Category[];
  notes: PageNote[];
  reminders: TimeReminder[];
  onAdd: (category: Category) => void;
  onRequestDelete: (category: Category) => void;
}

function CategoriesView({ categories, notes, reminders, onAdd, onRequestDelete }: CategoriesViewProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4a90d9');
  const [error, setError] = useState('');

  async function handleAdd() {
    if (!name.trim()) return;

    // Check for duplicate name (case-insensitive)
    const exists = categories.some((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (exists) {
      setError(`Category "${name.trim()}" already exists`);
      return;
    }

    onAdd({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name: name.trim(),
      color,
      isDefault: false,
    });
    setName('');
    setColor('#4a90d9');
    setError('');
  }

  return (
    <div>
      <div style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid #eee' }}>
        <div style={{ marginBottom: '8px', display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
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
            value={color}
            onChange={(e) => setColor(e.target.value)}
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
          onClick={handleAdd}
          disabled={!name.trim()}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: name.trim() ? '#4a90d9' : '#ccc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: name.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Add Category
        </button>
        {error && (
          <div style={{ color: '#e53935', fontSize: '12px', marginTop: '8px' }}>
            {error}
          </div>
        )}
      </div>

      <div>
        {categories.map((category) => {
          const noteCount = notes.filter((n) => n.categoryId === category.id).length;
          const reminderCount = reminders.filter((r) => r.categoryId === category.id).length;
          const totalCount = noteCount + reminderCount;

          return (
            <div
              key={category.id}
              style={{
                padding: '12px',
                borderBottom: '1px solid #eee',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    backgroundColor: category.color,
                  }}
                />
                <span>{category.name}</span>
                <span style={{ fontSize: '11px', color: '#666' }}>({totalCount})</span>
              </div>
              <button
                onClick={() => onRequestDelete(category)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#e53935',
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface EditNoteModalProps {
  note: PageNote;
  categories: Category[];
  onSave: (note: PageNote) => void;
  onClose: () => void;
}

function EditNoteModal({ note, categories, onSave, onClose }: EditNoteModalProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [urlMatchType, setUrlMatchType] = useState(note.urlMatchType);
  const [categoryId, setCategoryId] = useState(note.categoryId || '');

  return (
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
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '8px',
          padding: '20px',
          width: '100%',
          maxWidth: '400px',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Edit Note</h2>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
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
            Note
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
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
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: '#666' }}>
            URL Match
          </label>
          <select
            value={urlMatchType}
            onChange={(e) => setUrlMatchType(e.target.value as UrlMatchType)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '4px',
            }}
          >
            <option value="exact">Exact URL</option>
            <option value="path">Path</option>
            <option value="domain">Domain</option>
          </select>
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
            onClick={() =>
              onSave({
                ...note,
                title,
                content,
                urlMatchType,
                categoryId: categoryId || null,
                updatedAt: Date.now(),
              })
            }
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: '#4a90d9',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
          <button
            onClick={onClose}
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
  );
}

interface DeleteCategoryModalProps {
  category: Category;
  categories: Category[];
  notes: PageNote[];
  reminders: TimeReminder[];
  onConfirm: (action: 'move' | 'remove', targetCategoryId: string | null) => void;
  onClose: () => void;
}

function DeleteCategoryModal({
  category,
  categories,
  notes,
  reminders,
  onConfirm,
  onClose,
}: DeleteCategoryModalProps) {
  const [action, setAction] = useState<'move' | 'remove'>('remove');
  const [targetCategoryId, setTargetCategoryId] = useState('');

  const affectedNotes = notes.filter((n) => n.categoryId === category.id);
  const affectedReminders = reminders.filter((r) => r.categoryId === category.id);
  const totalAffected = affectedNotes.length + affectedReminders.length;

  const otherCategories = categories.filter((c) => c.id !== category.id);

  return (
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
      onClick={onClose}
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
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>
          Delete Category "{category.name}"
        </h2>

        {totalAffected > 0 ? (
          <>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              This category has {affectedNotes.length} note(s) and {affectedReminders.length} reminder(s).
              What should happen to them?
            </p>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                <input
                  type="radio"
                  name="deleteAction"
                  checked={action === 'remove'}
                  onChange={() => setAction('remove')}
                />
                <span>Remove category tag (items become uncategorized)</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="deleteAction"
                  checked={action === 'move'}
                  onChange={() => setAction('move')}
                  style={{ marginTop: '4px' }}
                />
                <div style={{ flex: 1 }}>
                  <span>Move items to another category:</span>
                  {action === 'move' && (
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
                      {otherCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            </div>
          </>
        ) : (
          <p style={{ color: '#666', marginBottom: '16px' }}>
            This category has no items. Are you sure you want to delete it?
          </p>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button
            onClick={() => onConfirm(action, action === 'move' ? targetCategoryId : null)}
            disabled={action === 'move' && !targetCategoryId}
            style={{
              flex: 1,
              padding: '10px',
              backgroundColor: action === 'move' && !targetCategoryId ? '#ccc' : '#e53935',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: action === 'move' && !targetCategoryId ? 'not-allowed' : 'pointer',
            }}
          >
            Delete Category
          </button>
          <button
            onClick={onClose}
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
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Sidebar />);
}
