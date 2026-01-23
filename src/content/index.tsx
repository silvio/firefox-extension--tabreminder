// Content script - displays note overlays on pages
import React, { useState, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { PageNote, OverlayStyle, Category } from '../shared/types';

interface NotesOverlayProps {
  notes: PageNote[];
  categories: Category[];
  style: OverlayStyle;
  hasReminders: boolean;
  onClose: () => void;
}

function NotesOverlay({ notes, categories, style, hasReminders, onClose }: NotesOverlayProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Auto-hide timeout
  useEffect(() => {
    if (style.timeout && style.timeout > 0) {
      const timer = setTimeout(() => onClose(), style.timeout);
      return () => clearTimeout(timer);
    }
  }, [style.timeout, onClose]);

  const visibleNotes = notes.filter((n) => !dismissed.has(n.id));
  if (visibleNotes.length === 0) {
    onClose();
    return null;
  }

  const fontSize = style.fontSize || 14;
  const fontFamily = style.fontFamily || 'system-ui, sans-serif';
  const borderWidth = style.borderWidth || 2;
  const opacity = style.opacity ?? 1.0;

  function getCategoryColor(categoryId: string | null): string | null {
    if (!categoryId) return null;
    const cat = categories.find((c) => c.id === categoryId);
    return cat?.color || null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        maxWidth: '380px',
        maxHeight: '80vh',
        overflow: 'auto',
        backgroundColor: style.backgroundColor,
        border: `${borderWidth}px solid ${style.borderColor}`,
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        zIndex: 2147483647,
        fontFamily,
        fontSize: `${fontSize}px`,
        opacity,
        color: '#fff',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: `2px solid ${style.borderColor}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          backgroundColor: style.backgroundColor,
        }}
      >
        <strong style={{ color: '#fff' }}>
          📝 {visibleNotes.length} Note{visibleNotes.length > 1 ? 's' : ''}
          {hasReminders && <span style={{ marginLeft: '8px' }}>⏰</span>}
        </strong>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '18px',
            color: '#ccc',
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>

      {visibleNotes.map((note, index) => {
        const catColor = getCategoryColor(note.categoryId);
        return (
          <div
            key={note.id}
            style={{
              padding: '12px 16px',
              borderBottom: index < visibleNotes.length - 1 ? `2px solid ${style.borderColor}40` : 'none',
              borderLeft: catColor ? `4px solid ${catColor}` : 'none',
              marginLeft: catColor ? '0' : '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#fff', marginBottom: '4px' }}>
                  {note.title || 'Note'}
                </div>
                <div style={{ fontSize: '10px', color: '#999', textTransform: 'uppercase' }}>
                  {note.urlMatchType} match
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {visibleNotes.length > 1 && (
                  <button
                    onClick={() => setDismissed(new Set([...dismissed, note.id]))}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#999',
                      padding: '0 4px',
                    }}
                    title="Dismiss this note"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div
              style={{
                color: '#eee',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content) }}
            />
          </div>
        );
      })}
    </div>
  );
}

// Markdown renderer with images and code blocks
function renderMarkdown(text: string): string {
  // First handle code blocks and images (before escaping)
  const codeBlocks: string[] = [];
  const images: string[] = [];

  // Extract code blocks
  let processedText = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    const langClass = lang ? ` data-lang="${lang}"` : '';
    const langLabel = lang ? `<div style="font-size:10px;color:#888;margin-bottom:4px">${lang}</div>` : '';
    codeBlocks.push(
      `<div style="background:#1e1e1e;padding:8px 12px;border-radius:4px;margin:8px 0;overflow-x:auto">${langLabel}<pre style="margin:0;font-family:monospace;font-size:12px;white-space:pre-wrap"${langClass}>${escapeHtml(code.trim())}</pre></div>`
    );
    return placeholder;
  });

  // Extract images before escaping
  processedText = processedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const placeholder = `__IMAGE_${images.length}__`;
    images.push(`<img src="${url}" alt="${escapeHtml(alt)}" style="max-width:100%;height:auto;border-radius:4px;margin:4px 0" />`);
    return placeholder;
  });

  let html = escapeHtml(processedText);

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });

  // Restore images
  images.forEach((img, i) => {
    html = html.replace(`__IMAGE_${i}__`, img);
  });

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code style="background:#333;padding:2px 4px;border-radius:3px;font-family:monospace">$1</code>');

  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#4a90d9">$1</a>');

  // Headers: # ## ###
  html = html.replace(/^### (.+)$/gm, '<div style="font-size:14px;font-weight:600;margin:8px 0 4px">$1</div>');
  html = html.replace(/^## (.+)$/gm, '<div style="font-size:15px;font-weight:600;margin:8px 0 4px">$1</div>');
  html = html.replace(/^# (.+)$/gm, '<div style="font-size:16px;font-weight:600;margin:8px 0 4px">$1</div>');

  // Blockquote: > text
  html = html.replace(/^&gt; (.+)$/gm, '<div style="border-left:3px solid #666;padding-left:10px;margin:4px 0;color:#aaa">$1</div>');

  // Lists: - item or * item
  html = html.replace(/^[-*] (.+)$/gm, '<div style="padding-left:12px">• $1</div>');

  // Numbered lists: 1. item
  html = html.replace(/^\d+\. (.+)$/gm, '<div style="padding-left:12px">$1</div>');

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const defaultStyle: OverlayStyle = {
  backgroundColor: '#000000',
  borderColor: '#e53935',
  borderWidth: 2,
  fontSize: 14,
  fontFamily: 'system-ui, sans-serif',
  timeout: 0,
  opacity: 1.0,
};

function showNotes(notes: PageNote[], categories: Category[], style: OverlayStyle = defaultStyle, hasReminders = false) {
  if (!container) {
    container = document.createElement('div');
    container.id = 'tabreminder-overlay';
    document.body.appendChild(container);
    root = createRoot(container);
  }

  root?.render(<NotesOverlay notes={notes} categories={categories} style={style} hasReminders={hasReminders} onClose={hideNote} />);
}

function hideNote() {
  if (root && container) {
    root.render(<></>);
  }
}

// Listen for messages from background script
browser.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as { type: string; note?: PageNote; notes?: PageNote[]; categories?: Category[]; overlayStyle?: OverlayStyle; hasReminders?: boolean };
  if (msg.type === 'SHOW_NOTE' && msg.note) {
    // Legacy single note
    showNotes([msg.note], msg.categories || [], msg.overlayStyle || defaultStyle, msg.hasReminders || false);
  } else if (msg.type === 'SHOW_NOTES' && msg.notes) {
    // Multiple notes
    showNotes(msg.notes, msg.categories || [], msg.overlayStyle || defaultStyle, msg.hasReminders || false);
  }
  return undefined;
});

console.log('TabReminder content script loaded');
