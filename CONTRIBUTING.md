# Contributing to TabReminder

Thank you for your interest in contributing to TabReminder! This guide will help you set up your development environment and understand the project workflow.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Building the Extension](#building-the-extension)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Required (One-Time System Setup)

You'll need these installed on your system:

- **Node.js** >= 18.0.0 (tested with v22.22.0)
- **npm** >= 8.0.0 (tested with v11.7.0)
- **make** (tested with v4.4.1)
- **bash** (tested with v5.3.9)
- **git**

Check your versions:
```bash
node --version   # Should be >= 18
npm --version    # Should be >= 8
make --version
git --version
```

**Note:** `web-ext` (for testing) is automatically installed when you run `npm install`.

### Optional (For Android Testing)

Only needed if you want to test on Android devices:

- **adb** (Android Debug Bridge) - Install with: `sudo apt install android-tools-adb` on Linux

## Initial Setup

### One-Time Setup (Per Project Checkout)

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd firefox-extension--tabreminder
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```
   
   This installs all required packages from `package.json`. This is a **one-time step** per checkout.

3. **Verify setup:**
   ```bash
   npm run build
   ```
   
   If successful, you'll see `dist/` directory with the built extension.

That's it! You're ready to develop.

## Building the Extension

TabReminder supports two platforms: **Desktop** (Firefox desktop) and **Android** (Firefox for Android).

### Desktop Version (Default)

```bash
# Build production version
npm run build
# or
npm run build:desktop
# or
make build-desktop
```

Output: `dist/` directory

### Android Version

```bash
# Build Android version
npm run build:android
# or
make build-android
```

Output: `dist-android/` directory

### Build Both Platforms

```bash
npm run build:all
# or
make build-all
```

### Create Distribution Packages

```bash
# Desktop package
make package
# Output: tabreminder-v<version>.zip

# Android package
make package-android
# Output: tabreminder-android-v<version>.zip

# Both packages
make package-all
```

## Development Workflow

### Watch Mode (Recommended for Development)

Auto-rebuild on file changes:

```bash
# Desktop version (default)
npm run dev

# Android version
npm run dev:android
```

Keep this running in a terminal while you develop. It will automatically rebuild when you save files.

### Manual Build Cycle

```bash
# 1. Make changes to source files in src/
# 2. Build
npm run build

# 3. Test in Firefox
make test
# or manually: load dist/ in about:debugging

# 4. Run tests
npm test
```

## Testing

### Unit Tests

```bash
# Run all tests
npm test

# Watch mode (re-runs on changes)
npm run test:watch

# Coverage report
npm run test:coverage
```

### Testing in Firefox Desktop

**Option 1: Using npm script (Recommended)**
```bash
# Build and test in one step
npm run build:desktop
npm run test:desktop
```

**Option 2: Using make**
```bash
make test
```

**Option 3: Manual loading**
1. Open Firefox
2. Navigate to `about:debugging`
3. Click "This Firefox" → "Load Temporary Add-on"
4. Select any file from `dist/` directory

### Testing on Android

See [docs/android-testing.md](docs/android-testing.md) for complete Android testing setup.

**Quick version (requires adb and Android device):**
```bash
# 1. Setup Android device with USB debugging
# 2. Install Firefox Nightly on Android
# 3. Connect device via USB

# Build and test
npm run build:android
npm run test:android
```

The `test:android` script will automatically deploy to your connected device.

### Linting

```bash
# Validate extension manifest
npm run lint:ext
# or
make lint
```

## Project Structure

```
firefox-extension--tabreminder/
├── src/                      # Source code
│   ├── background/          # Background script (alarms, sync)
│   ├── content/             # Content script (page overlays)
│   ├── options/             # Settings/preferences page
│   ├── popup/               # Desktop popup UI
│   ├── mobile/              # Android mobile page UI
│   └── shared/              # Shared utilities and services
│       ├── services/        # Storage, WebDAV, sync logic
│       └── utils/           # Platform detection, helpers
├── public/                   # Static assets
│   ├── manifest.json        # Desktop manifest
│   ├── manifest.android.json # Android manifest
│   ├── icons/               # Extension icons
│   └── *.html              # HTML templates
├── _locales/                # Internationalization
├── dist/                    # Desktop build output (gitignored)
├── dist-android/            # Android build output (gitignored)
├── docs/                    # Documentation (gitignored)
├── tests/                   # Unit tests
├── webpack.config.js        # Build configuration
├── Makefile                 # Build automation
└── package.json            # Dependencies and scripts
```

## Making Changes

### Standard Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** in `src/`

3. **Build and test:**
   ```bash
   npm run build
   make test
   npm test
   ```

4. **Verify both platforms** (if your changes affect both):
   ```bash
   npm run build:all
   ```

5. **Commit your changes:**
   ```bash
   git add .
   git commit -m "feat: description of your changes"
   ```

6. **Push and create PR** (if contributing to upstream)

### Platform-Specific Development

**Desktop-only changes:**
- Popup UI: `src/popup/`
- Alarms/reminders: `src/background/index.ts` (wrapped in `hasAlarmSupport()`)

**Android-only changes:**
- Mobile UI: `src/mobile/`
- Manifest: `public/manifest.android.json`

**Shared changes:**
- Storage logic: `src/shared/services/storage.ts`
- WebDAV sync: `src/shared/services/storage.ts`
- Platform detection: `src/shared/utils/platform.ts`

### Code Style

- Use TypeScript for type safety
- Follow existing code formatting
- Empty lines should not have spaces
- Python files: disable 80-character line length warnings (if applicable)

## Troubleshooting

### Build Issues

**Problem:** Build fails with module errors
```bash
# Solution: Clean and reinstall
rm -rf node_modules package-lock.json
npm install
```

**Problem:** Webpack errors
```bash
# Solution: Clean build directories
make clean
npm run build
```

### Development Issues

**Problem:** Changes not showing up
- Solution: Make sure you're running `npm run dev` (watch mode)
- Or: Rebuild with `npm run build`
- In Firefox: Reload the extension in `about:debugging`

**Problem:** TypeScript errors
```bash
# Check for type errors
npx tsc --noEmit
```

### Testing Issues

**Problem:** Tests failing
```bash
# Run tests with verbose output
npm test -- --verbose

# Run specific test file
npm test -- path/to/test.spec.ts
```

**Problem:** Extension won't load in Firefox
- Check `dist/manifest.json` exists
- Verify no syntax errors in manifest
- Check browser console for errors

### Version Management

**Problem:** Version mismatch between package.json and manifest
```bash
# Check versions
make check-version

# Update version (example for bug fix)
make bump-version-number-bugfixlevel
```

### Node.js Version Issues

**Problem:** Build fails due to Node.js version
- Ensure Node.js >= 18
- Consider using [nvm](https://github.com/nvm-sh/nvm) to manage Node versions:
  ```bash
  nvm install 22
  nvm use 22
  ```

## Additional Resources

- **Android Testing:** See [docs/android-testing.md](docs/android-testing.md)
- **WebDAV Sync:** Configured in preferences page
- **Firefox Extension Docs:** https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions

## Questions?

If you encounter issues not covered here:
1. Check existing issues on GitHub
2. Create a new issue with:
   - Your Node.js/npm versions
   - Steps to reproduce
   - Error messages
   - Operating system

## License

See [LICENSE](LICENSE) file for details.
