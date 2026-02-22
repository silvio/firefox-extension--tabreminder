# Mozilla AMO Submission Guide

## Universal Package Approach

TabReminder is built as a **universal package** that works on both Firefox Desktop (91.0+) and Firefox for Android (120.0+). This means:

- **One extension listing** on addons.mozilla.org (AMO)
- **One XPI file** submitted to AMO
- **Automatic platform detection** by Firefox
- Users install the same package regardless of platform

## How It Works

The extension uses:

1. **Universal manifest.json** with both `gecko` and `gecko_android` sections
2. **Optional permissions** for platform-specific APIs (alarms, notifications)
3. **Runtime feature detection** to gracefully handle missing APIs
4. **Both popup and mobile UIs** included in the same package
   - Desktop: Uses popup interface
   - Android: Uses mobile page interface

## Submission Process

### 1. Create the Package

```bash
# Build and create Mozilla submission package
./build.sh

# Or manually:
make mozilla-package
```

This creates: `tabreminder-v<version>.zip`

### 2. Upload to AMO

1. Go to https://addons.mozilla.org/developers/
2. Navigate to your extension or "Submit a New Add-on"
3. Upload `tabreminder-v<version>.zip`
4. **Select platforms**: Check both "Desktop" and "Android"
5. Fill in version notes describing:
   - What's new in this version
   - Note about platform compatibility
   - Any platform-specific limitations

### 3. Example Version Notes

```
Version 1.2.13 - Universal Package

This version now supports both Firefox Desktop (91.0+) and Firefox for Android (120.0+) 
from a single installation.

Features:
- Page notes and categories work on both platforms
- WebDAV sync works on both platforms
- Time-based reminders with system notifications (Desktop only)
- Mobile-optimized interface for Android

Platform Notes:
- Desktop: Full feature set including alarms and system notifications
- Android: Page notes, categories, and WebDAV sync. Time-based reminders 
  can be synced but won't trigger local notifications (alarms API not 
  supported on Android Firefox).

Bug fixes and improvements...
```

### 4. Source Code (if requested)

Mozilla may request source code for review. Use:

```bash
make sourcecode-package
```

This creates: `tabreminder-source-v<version>.tar.gz`

Upload this package if Mozilla requests source code verification.

## Manifest Details

The universal manifest includes:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "strict_min_version": "91.0"
    },
    "gecko_android": {
      "strict_min_version": "120.0"
    }
  },
  "permissions": [
    "storage",
    "tabs",
    "activeTab",
    "<all_urls>"
  ]
}
```

**Key points:**
- `gecko`: Desktop Firefox minimum version (91.0 for wide compatibility)
- `gecko_android`: Android Firefox minimum version (120.0)
- **No `optional_permissions`**: Android Firefox doesn't support `alarms` even as optional
- Feature detection in code checks API availability at runtime
- APIs are `undefined` on platforms that don't support them (graceful degradation)

## Testing Before Submission

### Desktop Testing
```bash
npm run test:desktop
# Or manually: cd dist && web-ext run --firefox=firefox
```

### Android Testing
```bash
npm run test:android
# Or manually: cd dist && web-ext run --target=firefox-android
```

## Common Questions

### Q: Why one package instead of two separate extensions?
**A:** Mozilla's AMO doesn't support uploading different builds for the same extension listing. The universal package approach gives users a single installation point while maintaining platform compatibility.

### Q: Will desktop users see Android-specific UI?
**A:** No. Firefox automatically uses the appropriate UI (popup for desktop, mobile page for Android via browserAction.onClicked).

### Q: What happens to alarms on Android?
**A:** The code checks for API availability at runtime. On Android, alarm scheduling is silently skipped with no errors. Users can still create time-based reminders and sync them via WebDAV to desktop devices where they'll trigger.

### Q: Can I update the extension later?
**A:** Yes! Simply build a new version, increment the version number, and upload to AMO. Users on both platforms will receive the update automatically.

## Version Bumping

Before creating a new release:

```bash
# Bump patch version (1.2.13 → 1.2.14)
make bump-version-number-bugfixlevel

# Bump minor version (1.2.13 → 1.3.0)
make bump-version-number-minor

# Bump major version (1.2.13 → 2.0.0)
make bump-version-number-major
```

This updates version in:
- `package.json`
- `public/manifest.json`

Then rebuild and create submission package.

## Support

If Mozilla reviewers have questions about the universal package approach:
- Point to this documentation
- Explain the optional_permissions + feature detection strategy
- Reference Mozilla's official WebExtension cross-platform guidelines
- Offer to provide additional technical details if needed
