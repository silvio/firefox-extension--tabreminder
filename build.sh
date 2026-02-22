#!/usr/bin/env bash
set -e  # Exit on error

echo "========================================"
echo "Building TabReminder Extension"
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

# Step 3: Build both desktop and Android versions
echo "Step 3/4: Building desktop and Android versions..."
make build-all
echo ""

# Step 4: Create Mozilla submission packages
echo "Step 4/4: Creating Mozilla submission packages..."
make mozilla-package-all
echo ""

echo "========================================"
echo "✓ Build complete!"
echo "========================================"
echo ""
echo "Packages created:"
ls -lh tabreminder-*.zip 2>/dev/null || echo "  No packages found"
echo ""
echo "To create development packages with .gitidentity:"
echo "  make package-all"
echo ""
echo "To create source code package:"
echo "  make sourcecode-package"
echo ""
echo "To do a complete release build:"
echo "  make release"
