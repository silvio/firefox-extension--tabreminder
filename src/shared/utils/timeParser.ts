import * as chrono from 'chrono-node';
import { RecurringPattern, FrequencyType, EndCondition } from '../types';

export interface ParsedTime {
  timestamp: number;
  isRecurring: boolean;
  recurringPattern: RecurringPattern | null;
  displayText: string;
}

const RELATIVE_TIME_REGEX = /^now\s*\+\s*(\d+)h(?:(\d+)m)?$/i;
const RELATIVE_TIME_REGEX_MINUTES = /^now\s*\+\s*(\d+)m$/i;

export function parseTimeInput(input: string): ParsedTime | null {
  const trimmed = input.trim().toLowerCase();

  // Handle "now + XhYm" format
  const relativeMatch = trimmed.match(RELATIVE_TIME_REGEX);
  if (relativeMatch) {
    const hours = parseInt(relativeMatch[1], 10);
    const minutes = parseInt(relativeMatch[2] || '0', 10);
    const timestamp = Date.now() + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
    return {
      timestamp,
      isRecurring: false,
      recurringPattern: null,
      displayText: `in ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`,
    };
  }

  // Handle "now + Xm" format
  const relativeMinutesMatch = trimmed.match(RELATIVE_TIME_REGEX_MINUTES);
  if (relativeMinutesMatch) {
    const minutes = parseInt(relativeMinutesMatch[1], 10);
    const timestamp = Date.now() + minutes * 60 * 1000;
    return {
      timestamp,
      isRecurring: false,
      recurringPattern: null,
      displayText: `in ${minutes}m`,
    };
  }

  // Handle recurring patterns
  const recurringResult = parseRecurringPattern(trimmed);
  if (recurringResult) {
    return recurringResult;
  }

  // Use chrono for natural language parsing
  const parsed = chrono.parseDate(input);
  if (parsed) {
    // Ensure future date
    let timestamp = parsed.getTime();
    if (timestamp < Date.now()) {
      // If time is in the past today, assume tomorrow
      timestamp += 24 * 60 * 60 * 1000;
    }
    return {
      timestamp,
      isRecurring: false,
      recurringPattern: null,
      displayText: formatDate(new Date(timestamp)),
    };
  }

  return null;
}

function parseRecurringPattern(input: string): ParsedTime | null {
  const dayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];

  // "every X seconds/minutes/hours/days/weeks/months"
  const intervalMatch = input.match(/^every\s+(\d+)\s+(seconds?|minutes?|hours?|days?|weeks?|months?)$/i);
  if (intervalMatch) {
    const interval = parseInt(intervalMatch[1], 10);
    const unit = intervalMatch[2].toLowerCase().replace(/s$/, '');
    const frequency = unitToFrequency(unit);
    const ms = getIntervalMs(interval, unit);
    const nextTrigger = Date.now() + ms;

    return {
      timestamp: nextTrigger,
      isRecurring: true,
      recurringPattern: {
        frequency,
        interval,
        endCondition: { type: 'never' },
      },
      displayText: `Every ${interval} ${unit}${interval > 1 ? 's' : ''}`,
    };
  }

  // "every day" or "daily"
  if (input === 'every day' || input === 'daily') {
    const nextTrigger = getNextDailyTrigger();
    return {
      timestamp: nextTrigger,
      isRecurring: true,
      recurringPattern: { frequency: 'daily', interval: 1, endCondition: { type: 'never' } },
      displayText: 'Every day',
    };
  }

  // "every monday", "every tuesday", etc.
  const everyDayMatch = input.match(/^every\s+(\w+)$/);
  if (everyDayMatch) {
    const dayName = everyDayMatch[1].toLowerCase();
    const dayIndex = dayNames.indexOf(dayName);
    if (dayIndex >= 0) {
      const nextTrigger = getNextWeekdayTrigger(dayIndex);
      return {
        timestamp: nextTrigger,
        isRecurring: true,
        recurringPattern: { frequency: 'weekly', interval: 1, weekdays: [dayIndex], endCondition: { type: 'never' } },
        displayText: `Every ${dayNames[dayIndex].charAt(0).toUpperCase() + dayNames[dayIndex].slice(1)}`,
      };
    }
  }

  // "next monday", "next tuesday", etc.
  const nextDayMatch = input.match(/^next\s+(\w+)$/);
  if (nextDayMatch) {
    const dayName = nextDayMatch[1].toLowerCase();
    const dayIndex = dayNames.indexOf(dayName);
    if (dayIndex >= 0) {
      const nextTrigger = getNextWeekdayTrigger(dayIndex);
      return {
        timestamp: nextTrigger,
        isRecurring: false,
        recurringPattern: null,
        displayText: formatDate(new Date(nextTrigger)),
      };
    }
  }

  return null;
}

function unitToFrequency(unit: string): FrequencyType {
  switch (unit) {
    case 'second':
    case 'minute':
    case 'hour':
    case 'day':
      return 'daily';
    case 'week':
      return 'weekly';
    case 'month':
      return 'monthly';
    default:
      return 'daily';
  }
}

export function getIntervalMs(interval: number, unit: string): number {
  switch (unit) {
    case 'second':
      return interval * 1000;
    case 'minute':
      return interval * 60 * 1000;
    case 'hour':
      return interval * 60 * 60 * 1000;
    case 'day':
      return interval * 24 * 60 * 60 * 1000;
    case 'week':
      return interval * 7 * 24 * 60 * 60 * 1000;
    case 'month':
      return interval * 30 * 24 * 60 * 60 * 1000;
    default:
      return interval * 60 * 60 * 1000;
  }
}

function getNextDailyTrigger(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function getNextWeekdayTrigger(dayOfWeek: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(9, 0, 0, 0);

  const currentDay = now.getDay();
  let daysUntil = dayOfWeek - currentDay;
  if (daysUntil <= 0) {
    daysUntil += 7;
  }

  next.setDate(next.getDate() + daysUntil);
  return next.getTime();
}

export function calculateNextTrigger(pattern: RecurringPattern, fromDate?: number): number {
  const baseDate = fromDate ? new Date(fromDate) : new Date();
  const hour = pattern.timeOfDay?.hour ?? 9;
  const minute = pattern.timeOfDay?.minute ?? 0;

  switch (pattern.frequency) {
    case 'seconds': {
      return baseDate.getTime() + pattern.interval * 1000;
    }
    case 'minutes': {
      return baseDate.getTime() + pattern.interval * 60 * 1000;
    }
    case 'hours': {
      return baseDate.getTime() + pattern.interval * 60 * 60 * 1000;
    }
    case 'daily': {
      const next = new Date(baseDate);
      next.setHours(hour, minute, 0, 0);
      next.setDate(next.getDate() + pattern.interval);
      return next.getTime();
    }
    case 'weekly': {
      if (pattern.weekdays && pattern.weekdays.length > 0) {
        const weekdays = [...pattern.weekdays].sort((a, b) => a - b);
        let nextOccurrence: number | null = null;

        for (const day of weekdays) {
          const candidate = new Date(baseDate);
          candidate.setHours(hour, minute, 0, 0);

          let daysUntil = day - baseDate.getDay();
          if (daysUntil < 0) {
            daysUntil += 7 * pattern.interval;
          }

          candidate.setDate(candidate.getDate() + daysUntil);
          if (candidate.getTime() <= baseDate.getTime()) {
            candidate.setDate(candidate.getDate() + 7 * pattern.interval);
          }

          if (nextOccurrence === null || candidate.getTime() < nextOccurrence) {
            nextOccurrence = candidate.getTime();
          }
        }

        if (nextOccurrence !== null) {
          return nextOccurrence;
        }
      }
      return getNextWeekdayTrigger(baseDate.getDay());
    }
    case 'monthly': {
      const next = new Date(baseDate);
      if (pattern.dayOfMonth) {
        const candidateCurrent = new Date(next);
        candidateCurrent.setDate(pattern.dayOfMonth);
        candidateCurrent.setHours(hour, minute, 0, 0);
        if (candidateCurrent.getTime() > baseDate.getTime()) {
          return candidateCurrent.getTime();
        }
      } else if (pattern.weekdayOrdinal) {
        const candidateCurrent = getNthWeekdayOfMonth(
          next.getFullYear(),
          next.getMonth(),
          pattern.weekdayOrdinal.weekday,
          pattern.weekdayOrdinal.ordinal
        );
        candidateCurrent.setHours(hour, minute, 0, 0);
        if (candidateCurrent.getTime() > baseDate.getTime()) {
          return candidateCurrent.getTime();
        }
        next.setMonth(next.getMonth() + pattern.interval);
        const targetDate = getNthWeekdayOfMonth(
          next.getFullYear(),
          next.getMonth(),
          pattern.weekdayOrdinal.weekday,
          pattern.weekdayOrdinal.ordinal
        );
        targetDate.setHours(hour, minute, 0, 0);
        return targetDate.getTime();
      }
      next.setHours(hour, minute, 0, 0);
      next.setMonth(next.getMonth() + pattern.interval);
      if (pattern.dayOfMonth) {
        next.setDate(pattern.dayOfMonth);
      }
      return next.getTime();
    }
    case 'yearly': {
      const next = new Date(baseDate);
      next.setHours(hour, minute, 0, 0);
      next.setFullYear(next.getFullYear() + pattern.interval);
      return next.getTime();
    }
    default:
      return Date.now() + 24 * 60 * 60 * 1000;
  }
}

function getNthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): Date {
  if (ordinal === 5) {
    const lastDay = new Date(year, month + 1, 0);
    const dayOffset = (lastDay.getDay() - weekday + 7) % 7;
    const targetDay = lastDay.getDate() - dayOffset;
    return new Date(year, month, targetDay, 9, 0, 0, 0);
  }
  const firstDay = new Date(year, month, 1);
  let dayOffset = weekday - firstDay.getDay();
  if (dayOffset < 0) dayOffset += 7;
  const targetDay = 1 + dayOffset + (ordinal - 1) * 7;
  return new Date(year, month, targetDay, 9, 0, 0, 0);
}

export function formatDate(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const timeStr = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isTomorrow) {
    return `Tomorrow at ${timeStr}`;
  }

  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateWithYear(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;

  if (diff < 0) {
    return 'Overdue';
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `in ${days}d`;
  }
  if (hours > 0) {
    return `in ${hours}h`;
  }
  if (minutes > 0) {
    return `in ${minutes}m`;
  }
  return 'Soon';
}

export function getNextOccurrences(pattern: RecurringPattern, count: number = 5): number[] {
  const occurrences: number[] = [];
  let current = calculateNextTrigger(pattern);

  for (let i = 0; i < count; i++) {
    // Check end condition
    if (pattern.endCondition.type === 'date' && current > pattern.endCondition.endDate) break;
    if (pattern.endCondition.type === 'count' && i >= pattern.endCondition.occurrences) break;

    // Check exceptions
    if (!pattern.exceptions || !pattern.exceptions.some((exc) => isSameDay(exc, current))) {
      occurrences.push(current);
    }

    current = calculateNextTrigger(pattern, current);
  }

  return occurrences;
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.toDateString() === d2.toDateString();
}

export function describeRecurringPattern(pattern: RecurringPattern): string {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let description = 'Every ';

  if (pattern.interval > 1) {
    description += `${pattern.interval} `;
  }

  switch (pattern.frequency) {
    case 'seconds':
      description += pattern.interval > 1 ? 'seconds' : 'second';
      break;
    case 'minutes':
      description += pattern.interval > 1 ? 'minutes' : 'minute';
      break;
    case 'hours':
      description += pattern.interval > 1 ? 'hours' : 'hour';
      break;
    case 'daily':
      description += pattern.interval > 1 ? 'days' : 'day';
      break;
    case 'weekly':
      description += pattern.interval > 1 ? 'weeks' : 'week';
      if (pattern.weekdays && pattern.weekdays.length > 0) {
        const days = pattern.weekdays.map((d) => dayNames[d]).join(', ');
        description += ` on ${days}`;
      }
      break;
    case 'monthly':
      description += pattern.interval > 1 ? 'months' : 'month';
      if (pattern.dayOfMonth) {
        description += ` on day ${pattern.dayOfMonth}`;
      } else if (pattern.weekdayOrdinal) {
        const ordinals = ['1st', '2nd', '3rd', '4th', 'last'];
        description += ` on the ${ordinals[pattern.weekdayOrdinal.ordinal - 1]} ${dayNames[pattern.weekdayOrdinal.weekday]}`;
      }
      break;
    case 'yearly':
      description += pattern.interval > 1 ? 'years' : 'year';
      break;
  }

  // End condition
  if (pattern.endCondition.type === 'date') {
    description += ` until ${formatDate(new Date(pattern.endCondition.endDate))}`;
  } else if (pattern.endCondition.type === 'count') {
    description += ` for ${pattern.endCondition.occurrences} occurrences`;
  }

  return description;
}
