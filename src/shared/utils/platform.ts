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
 * Check if alarms API is available (runtime check for optional permission)
 */
export function hasAlarmSupport(): boolean {
  return typeof browser !== 'undefined' && 
         typeof browser.alarms !== 'undefined';
}

/**
 * Check if background sync should be enabled
 */
export function hasBackgroundSync(): boolean {
  return !isAndroid();
}

/**
 * Check if notifications API is available (runtime check for optional permission)
 */
export function hasNotificationSupport(): boolean {
  return typeof browser !== 'undefined' && 
         typeof browser.notifications !== 'undefined';
}

/**
 * Get current platform
 */
export function getPlatform(): Platform {
  return isAndroid() ? 'android' : 'desktop';
}
