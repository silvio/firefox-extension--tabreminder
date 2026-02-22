import { v4 as uuidv4 } from 'uuid';
import { PageNote, TimeReminder, UrlMatchType } from '../types';

export function createNote(
  url: string,
  title: string,
  content: string,
  urlMatchType: UrlMatchType = 'exact',
  categoryId: string | null = null
): PageNote {
  const now = Date.now();
  return {
    id: uuidv4(),
    url,
    urlMatchType,
    title,
    content,
    categoryId,
    createdAt: now,
    updatedAt: now,
  };
}

export function createReminder(
  url: string,
  title: string,
  nextTrigger: number,
  categoryId: string | null = null
): TimeReminder {
  return {
    id: uuidv4(),
    url,
    title,
    scheduleType: 'once',
    scheduledTime: nextTrigger,
    recurringPattern: null,
    nextTrigger,
    categoryId,
    createdAt: Date.now(),
  };
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return url;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function extractPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

export function getUrlMatchPreview(url: string, matchType: UrlMatchType): string {
  try {
    if (matchType === 'regex') {
      // For regex, just return the pattern (url is already a pattern string)
      return `Pattern: ${url}`;
    }
    const parsed = new URL(url);
    switch (matchType) {
      case 'exact':
        return parsed.href;
      case 'path':
        return parsed.origin + parsed.pathname;
      case 'domain':
        return parsed.hostname;
      default:
        return url;
    }
  } catch {
    return url;
  }
}
