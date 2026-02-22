# Configuration
EXTENSION_NAME := tabreminder
SHA1 := $(shell git rev-parse --short HEAD)
VERSION := $(shell jq -r .version package.json)
GIT_REPO := $(shell git config --get remote.origin.url)
ZIP_NAME_DESKTOP := $(EXTENSION_NAME)-v$(VERSION).zip
ZIP_NAME_ANDROID := $(EXTENSION_NAME)-android-v$(VERSION).zip

# Default target - build desktop version
all: build-desktop prepare-manifest package

# Build desktop version
build-desktop: clean
	@echo "Building desktop extension..."
	npm run build:desktop

# Build Android version
build-android: clean
	@echo "Building Android extension..."
	npm run build:android

# Build both versions
build-all: clean
	@echo "Building both desktop and Android versions..."
	npm run build:all

# Prepare manifest with version_name and create .gitidentity file (desktop)
prepare-manifest: build-desktop
	@echo "Preparing desktop manifest with version: $(VERSION) (SHA: $(SHA1))"
	
	@# Create .gitidentity file
	@echo "Repository: $(GIT_REPO)" > dist/.gitidentity
	@echo "Commit: $(SHA1)" >> dist/.gitidentity
	@echo "Version: $(VERSION)" >> dist/.gitidentity
	@echo "Build date: $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")" >> dist/.gitidentity
	@echo "Platform: desktop" >> dist/.gitidentity
	@echo "✓ Created .gitidentity file"

# Prepare Android manifest
prepare-manifest-android: build-android
	@echo "Preparing Android manifest with version: $(VERSION) (SHA: $(SHA1))"
	
	@# Create .gitidentity file
	@echo "Repository: $(GIT_REPO)" > dist-android/.gitidentity
	@echo "Commit: $(SHA1)" >> dist-android/.gitidentity
	@echo "Version: $(VERSION)" >> dist-android/.gitidentity
	@echo "Build date: $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")" >> dist-android/.gitidentity
	@echo "Platform: android" >> dist-android/.gitidentity
	@echo "✓ Created Android .gitidentity file"

# Create distribution package (desktop)
package: prepare-manifest
	@echo "Creating desktop distribution package: $(ZIP_NAME_DESKTOP)"
	@cd dist && zip -r ../$(ZIP_NAME_DESKTOP) . > /dev/null
	@echo "✓ Package created: $(ZIP_NAME_DESKTOP)"
	@echo "  Size: $$(du -h $(ZIP_NAME_DESKTOP) | cut -f1)"
	@echo "  SHA256: $$(shasum -a 256 $(ZIP_NAME_DESKTOP) | cut -d' ' -f1)"
	@echo ""
	@echo "Git identity:"
	@cat dist/.gitidentity | sed 's/^/  /'
	@echo ""
	@echo "Manifest version info:"
	@echo "  version: $$(jq -r '.version' dist/manifest.json 2>/dev/null || echo 'N/A')"

# Create Android distribution package
package-android: prepare-manifest-android
	@echo "Creating Android distribution package: $(ZIP_NAME_ANDROID)"
	@cd dist-android && zip -r ../$(ZIP_NAME_ANDROID) . > /dev/null
	@echo "✓ Package created: $(ZIP_NAME_ANDROID)"
	@echo "  Size: $$(du -h $(ZIP_NAME_ANDROID) | cut -f1)"
	@echo "  SHA256: $$(shasum -a 256 $(ZIP_NAME_ANDROID) | cut -d' ' -f1)"
	@echo ""
	@echo "Git identity:"
	@cat dist-android/.gitidentity | sed 's/^/  /'
	@echo ""
	@echo "Manifest version info:"
	@echo "  version: $$(jq -r '.version' dist-android/manifest.json 2>/dev/null || echo 'N/A')"

# Create both packages
package-all: package package-android
	@echo ""
	@echo "✓ Created both desktop and Android packages"

# Create package for Mozilla submission (clean version, no git info in filename)
mozilla-package: build
	@echo "Creating Mozilla submission package..."
	@# Just copy dist contents, no .gitidentity
	@cp -r dist dist-mozilla
	@# Ensure version is clean (no SHA in version field)
	@cd dist-mozilla && zip -r ../$(ZIP_NAME) . > /dev/null
	@rm -rf dist-mozilla
	@echo "✓ Mozilla package ready: $(ZIP_NAME)"
	@echo "  Note: No .gitidentity file included for Mozilla submission"

# Clean build artifacts
clean:
	@echo "Cleaning up..."
	@rm -f $(EXTENSION_NAME)-*.zip
	@rm -rf dist dist-android 2>/dev/null || true
	@echo "✓ Clean complete"

# Test the extension in Firefox
test: prepare-manifest
	@echo "Testing extension..."
	@if command -v web-ext > /dev/null; then \
		web-ext run --source-dir ./dist --firefox=firefox; \
	else \
		echo "⚠ web-ext not found. Install with: npm install -g web-ext"; \
		echo "You can test manually by loading dist/ in about:debugging"; \
	fi

# Lint the extension
lint:
	@echo "Linting extension..."
	@if command -v web-ext > /dev/null; then \
		web-ext lint --source-dir ./dist; \
	else \
		echo "⚠ web-ext not found. Install to use linting."; \
	fi

# Show info about the package
info:
	@echo "Extension: $(EXTENSION_NAME)"
	@echo "Version: $(VERSION)"
	@echo "Git SHA: $(SHA1)"
	@echo "Repository: $(GIT_REPO)"
	@echo "Package name: $(ZIP_NAME)"
	@if [ -f "$(ZIP_NAME)" ]; then \
		echo "Package exists: Yes"; \
		echo "Size: $$(du -h $(ZIP_NAME) | cut -f1)"; \
		echo ""; \
		echo "Contents of .gitidentity (if present in zip):"; \
		unzip -p $(ZIP_NAME) .gitidentity 2>/dev/null || echo "  Not present in zip"; \
	else \
		echo "Package exists: No (run 'make package' to create)"; \
	fi

# generate sourceode package
sourcecode-package:
	@echo "Creating source code package: $(EXTENSION_NAME)-source-v$(VERSION).tar.gz"
	@git archive --format=tar --prefix=$(EXTENSION_NAME)-source-v$(VERSION)/ HEAD | gzip > $(EXTENSION_NAME)-source-v$(VERSION).tar.gz
	@echo "✓ Source code package created: $(EXTENSION_NAME)-source-v$(VERSION).tar.gz"

# Install dependencies
install:
	npm install

check-version: VERSION := $(shell jq -r .version package.json)
check-version: MANI_VERSION := $(shell jq -r .version public/manifest.json)
check-version:
	@if [ "$(VERSION)" != "$(MANI_VERSION)" ]; then \
		echo "Error: Version mismatch between package.json ($(VERSION)) and manifest.json ($(MANI_VERSION))"; \
		exit 1; \
	else \
		echo "✓ Version check passed: $(VERSION)"; \
	fi

show-version: VERSION := $(shell jq -r .version package.json)
show-version: MANI_VERSION := $(shell jq -r .version public/manifest.json)
show-version: ANDROID_VERSION := $(shell jq -r .version public/manifest.android.json)
show-version: DIST_VERSION := $(shell jq -r .version dist/manifest.json 2>/dev/null || echo 'N/A')
show-version: DIST_ANDROID_VERSION := $(shell jq -r .version dist-android/manifest.json 2>/dev/null || echo 'N/A')
show-version:
	@echo "Current package version:  $(VERSION)"
	@echo "Current manifest version: $(MANI_VERSION)"
	@echo "Current Android manifest version: $(ANDROID_VERSION)"
	@echo "Built desktop manifest version: $(DIST_VERSION)"
	@echo "Built Android manifest version: $(DIST_ANDROID_VERSION)"
	@if [ "$(VERSION)" != "$(MANI_VERSION)" ] || [ "$(VERSION)" != "$(ANDROID_VERSION)" ]; then \
		echo ""; \
		echo "⚠ Version mismatch detected! Consider running 'make bump-version-number-*' to synchronize versions."; \
	fi
	@if [ "$(VERSION)" != "$(DIST_VERSION)" ] || [ "$(VERSION)" != "$(DIST_ANDROID_VERSION)" ]; then \
		echo ""; \
		echo "⚠ Built manifest version mismatch detected! Consider running 'make build-all' to update built manifest versions."; \
	fi

# Update of versionnumber in package.json and public/manifest.json
# Helper function to bump version and update manifest
define bump_version
	@echo "Bumping version number ($(1) level)..."
	@npm version $(1) --no-git-tag-version
	@set -e; \
	NEW_VERSION=$$(jq -r .version package.json); \
	if [ -z "$$NEW_VERSION" ] || [ "$$NEW_VERSION" = "null" ]; then \
		echo "Error: package.json version is empty"; \
		exit 1; \
	fi; \
	jq --arg version "$$NEW_VERSION" '.version = $$version' public/manifest.json > public/manifest.json.tmp && \
	mv public/manifest.json.tmp public/manifest.json && \
	jq --arg version "$$NEW_VERSION" '.version = $$version' public/manifest.android.json > public/manifest.android.json.tmp && \
	mv public/manifest.android.json.tmp public/manifest.android.json
	@echo "✓ Version bumped to $$(jq -r .version package.json)"
endef

bump-version-number-bugfixlevel:
	$(call bump_version,patch)

bump-version-number-minor:
	$(call bump_version,minor)

bump-version-number-major:
	$(call bump_version,major)


# Phony targets (not actual files)
.PHONY: all build-desktop build-android build-all prepare-manifest prepare-manifest-android package package-android package-all mozilla-package clean test lint info install bump-version-number-bugfixlevel bump-version-number-minor bump-version-number-major check-version show-version sourcecode-package
