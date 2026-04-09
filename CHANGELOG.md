# Project Changelog

## [1.3.12] - 2026-04-09
### Changed
- Added an `Unreleased` release bucket and repository-local commit guidance so each logical step is committed separately with its matching `CHANGELOG.md` entry.
- Updated `sync-main.sh` to create branch releases automatically by bumping the patch version, tagging `copilot-v...`, importing the release to `main`, and restoring an empty `Unreleased` section on the source branch while keeping unrelated untracked files out of import commits.

### Fixed
- Prevented unsafe WebDAV overwrites from empty never-synced local categories and fixed remote category deletion to target the canonical ID-based JSON filename.
- Restricted overlay markdown links and images to `http`/`https`, rendering unsafe URLs as inert text.
- Synced both the old and new category files when mobile note edits move a note between categories.
- Rebuilt reminder alarms and refreshed the badge immediately after note imports while clearing stale reminder alarms first.
- Persisted `recurringPreviewCount` in synced settings so the preview count survives reloads.

## [1.3.11] - 2026-04-01
### Fixed
- Fixed recurring preview generation so weekly reminders with multiple weekdays show the next distinct occurrences instead of repeating the same date.

## [1.3.10] - 2026-03-30
### Fixed
- Added `browser_specific_settings.gecko.data_collection_permissions.required = ["none"]` to satisfy AMO validation requirements.
