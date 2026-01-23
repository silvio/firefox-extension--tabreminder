import { useState, useEffect } from 'react';

const STORAGE_KEY = 'tabreminder_popup_state';

interface PopupState {
  activeTab: string;
  noteTitle: string;
  noteContent: string;
  noteUrlMatchType: string;
  noteCategoryId: string;
  noteMatchUrl: string;
  reminderTitle: string;
  reminderTimeInput: string;
  reminderCategoryId: string;
  reminderMatchUrl: string;
  filterCategory: string;
}

const defaultState: PopupState = {
  activeTab: 'current',
  noteTitle: '',
  noteContent: '',
  noteUrlMatchType: 'exact',
  noteCategoryId: '',
  noteMatchUrl: '',
  reminderTitle: '',
  reminderTimeInput: '',
  reminderCategoryId: '',
  reminderMatchUrl: '',
  filterCategory: 'all',
};

export function usePopupState() {
  const [state, setState] = useState<PopupState>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        return { ...defaultState, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore errors
    }
    return defaultState;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore errors
    }
  }, [state]);

  function updateState(partial: Partial<PopupState>) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  function resetNoteForm() {
    updateState({
      noteTitle: '',
      noteContent: '',
      noteUrlMatchType: 'exact',
      noteCategoryId: '',
      noteMatchUrl: '',
    });
  }

  function resetReminderForm() {
    updateState({
      reminderTitle: '',
      reminderTimeInput: '',
      reminderCategoryId: '',
      reminderMatchUrl: '',
    });
  }

  return { state, updateState, resetNoteForm, resetReminderForm };
}
