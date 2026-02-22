// Platform detection utilities
import browser from 'webextension-polyfill';

export type Platform = 'desktop' | 'android';

/**
 * Detect if running on Android Firefox
 */
export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/**
 * Check if alarms API is supported
 */
export function hasAlarmSupport(): boolean {
  return typeof browser !== 'undefined' && 
         typeof browser.alarms !== 'undefined' && 
         !isAndroid();
}

/**
 * Check if background sync should be enabled
 */
export function hasBackgroundSync(): boolean {
  return !isAndroid();
}

/**
 * Check if notifications API is fully supported
 */
export function hasNotificationSupport(): boolean {
  return typeof browser !== 'undefined' && 
         typeof browser.notifications !== 'undefined' && 
         !isAndroid();
}

/**
 * Get current platform
 */
export function getPlatform(): Platform {
  return isAndroid() ? 'android' : 'desktop';
}
