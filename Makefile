# Configuration
EXTENSION_NAME := tabreminder
SHA1 := $(shell git rev-parse --short HEAD)
VERSION := $(shell jq -r .version package.json)
GIT_REPO := $(shell git config --get remote.origin.url)
ZIP_NAME := $(EXTENSION_NAME)-v$(VERSION).zip

# Default target
all: build prepare-manifest package

# Build the extension
build: clean
	@echo "Building extension..."
	npm run build

# Prepare manifest with version_name and create .gitidentity file
prepare-manifest: build
	@echo "Preparing manifest with version: $(VERSION) (SHA: $(SHA1))"
	
	@# Create .gitidentity file
	@echo "Repository: $(GIT_REPO)" > dist/.gitidentity
	@echo "Commit: $(SHA1)" >> dist/.gitidentity
	@echo "Version: $(VERSION)" >> dist/.gitidentity
	@echo "Build date: $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")" >> dist/.gitidentity
	@echo "✓ Created .gitidentity file"

# Create distribution package
package: prepare-manifest
	@echo "Creating distribution package: $(ZIP_NAME)"
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

# Install dependencies
install:
	npm install

# Phony targets (not actual files)
.PHONY: all build prepare-manifest package mozilla-package clean test lint info install
