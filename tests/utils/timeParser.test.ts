import {
  parseTimeInput,
  formatRelativeTime,
  calculateNextTrigger,
  getNextOccurrences,
} from '../../src/shared/utils/timeParser';
import { RecurringPattern } from '../../src/shared/types';

describe('timeParser', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('parseTimeInput', () => {
    it('should parse "now + Xh" format', () => {
      const result = parseTimeInput('now + 2h');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(false);

      const expectedTime = Date.now() + 2 * 60 * 60 * 1000;
      expect(Math.abs(result!.timestamp - expectedTime)).toBeLessThan(1000);
    });

    it('should parse "now + XhYm" format', () => {
      const result = parseTimeInput('now + 1h30m');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(false);

      const expectedTime = Date.now() + 1.5 * 60 * 60 * 1000;
      expect(Math.abs(result!.timestamp - expectedTime)).toBeLessThan(1000);
    });

    it('should parse "now + Xm" format', () => {
      const result = parseTimeInput('now + 30m');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(false);

      const expectedTime = Date.now() + 30 * 60 * 1000;
      expect(Math.abs(result!.timestamp - expectedTime)).toBeLessThan(1000);
    });

    it('should parse "every monday" as recurring', () => {
      const result = parseTimeInput('every monday');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(true);
      expect(result!.recurringPattern).toEqual({ frequency: 'weekly', interval: 1, weekdays: [1], endCondition: { type: 'never' } });
    });

    it('should parse "every day" as recurring', () => {
      const result = parseTimeInput('every day');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(true);
      expect(result!.recurringPattern).toEqual({ frequency: 'daily', interval: 1, endCondition: { type: 'never' } });
    });

    it('should parse "daily" as recurring', () => {
      const result = parseTimeInput('daily');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(true);
      expect(result!.recurringPattern).toEqual({ frequency: 'daily', interval: 1, endCondition: { type: 'never' } });
    });

    it('should parse "next monday" as one-time', () => {
      const result = parseTimeInput('next monday');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(false);
      expect(result!.timestamp).toBeGreaterThan(Date.now());
    });

    it('should parse natural language like "tomorrow 9am"', () => {
      const result = parseTimeInput('tomorrow 9am');
      expect(result).not.toBeNull();
      expect(result!.isRecurring).toBe(false);
      expect(result!.timestamp).toBeGreaterThan(Date.now());
    });

    it('should return null for invalid input', () => {
      const result = parseTimeInput('invalid time string xyz');
      expect(result).toBeNull();
    });
  });

  describe('formatRelativeTime', () => {
    it('should format future time in days', () => {
      const futureTime = Date.now() + (2 * 24 * 60 * 60 * 1000) + (60 * 60 * 1000);
      expect(formatRelativeTime(futureTime)).toBe('in 2d');
    });

    it('should format future time in hours', () => {
      const futureTime = Date.now() + 3 * 60 * 60 * 1000;
      expect(formatRelativeTime(futureTime)).toBe('in 3h');
    });

    it('should format future time in minutes', () => {
      const futureTime = Date.now() + 45 * 60 * 1000;
      expect(formatRelativeTime(futureTime)).toBe('in 45m');
    });

    it('should show "Overdue" for past time', () => {
      const pastTime = Date.now() - 1000;
      expect(formatRelativeTime(pastTime)).toBe('Overdue');
    });
  });

  describe('calculateNextTrigger', () => {
    it('should calculate next daily trigger', () => {
      const result = calculateNextTrigger({ frequency: 'daily', interval: 1, endCondition: { type: 'never' } });
      expect(result).toBeGreaterThan(Date.now());
    });

    it('should calculate next weekly trigger', () => {
      const result = calculateNextTrigger({ frequency: 'weekly', interval: 1, weekdays: [1], endCondition: { type: 'never' } });
      expect(result).toBeGreaterThan(Date.now());

      const resultDate = new Date(result);
      expect(resultDate.getDay()).toBe(1); // Monday
    });

    it('should calculate next monthly trigger', () => {
      const result = calculateNextTrigger({ frequency: 'monthly', interval: 1, dayOfMonth: 15, endCondition: { type: 'never' } });
      expect(result).toBeGreaterThan(Date.now());

      const resultDate = new Date(result);
      expect(resultDate.getDate()).toBe(15);
    });

    it('last Friday of April 2026 should be April 24, not May 1', () => {
      // April 2026: 1st=Wed, last Friday=24
      // baseDate: 2026-04-01T00:00:00 — well before April 24
      const baseDate = new Date(2026, 3, 1, 0, 0, 0, 0).getTime(); // April 1
      const result = calculateNextTrigger(
        { frequency: 'monthly', interval: 1, weekdayOrdinal: { weekday: 5, ordinal: 5 }, endCondition: { type: 'never' } },
        baseDate
      );
      const resultDate = new Date(result);
      expect(resultDate.getMonth()).toBe(3); // April (0-indexed)
      expect(resultDate.getDate()).toBe(24);
    });

    it('last Friday of April 2026 when base is after April 24 should return last Friday of May 2026', () => {
      // May 2026: last Friday = May 29
      const baseDate = new Date(2026, 3, 25, 0, 0, 0, 0).getTime(); // April 25 (past April 24)
      const result = calculateNextTrigger(
        { frequency: 'monthly', interval: 1, weekdayOrdinal: { weekday: 5, ordinal: 5 }, endCondition: { type: 'never' } },
        baseDate
      );
      const resultDate = new Date(result);
      expect(resultDate.getMonth()).toBe(4); // May
      expect(resultDate.getDate()).toBe(29);
    });

    it('should not skip current month occurrence when weekdayOrdinal date is in the future', () => {
      // 2nd Tuesday of March 2026 = March 10
      const baseDate = new Date(2026, 2, 1, 0, 0, 0, 0).getTime(); // March 1
      const result = calculateNextTrigger(
        { frequency: 'monthly', interval: 1, weekdayOrdinal: { weekday: 2, ordinal: 2 }, endCondition: { type: 'never' } },
        baseDate
      );
      const resultDate = new Date(result);
      expect(resultDate.getMonth()).toBe(2); // March
      expect(resultDate.getDate()).toBe(10);
    });
  });

  describe('getNextOccurrences', () => {
    type ExpectedOccurrence = [number, number, number, number, number];

    function expectOccurrencesToMatch(occurrences: number[], expected: Array<[number, number, number, number, number]>) {
      expect(occurrences).toHaveLength(expected.length);

      expected.forEach(([year, month, day, hour, minute], index) => {
        const occurrence = new Date(occurrences[index]);
        expect(occurrence.getFullYear()).toBe(year);
        expect(occurrence.getMonth()).toBe(month);
        expect(occurrence.getDate()).toBe(day);
        expect(occurrence.getHours()).toBe(hour);
        expect(occurrence.getMinutes()).toBe(minute);
      });
    }

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2026, 3, 1, 10, 0, 0, 0));
    });

    it('shows distinct weekly preview entries for multiple weekdays', () => {
      const occurrences = getNextOccurrences(
        {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1, 3],
          endCondition: { type: 'never' },
          timeOfDay: { hour: 9, minute: 0 },
        },
        5
      );

      expectOccurrencesToMatch(occurrences, [
        [2026, 3, 6, 9, 0],
        [2026, 3, 8, 9, 0],
        [2026, 3, 13, 9, 0],
        [2026, 3, 15, 9, 0],
        [2026, 3, 20, 9, 0],
      ]);
    });

    const previewCases: Array<[string, RecurringPattern, number, ExpectedOccurrence[]]> = [
      [
        'daily recurrence',
        {
          frequency: 'daily',
          interval: 1,
          endCondition: { type: 'never' as const },
          timeOfDay: { hour: 9, minute: 0 },
        },
        3,
        [
          [2026, 3, 2, 9, 0],
          [2026, 3, 3, 9, 0],
          [2026, 3, 4, 9, 0],
        ],
      ],
      [
        'weekly single weekday recurrence',
        {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1],
          endCondition: { type: 'never' as const },
          timeOfDay: { hour: 9, minute: 0 },
        },
        3,
        [
          [2026, 3, 6, 9, 0],
          [2026, 3, 13, 9, 0],
          [2026, 3, 20, 9, 0],
        ],
      ],
      [
        'weekly multi-weekday recurrence every two weeks',
        {
          frequency: 'weekly',
          interval: 2,
          weekdays: [1, 3],
          endCondition: { type: 'never' as const },
          timeOfDay: { hour: 9, minute: 0 },
        },
        4,
        [
          [2026, 3, 13, 9, 0],
          [2026, 3, 15, 9, 0],
          [2026, 3, 27, 9, 0],
          [2026, 3, 29, 9, 0],
        ],
      ],
      [
        'monthly day-of-month recurrence',
        {
          frequency: 'monthly',
          interval: 1,
          dayOfMonth: 15,
          endCondition: { type: 'never' as const },
          timeOfDay: { hour: 9, minute: 0 },
        },
        3,
        [
          [2026, 3, 15, 9, 0],
          [2026, 4, 15, 9, 0],
          [2026, 5, 15, 9, 0],
        ],
      ],
      [
        'monthly weekday-ordinal recurrence',
        {
          frequency: 'monthly',
          interval: 1,
          weekdayOrdinal: { weekday: 2, ordinal: 2 },
          endCondition: { type: 'never' as const },
          timeOfDay: { hour: 9, minute: 0 },
        },
        3,
        [
          [2026, 3, 14, 9, 0],
          [2026, 4, 12, 9, 0],
          [2026, 5, 9, 9, 0],
        ],
      ],
      [
        'yearly recurrence',
        {
          frequency: 'yearly',
          interval: 1,
          endCondition: { type: 'never' as const },
          timeOfDay: { hour: 9, minute: 0 },
        },
        3,
        [
          [2027, 3, 1, 9, 0],
          [2028, 3, 1, 9, 0],
          [2029, 3, 1, 9, 0],
        ],
      ],
    ];

    it.each(previewCases)('returns the expected preview sequence for %s', (_label, pattern, count, expected) => {
      const occurrences = getNextOccurrences(pattern, count);
      expectOccurrencesToMatch(occurrences, expected);
    });

    it('stops at the configured end date', () => {
      const occurrences = getNextOccurrences(
        {
          frequency: 'daily',
          interval: 1,
          endCondition: { type: 'date', endDate: new Date(2026, 3, 3, 9, 0, 0, 0).getTime() },
          timeOfDay: { hour: 9, minute: 0 },
        },
        5
      );

      expectOccurrencesToMatch(occurrences, [
        [2026, 3, 2, 9, 0],
        [2026, 3, 3, 9, 0],
      ]);
    });

    it('stops at the configured occurrence count', () => {
      const occurrences = getNextOccurrences(
        {
          frequency: 'weekly',
          interval: 1,
          weekdays: [1, 3],
          endCondition: { type: 'count', occurrences: 3 },
          timeOfDay: { hour: 9, minute: 0 },
        },
        5
      );

      expectOccurrencesToMatch(occurrences, [
        [2026, 3, 6, 9, 0],
        [2026, 3, 8, 9, 0],
        [2026, 3, 13, 9, 0],
      ]);
    });
  });
});
