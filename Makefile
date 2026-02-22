# Configuration
EXTENSION_NAME := tabreminder
SHA1 := $(shell git rev-parse --short HEAD)
VERSION := $(shell jq -r .version package.json)
GIT_REPO := $(shell git config --get remote.origin.url)
ZIP_NAME := $(EXTENSION_NAME)-v$(VERSION).zip

# Default target - build universal package
all: build prepare-manifest package

# Build universal package (works on both desktop and Android)
build: clean
	@echo "Building universal extension (desktop + Android)..."
	npm run build

# Prepare manifest with version_name and create .gitidentity file
prepare-manifest: build
	@echo "Preparing manifest with version: $(VERSION) (SHA: $(SHA1))"
	
	@# Create .gitidentity file
	@echo "Repository: $(GIT_REPO)" > dist/.gitidentity
	@echo "Commit: $(SHA1)" >> dist/.gitidentity
	@echo "Version: $(VERSION)" >> dist/.gitidentity
	@echo "Build date: $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")" >> dist/.gitidentity
	@echo "Platform: universal (desktop + Android)" >> dist/.gitidentity
	@echo "✓ Created .gitidentity file"

# Create distribution package
package: prepare-manifest
	@echo "Creating universal distribution package: $(ZIP_NAME)"
	@cd dist && zip -r ../$(ZIP_NAME) . > /dev/null
	@echo "✓ Package created: $(ZIP_NAME)"
	@echo "  Size: $$(du -h $(ZIP_NAME) | cut -f1)"
	@echo "  SHA256: $$(shasum -a 256 $(ZIP_NAME) | cut -d' ' -f1)"
	@echo ""
	@echo "Git identity:"
	@cat dist/.gitidentity | sed 's/^/  /'
	@echo ""
	@echo "Manifest version info:"
	@echo "  version: $$(jq -r '.version' dist/manifest.json 2>/dev/null || echo 'N/A')"

# Create package for Mozilla submission (clean version, no git info)
mozilla-package: build
	@echo "Creating Mozilla submission package..."
	@cp -r dist dist-mozilla
	@cd dist-mozilla && zip -r ../$(ZIP_NAME) . > /dev/null
	@rm -rf dist-mozilla
	@echo "✓ Mozilla package ready: $(ZIP_NAME)"
	@echo "  Note: No .gitidentity file included for Mozilla submission"
	@echo "  Note: Works on both Firefox Desktop and Android"

# Clean build artifacts
clean:
	@echo "Cleaning up..."
	@rm -f $(EXTENSION_NAME)-*.zip
	@rm -rf dist 2>/dev/null || true
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

# Complete release build (for CI/CD or clean checkout)
release: clean install check-version build package mozilla-package sourcecode-package
	@echo ""
	@echo "=========================================="
	@echo "✓ Release build complete!"
	@echo "=========================================="
	@echo ""
	@echo "Development package (with .gitidentity):"
	@ls -lh $(ZIP_NAME) 2>/dev/null || echo "  None created"
	@echo ""
	@echo "Mozilla submission package (clean):"
	@ls -lh $(ZIP_NAME) 2>/dev/null || echo "  None created"
	@echo ""
	@echo "Source code package:"
	@ls -lh $(EXTENSION_NAME)-source-v$(VERSION).tar.gz 2>/dev/null || echo "  None created"
	@echo ""
	@echo "Version: $(VERSION)"
	@echo "Git SHA: $(SHA1)"
	@echo ""
	@echo "Note: This universal package works on both Firefox Desktop and Android"

# Git branch synchronization
sync-main:
	@./sync-main.sh

sync-main-dry-run:
	@./sync-main.sh --dry-run

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
show-version: DIST_VERSION := $(shell jq -r .version dist/manifest.json 2>/dev/null || echo 'N/A')
show-version:
	@echo "Current package version:  $(VERSION)"
	@echo "Current manifest version: $(MANI_VERSION)"
	@echo "Built manifest version: $(DIST_VERSION)"
	@if [ "$(VERSION)" != "$(MANI_VERSION)" ]; then \
		echo ""; \
		echo "⚠ Version mismatch detected! Consider running 'make bump-version-number-*' to synchronize versions."; \
	fi
	@if [ "$(VERSION)" != "$(DIST_VERSION)" ]; then \
		echo ""; \
		echo "⚠ Built manifest version mismatch detected! Consider running 'make build' to update built manifest version."; \
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
	mv public/manifest.json.tmp public/manifest.json
	@echo "✓ Version bumped to $$(jq -r .version package.json)"
endef

bump-version-number-bugfixlevel:
	$(call bump_version,patch)

bump-version-number-minor:
	$(call bump_version,minor)

bump-version-number-major:
	$(call bump_version,major)


# Phony targets (not actual files)
.PHONY: all build prepare-manifest package mozilla-package release sync-main sync-main-dry-run clean test lint info install bump-version-number-bugfixlevel bump-version-number-minor bump-version-number-major check-version show-version sourcecode-package
