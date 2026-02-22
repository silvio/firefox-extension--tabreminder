# TabReminder

A Firefox extension to remind yourself with notes when revisiting pages and
schedule time-based reminders.

**Works on both Firefox Desktop (91.0+) and Firefox for Android (120.0+)**

This is a vibe coded experiment with GitHub copilot. Even so, I still use it
every day at work and in my private life.


## Features

### Page Notes
- Create notes for any webpage
- Notes are displayed automatically when you revisit the page
- Flexible URL matching: exact URL, path only, or entire domain
- Categorize notes (Work, Personal, Shopping, etc.)
- Filter notes by category
- Available on both desktop and Android

### Time Reminders
- Schedule reminders for pages
- Natural language time input:
  - "tomorrow 9am"
  - "next monday"
  - "in 2 hours" (`now + 2h`)
  - "every monday" (recurring)
  - "daily"
- System notifications when reminders are due (desktop only)
- Recurring reminders support
- **Note**: Time-based reminders with alarms/notifications are only available on Firefox Desktop. Android users can use WebDAV sync for reminder notes across devices.

### Sync & Settings
- WebDAV sync support for cross-device synchronization
- Configurable notifications (system, overlay, badge)
- Export/import data for backup


## Usage

### Desktop
Click the toolbar icon to open the popup:
- Add/edit notes for the current page
- Create time reminders
- View all your notes and reminders

### Android
Tap the extension icon to open the mobile page:
- Add/edit notes for the current page
- View all notes organized by category
- Access full settings and sync configuration

### Time Input Examples
- `tomorrow` - Tomorrow at 9 AM
- `tomorrow 2pm` - Tomorrow at 2 PM
- `next friday` - Next Friday at 9 AM
- `now + 30m` - 30 minutes from now
- `now + 2h` - 2 hours from now
- `now + 1h30m` - 1 hour 30 minutes from now
- `every monday` - Every Monday at 9 AM (recurring)
- `every day` or `daily` - Every day at 9 AM (recurring)


## Platform Compatibility

This extension is built as a **universal package** that works on both platforms:

| Feature | Desktop (91.0+) | Android (120.0+) |
|---------|-----------------|------------------|
| Page Notes | ✅ Yes | ✅ Yes |
| Categories | ✅ Yes | ✅ Yes |
| WebDAV Sync | ✅ Yes | ✅ Yes |
| Time Reminders | ✅ Yes | ⚠️ Limited* |
| System Notifications | ✅ Yes | ❌ No |
| Alarms API | ✅ Yes | ❌ No |

*Android: Time-based reminders can be created and synced via WebDAV, but won't trigger local notifications. Use WebDAV sync to access reminders across devices.


# Development

## Quick Start

```bash
git clone <repository>
cd firefox-extension--tabreminder
npm install          # One-time setup
npm run build        # Build universal package
```

For complete setup instructions, development workflow, testing guides, and platform-specific details, see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Requirements

- Node.js >= 18
- npm >= 8
- make, bash, git

## Build Commands

```bash
npm run build          # Universal package → dist/
npm run dev            # Watch mode for development
npm test               # Run tests
```

## Distribution Packages

```bash
make build             # Build universal package
make package           # Create development package (with .gitidentity)
make mozilla-package   # Create Mozilla submission package (clean)
./build.sh             # Complete build script
```

**Note**: The universal package includes both desktop and mobile interfaces. Firefox automatically uses the appropriate UI based on the platform.

For detailed information, see [CONTRIBUTING.md](CONTRIBUTING.md).

