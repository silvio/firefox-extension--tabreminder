import {
  parseTimeInput,
  formatRelativeTime,
  calculateNextTrigger,
} from '../../src/shared/utils/timeParser';

describe('timeParser', () => {
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
});
