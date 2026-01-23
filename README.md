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

Environment:

- tested on (arch-) linux, with:
  - npm-version: 11.7.0
  - node-version: v22.22.0
  - make-version: 4.4.1
  - bash-version: 5.3.9-1

- installed:
  - `make`
  - `npm`
  - `node`
  - `bash`

# How to build?

- build and package: `./build.sh`
- for firefox package: `make mozilla-package`
- to build: `make build`
- setup build environment: `make install`

