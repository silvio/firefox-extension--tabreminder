# TabReminder

A Firefox extension to remind yourself with notes when revisiting pages and
schedule time-based reminders.

This is a vibe coded experiment with GitHub copilot. Even so, I still use it
every day at work and in my private life.


## Features

### Page Notes
- Create notes for any webpage
- Notes are displayed automatically when you revisit the page
- Flexible URL matching: exact URL, path only, or entire domain
- Categorize notes (Work, Personal, Shopping, etc.)
- Filter notes by category

### Time Reminders
- Schedule reminders for pages
- Natural language time input:
  - "tomorrow 9am"
  - "next monday"
  - "in 2 hours" (`now + 2h`)
  - "every monday" (recurring)
  - "daily"
- System notifications when reminders are due
- Recurring reminders support

### Sync & Settings
- Sync data across devices with Firefox Account (optional)
- Configurable notifications (system, overlay, badge)
- Export/import data for backup


## Usage

### Popup
Click the toolbar icon to:
- Add/edit notes for the current page
- Create time reminders
- View all your notes and reminders

### Sidebar
Open the sidebar (View > Sidebar > TabReminder) for:
- Full notes management
- Reminders overview
- Category management

### Time Input Examples
- `tomorrow` - Tomorrow at 9 AM
- `tomorrow 2pm` - Tomorrow at 2 PM
- `next friday` - Next Friday at 9 AM
- `now + 30m` - 30 minutes from now
- `now + 2h` - 2 hours from now
- `now + 1h30m` - 1 hour 30 minutes from now
- `every monday` - Every Monday at 9 AM (recurring)
- `every day` or `daily` - Every day at 9 AM (recurring)


# Development

## Quick Start

```bash
git clone <repository>
cd firefox-extension--tabreminder
npm install          # One-time setup
npm run build        # Build desktop version
```

For complete setup instructions, development workflow, testing guides, and Android development, see **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Requirements

- Node.js >= 18
- npm >= 8
- make, bash, git

## Build Commands

```bash
npm run build          # Desktop version → dist/
npm run build:android  # Android version → dist-android/
npm run dev            # Watch mode for development
npm test               # Run tests
```

## Distribution Packages

```bash
make package           # Desktop: tabreminder-v<version>.zip
make package-android   # Android: tabreminder-android-v<version>.zip
```

For detailed information, see [CONTRIBUTING.md](CONTRIBUTING.md).

