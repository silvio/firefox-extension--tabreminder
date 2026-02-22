#!/usr/bin/env bash
set -e  # Exit on error

echo "========================================"
echo "Building TabReminder Universal Extension"
echo "========================================"
echo ""

# Step 1: Install dependencies
echo "Step 1/4: Installing dependencies..."
make install
echo ""

# Step 2: Clean previous builds
echo "Step 2/4: Cleaning previous builds..."
make clean
echo ""

# Step 3: Build universal package
echo "Step 3/4: Building universal package..."
make build
echo ""

# Step 4: Create Mozilla submission package
echo "Step 4/4: Creating Mozilla submission package..."
make mozilla-package
echo ""

echo "========================================"
echo "✓ Build complete!"
echo "========================================"
echo ""
echo "Package created:"
ls -lh tabreminder-*.zip 2>/dev/null || echo "  No packages found"
echo ""
echo "Note: This universal package works on both Firefox Desktop (91.0+) and Android (120.0+)"
echo ""
echo "To create development package with .gitidentity:"
echo "  make package"
echo ""
echo "To create source code package:"
echo "  make sourcecode-package"
echo ""
echo "To do a complete release build:"
echo "  make release"
