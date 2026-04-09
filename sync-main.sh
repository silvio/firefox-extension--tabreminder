#!/usr/bin/env bash
# Sync development branch to main with release preparation
# Usage: ./sync-main.sh [options] <source-branch-or-tag>

set -e # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Default values
MAIN_BRANCH="main"
DRY_RUN=false
AUTO_YES=false
EXCLUDE_PATTERNS=()
CREATE_TAGS=true # Create safety tags by default
COMMIT_TEXT=""

# Exclusion pattern source tracking
declare -a CLI_PATTERNS=()
declare -a CONFIG_PATTERNS=()
declare -a FILE_PATTERNS=()
declare -A PATTERN_SOURCES # pattern -> "CLI"|"config:KEY"|"file:SECTION"

# Help message - short version
show_help_short() {
	cat <<EOF
Usage: ./sync-main.sh [options] <source-branch-or-tag>

Syncs source to main, creating a release on branch sources first.

Options:
  -h, --help              Show this help
  --help-full             Show complete documentation
  -n, --dry-run           Preview without executing
  -y, --yes               Skip confirmations
  -m, --main BRANCH       Target branch (default: main)
  -e, --exclude PATTERN   Exclude paths (repeatable)
  --no-tags               Skip creating safety backup tags
  -t, --text              Additional text to commit message (prepended to "import from <source>")


Examples:
  ./sync-main.sh dev                 # Sync dev → main
  ./sync-main.sh --dry-run dev       # Preview changes
  ./sync-main.sh --no-tags dev       # Skip safety tags
  ./sync-main.sh -e .github dev      # Exclude .github
  ./sync-main.sh v1.2.13             # Sync from tag

Exclusions:
  Use -e flag to exclude files/folders. Supports wildcards: *.md, docs/

  Advanced config (git config, .sync-exclude file):
    ./sync-main.sh --help-full

Workflow:
  1. For branch sources: bump patch version, finalize CHANGELOG release, commit "release v...", tag "copilot-v..."
  2. Checkout main
  3. Copy source → main (excluding patterns)
  4. Commit: "import from <source>"
  5. Build release artifacts on main and tag the import commit as "v..."
  6. Merge main → source (traceability)
  7. On branch sources: restore empty `## [Unreleased]` and commit it on the source branch
EOF
}

# Help message - full documentation
show_help_full() {
	# Show short help first
	show_help_short

	cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADVANCED EXCLUSION CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Three Configuration Methods (all merge together):

1. Command-Line (one-time):
   ./sync-main.sh -e .github -e docs dev

2. Git Config (persistent):
   git config sync.from-dev.to-main.exclude ".github,docs"
   git config sync.from-*.to-main.exclude ".github"      # Any → main
   git config sync.from-dev.to-*.exclude ".github"       # dev → any
   git config sync.from-*.to-*.exclude ".github"         # Global

3. Config File (.sync-exclude in repo root):
   [dev -> main]
   exclude = .github
   exclude = docs

   [* -> main]
   exclude = .github

Pattern Merging:
  All matching patterns combine (additive). Example:
    sync.from-*.to-*.exclude = ".github"
    sync.from-dev.to-*.exclude = ".testfile"

    ./sync-main.sh dev main
    → Excludes: .github, .testfile (both!)

Specificity Order (most to least):
  1. sync.from-SOURCE.to-TARGET.exclude    (exact)
  2. sync.from-*.to-TARGET.exclude         (any source)
  3. sync.from-SOURCE.to-*.exclude         (any target)
  4. sync.from-*.to-*.exclude              (global)

Disable Inheritance:
  git config sync.from-hotfix.to-main.exclude ""   # Empty = no exclusions

Setup Examples:
  # Global default
  git config sync.from-*.to-*.exclude ".github"

  # Specific override
  git config sync.from-dev.to-main.exclude "docs,*.md"

  # Hotfix includes everything
  git config sync.from-hotfix.to-main.exclude ""

View Config:
  git config --get-regexp "sync\\.from-.*\\.to-.*"

Config File Format:
  INI-style with [SOURCE -> TARGET] sections:

  [dev -> main]           # Exact match
  exclude = .github

  [* -> main]             # Any source → main
  exclude = .github

  [* -> *]                # Global default
  exclude = .github

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
}

# Legacy wrapper for backward compatibility
show_help() {
	show_help_short
}

# Parse command-line arguments
SOURCE_REF=""
while [[ $# -gt 0 ]]; do
	case $1 in
	-h | --help)
		show_help_short
		exit 0
		;;
	--help-full)
		show_help_full
		exit 0
		;;
	-n | --dry-run)
		DRY_RUN=true
		shift
		;;
	-y | --yes)
		AUTO_YES=true
		shift
		;;
	-m | --main)
		MAIN_BRANCH="$2"
		shift 2
		;;
	-e | --exclude)
		EXCLUDE_PATTERNS+=("$2")
		CLI_PATTERNS+=("$2")
		PATTERN_SOURCES["$2"]="CLI"
		shift 2
		;;
	--no-tags)
		CREATE_TAGS=false
		shift
		;;
	-t | --text)
		COMMIT_TEXT="$2"
		shift 2
		;;
	-*)
		echo -e "${RED}Error: Unknown option $1${NC}"
		echo "Run './sync-main.sh --help' for usage information"
		exit 1
		;;
	*)
		SOURCE_REF="$1"
		shift
		;;
	esac
done

# Check if source reference provided
if [ -z "$SOURCE_REF" ]; then
	echo -e "${RED}Error: Source branch or tag not specified${NC}"
	echo "Usage: ./sync-main.sh <source-branch-or-tag>"
	echo "Run './sync-main.sh --help' for more information"
	exit 1
fi

# Function: Read exclusion patterns from git config
read_git_config_patterns() {
	local source="$1"
	local target="$2"

	# Try patterns in specificity order (most to least specific)
	local config_keys=(
		"sync.from-${source}.to-${target}.exclude" # Exact match
		"sync.from-*.to-${target}.exclude"         # Any source → target
		"sync.from-${source}.to-*.exclude"         # Source → any target
		"sync.from-*.to-*.exclude"                 # Global default
	)

	for key in "${config_keys[@]}"; do
		local value=$(git config --get "$key" 2>/dev/null)

		# Check for explicit empty (disables inheritance)
		if [ "$value" = "" ] && git config --get "$key" >/dev/null 2>&1; then
			# Empty string set explicitly - stop here, no patterns
			return
		fi

		if [ -n "$value" ]; then
			# Split comma-separated patterns
			IFS=',' read -ra patterns <<<"$value"
			for pattern in "${patterns[@]}"; do
				# Trim whitespace
				pattern=$(echo "$pattern" | xargs)
				if [ -n "$pattern" ]; then
					EXCLUDE_PATTERNS+=("$pattern")
					CONFIG_PATTERNS+=("$pattern")
					PATTERN_SOURCES["$pattern"]="$key"
				fi
			done
		fi
	done
}

# Function to execute or print command
run_cmd() {
	if [ "$DRY_RUN" = true ]; then
		echo -e "${BLUE}[DRY-RUN]${NC} $*"
	else
		"$@"
	fi
}

get_current_version() {
	jq -r .version package.json
}

get_manifest_version() {
	jq -r .version public/manifest.json
}

get_latest_released_version_from_changelog() {
	(grep -m1 '^## \[[0-9]' CHANGELOG.md || true) | sed -E 's/^## \[([^]]+)\].*/\1/'
}

increment_patch_version() {
	local version="$1"
	local major minor patch
	IFS='.' read -r major minor patch <<<"$version"

	if ! [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]]; then
		echo -e "${RED}Error: Unsupported semantic version '$version'${NC}" >&2
		exit 1
	fi

	echo "${major}.${minor}.$((patch + 1))"
}

ensure_versions_match() {
	local package_version manifest_version
	package_version=$(get_current_version)
	manifest_version=$(get_manifest_version)

	if [ "$package_version" != "$manifest_version" ]; then
		echo -e "${RED}Error: Version mismatch between package.json ($package_version) and public/manifest.json ($manifest_version)${NC}"
		exit 1
	fi
}

ensure_changelog_has_unreleased() {
	if ! grep -q '^## \[Unreleased\]$' CHANGELOG.md; then
		echo -e "${RED}Error: CHANGELOG.md must contain a top-level '## [Unreleased]' section${NC}"
		exit 1
	fi
}

plan_release_metadata() {
	RELEASE_PREPARED=false
	RELEASE_VERSION=""
	RELEASE_TAG=""
	MAIN_RELEASE_TAG=""

	if [ "$IS_BRANCH" != true ]; then
		return 0
	fi

	ensure_versions_match
	ensure_changelog_has_unreleased

	CURRENT_VERSION=$(get_current_version)
	LATEST_RELEASED_VERSION=$(get_latest_released_version_from_changelog)

	if [ -z "$LATEST_RELEASED_VERSION" ]; then
		echo -e "${RED}Error: Could not determine latest released version from CHANGELOG.md${NC}"
		exit 1
	fi

	RELEASE_VERSION=$(increment_patch_version "$CURRENT_VERSION")
	RELEASE_TAG="copilot-v${RELEASE_VERSION}"
	MAIN_RELEASE_TAG="v${RELEASE_VERSION}"

	if [ "$CURRENT_VERSION" = "$LATEST_RELEASED_VERSION" ]; then
		RELEASE_VERSION_REASON="No version bump since last release; patch bump required"
	else
		RELEASE_VERSION_REASON="Version already advanced beyond last release; patch bumping once more"
	fi
}

finalize_changelog_release_section() {
	local release_version="$1"
	local release_date="$2"
	local tmp_file
	tmp_file=$(mktemp)

	awk -v heading="## [${release_version}] - ${release_date}" '
        BEGIN { replaced = 0 }
        {
            if (!replaced && $0 == "## [Unreleased]") {
                print heading
                replaced = 1
            } else {
                print $0
            }
        }
        END {
            if (!replaced) {
                exit 1
            }
        }
    ' CHANGELOG.md >"$tmp_file"

	mv "$tmp_file" CHANGELOG.md
}

restore_empty_unreleased_section() {
	if grep -q '^## \[Unreleased\]$' CHANGELOG.md; then
		return 0
	fi

	local tmp_file
	tmp_file=$(mktemp)

	awk '
        BEGIN { inserted = 0 }
        {
            if (!inserted && $0 ~ /^## \[[0-9]/) {
                print "## [Unreleased]"
                print ""
                inserted = 1
            }
            print $0
        }
        END {
            if (!inserted) {
                print "## [Unreleased]"
                print ""
            }
        }
    ' CHANGELOG.md >"$tmp_file"

	mv "$tmp_file" CHANGELOG.md
}

prepare_release_on_source_branch() {
	if [ "$IS_BRANCH" != true ]; then
		echo -e "${YELLOW}Release preparation skipped (source is not a branch)${NC}"
		return 0
	fi

	echo -e "${GREEN}Release: Prepare source branch $SOURCE_REF${NC}"
	echo -e "  ${BLUE}Current version:${NC} $CURRENT_VERSION"
	echo -e "  ${BLUE}Last released version:${NC} $LATEST_RELEASED_VERSION"
	echo -e "  ${BLUE}Next release version:${NC} $RELEASE_VERSION"
	echo -e "  ${BLUE}Source release tag:${NC} $RELEASE_TAG"
	echo -e "  ${BLUE}Main release tag:${NC} $MAIN_RELEASE_TAG"
	echo -e "  ${BLUE}Reason:${NC} $RELEASE_VERSION_REASON"

	if [ "$DRY_RUN" = true ]; then
		echo -e "${BLUE}[DRY-RUN]${NC} git checkout $SOURCE_REF"
		echo -e "${BLUE}[DRY-RUN]${NC} make bump-version-number-bugfixlevel"
		echo -e "${BLUE}[DRY-RUN]${NC} update CHANGELOG.md heading to '## [$RELEASE_VERSION] - $(date +%Y-%m-%d)'"
		echo -e "${BLUE}[DRY-RUN]${NC} git add CHANGELOG.md package.json public/manifest.json package-lock.json"
		echo -e "${BLUE}[DRY-RUN]${NC} git commit -m 'release v$RELEASE_VERSION'"
		echo -e "${BLUE}[DRY-RUN]${NC} git tag $RELEASE_TAG"
		RELEASE_PREPARED=true
		echo ""
		return 0
	fi

	if git rev-parse --verify "$RELEASE_TAG" >/dev/null 2>&1; then
		echo -e "${RED}Error: Release tag '$RELEASE_TAG' already exists${NC}"
		exit 1
	fi

	if git rev-parse --verify "$MAIN_RELEASE_TAG" >/dev/null 2>&1; then
		echo -e "${RED}Error: Release tag '$MAIN_RELEASE_TAG' already exists${NC}"
		exit 1
	fi

	git checkout "$SOURCE_REF"
	make bump-version-number-bugfixlevel
	ensure_versions_match

	local actual_version release_date
	actual_version=$(get_current_version)
	if [ "$actual_version" != "$RELEASE_VERSION" ]; then
		echo -e "${RED}Error: Expected version $RELEASE_VERSION after bump, got $actual_version${NC}"
		exit 1
	fi

	release_date=$(date +%Y-%m-%d)
	finalize_changelog_release_section "$RELEASE_VERSION" "$release_date"

	git add CHANGELOG.md package.json public/manifest.json package-lock.json
	git commit -m "release v$RELEASE_VERSION"
	git tag "$RELEASE_TAG"

	RELEASE_PREPARED=true
	echo ""
}

build_release_on_main() {
	if [ "$IS_BRANCH" != true ] || [ "$RELEASE_PREPARED" != true ]; then
		return 0
	fi

	echo -e "${GREEN}Step 6: Build release artifacts on $MAIN_BRANCH and tag $MAIN_RELEASE_TAG${NC}"

	if [ "$DRY_RUN" = true ]; then
		echo -e "${BLUE}[DRY-RUN]${NC} make release"
		echo -e "${BLUE}[DRY-RUN]${NC} git tag $MAIN_RELEASE_TAG"
		return 0
	fi

	make release
	git tag "$MAIN_RELEASE_TAG"
}

reset_changelog_on_source_branch() {
	if [ "$IS_BRANCH" != true ] || [ "$RELEASE_PREPARED" != true ]; then
		return 0
	fi

	echo -e "${GREEN}Step 8: Restore empty [Unreleased] on $SOURCE_REF${NC}"

	if [ "$DRY_RUN" = true ]; then
		echo -e "${BLUE}[DRY-RUN]${NC} git checkout $SOURCE_REF"
		echo -e "${BLUE}[DRY-RUN]${NC} insert empty '## [Unreleased]' at top of CHANGELOG.md"
		echo -e "${BLUE}[DRY-RUN]${NC} git add CHANGELOG.md"
		echo -e "${BLUE}[DRY-RUN]${NC} git commit -m 'prepare changelog for next iteration after v$RELEASE_VERSION'"
		return 0
	fi

	git checkout "$SOURCE_REF"
	restore_empty_unreleased_section
	git add CHANGELOG.md

	if git diff --cached --quiet; then
		echo -e "${YELLOW}No changelog reset changes to commit on $SOURCE_REF${NC}"
		return 0
	fi

	git commit -m "prepare changelog for next iteration after v$RELEASE_VERSION"
}

# Check if in git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
	echo -e "${RED}Error: Not in a git repository${NC}"
	exit 1
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Git Branch Sync Script${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Save current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")
echo -e "${BLUE}Current branch:${NC} $CURRENT_BRANCH"
echo -e "${BLUE}Source reference:${NC} $SOURCE_REF"
echo -e "${BLUE}Target branch:${NC} $MAIN_BRANCH"
echo ""

# Check if source reference exists
if ! git rev-parse --verify "$SOURCE_REF" >/dev/null 2>&1; then
	echo -e "${RED}Error: Source reference '$SOURCE_REF' does not exist${NC}"
	exit 1
fi

# Read exclusion patterns from git config
read_git_config_patterns "$SOURCE_REF" "$MAIN_BRANCH"

# Determine if source is a branch or tag
IS_BRANCH=false
if git show-ref --verify --quiet "refs/heads/$SOURCE_REF"; then
	IS_BRANCH=true
	echo -e "${BLUE}Source type:${NC} branch"
elif git show-ref --verify --quiet "refs/tags/$SOURCE_REF"; then
	echo -e "${BLUE}Source type:${NC} tag (immutable)"
else
	echo -e "${BLUE}Source type:${NC} commit/reference (immutable, detached)"
fi
echo ""

RELEASE_PREPARED=false
RELEASE_VERSION=""
RELEASE_TAG=""
MAIN_RELEASE_TAG=""
CURRENT_VERSION=""
LATEST_RELEASED_VERSION=""
RELEASE_VERSION_REASON=""

plan_release_metadata

if [ "$IS_BRANCH" = true ]; then
	echo -e "${BLUE}Planned release version:${NC} $RELEASE_VERSION"
	echo -e "${BLUE}Planned source tag:${NC} $RELEASE_TAG"
	echo -e "${BLUE}Planned main tag:${NC} $MAIN_RELEASE_TAG"
	echo ""
fi

# Check if main branch exists
if ! git rev-parse --verify "$MAIN_BRANCH" >/dev/null 2>&1; then
	echo -e "${RED}Error: Main branch '$MAIN_BRANCH' does not exist${NC}"
	echo -e "${YELLOW}Tip: Create it with: git checkout -b $MAIN_BRANCH${NC}"
	exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
	echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
	git status --short
	echo ""
	if [ "$AUTO_YES" = false ] && [ "$DRY_RUN" = false ]; then
		read -p "Continue anyway? (y/N) " -n 1 -r
		echo
		if [[ ! $REPLY =~ ^[Yy]$ ]]; then
			echo -e "${RED}Aborted${NC}"
			exit 1
		fi
	fi
fi

# Function: Create safety backup tags
create_safety_tags() {
	local source_ref="$1"
	local target_branch="$2"

	# Generate UTC timestamp for UUID
	SYNC_UUID=$(date -u +%Y-%m-%dT%H:%M:%SZ)

	# Sanitize branch names for tag names (replace / with -)
	local source_clean=$(echo "$source_ref" | tr '/' '-')
	local target_clean=$(echo "$target_branch" | tr '/' '-')

	# Create tag names
	SOURCE_TAG="sync-backup--${SYNC_UUID}--source--${source_clean}"
	TARGET_TAG="sync-backup--${SYNC_UUID}--target--${target_clean}"

	if [ "$CREATE_TAGS" = false ]; then
		echo -e "${DIM}Safety backup tags skipped (--no-tags)${NC}"
		echo ""
		return 0
	fi

	echo -e "${BLUE}Creating safety backup tags...${NC}"

	# Tag source
	if [ "$DRY_RUN" = false ]; then
		if git tag "$SOURCE_TAG" "$source_ref" 2>/dev/null; then
			echo -e "  ${GREEN}✓${NC} Tagged source ($source_ref): ${YELLOW}$SOURCE_TAG${NC}"
		else
			echo -e "  ${YELLOW}⚠${NC} Tag already exists: $SOURCE_TAG"
		fi
	else
		echo -e "  ${BLUE}[DRY-RUN]${NC} Would tag source ($source_ref): $SOURCE_TAG"
	fi

	# Tag target
	if [ "$DRY_RUN" = false ]; then
		if git tag "$TARGET_TAG" "$target_branch" 2>/dev/null; then
			echo -e "  ${GREEN}✓${NC} Tagged target ($target_branch): ${YELLOW}$TARGET_TAG${NC}"
		else
			echo -e "  ${YELLOW}⚠${NC} Tag already exists: $TARGET_TAG"
		fi
	else
		echo -e "  ${BLUE}[DRY-RUN]${NC} Would tag target ($target_branch): $TARGET_TAG"
	fi

	echo ""
	echo -e "${DIM}To revert this sync later:${NC}"
	echo -e "  ${DIM}git checkout $source_ref && git reset --hard $SOURCE_TAG${NC}"
	echo -e "  ${DIM}git checkout $target_branch && git reset --hard $TARGET_TAG${NC}"
	echo ""
}

# Create safety tags before any operations
create_safety_tags "$SOURCE_REF" "$MAIN_BRANCH"

# Function: Check if merge will succeed without conflicts
check_merge_conflicts() {
	local source="$1"
	local target="$2"

	# Only check if source is a branch (we'll merge back)
	if [ "$IS_BRANCH" != true ]; then
		return 0
	fi

	# Find merge base
	local merge_base=$(git merge-base "$source" "$target" 2>/dev/null)
	if [ -z "$merge_base" ]; then
		# No common ancestor - this is okay, skip check
		return 0
	fi

	# Test merge using merge-tree
	local merge_result=$(git merge-tree "$merge_base" "$target" "$source" 2>/dev/null)

	# Check for conflict markers
	if echo "$merge_result" | grep -q "^+<<<<<<<\|^+>>>>>>>\|^+======="; then
		return 1
	fi

	return 0
}

# Function: Check if target branch has uncommitted changes
check_target_clean() {
	local target="$1"

	# Save current branch
	local current=$(git symbolic-ref --short HEAD 2>/dev/null || echo "detached")

	# Checkout target to check its state
	if [ "$current" != "$target" ]; then
		git checkout "$target" --quiet 2>/dev/null || return 1
	fi

	# Check for staged changes
	if ! git diff --cached --quiet; then
		# Return to original branch
		if [ "$current" != "$target" ] && [ "$current" != "detached" ]; then
			git checkout "$current" --quiet 2>/dev/null || true
		fi
		return 1
	fi

	# Return to original branch
	if [ "$current" != "$target" ] && [ "$current" != "detached" ]; then
		git checkout "$current" --quiet 2>/dev/null || true
	fi

	return 0
}

# Function: Run all pre-flight checks
run_preflight_checks() {
	echo -e "${BLUE}Running pre-flight checks...${NC}"

	# Check for merge conflicts
	if ! check_merge_conflicts "$SOURCE_REF" "$MAIN_BRANCH"; then
		echo -e "${RED}✗ Pre-flight check failed: Merge conflicts detected${NC}"
		echo -e "${YELLOW}The merge-back operation would create conflicts.${NC}"
		echo -e "${YELLOW}Please resolve conflicts manually before syncing.${NC}"
		exit 1
	fi
	echo -e "  ${GREEN}✓${NC} No merge conflicts detected"

	# Check target branch is clean
	if ! check_target_clean "$MAIN_BRANCH"; then
		echo -e "${RED}✗ Pre-flight check failed: Target branch has staged changes${NC}"
		echo -e "${YELLOW}Please commit or stash changes on '$MAIN_BRANCH' before syncing.${NC}"
		exit 1
	fi
	echo -e "  ${GREEN}✓${NC} Target branch is clean"

	echo -e "  ${GREEN}✓${NC} All pre-flight checks passed"
	echo ""
}

# Run pre-flight checks (only if not dry-run)
if [ "$DRY_RUN" = false ]; then
	run_preflight_checks
fi

# Function: Find files that match exclusion patterns
get_excluded_files() {
	local source_ref="$1"
	shift
	local patterns=("$@")

	if [ ${#patterns[@]} -eq 0 ]; then
		echo ""
		return
	fi

	# Get all files in source
	local all_files=$(git ls-tree -r --name-only "$source_ref" 2>/dev/null | sort)

	if [ -z "$all_files" ]; then
		echo ""
		return
	fi

	# Filter out files matching exclusion patterns
	local excluded=""
	for file in $all_files; do
		local should_exclude=false
		for pattern in "${patterns[@]}"; do
			# Check if file matches pattern (using bash pattern matching)
			case "$file" in
			$pattern | $pattern/* | */$pattern | */$pattern/*)
				should_exclude=true
				break
				;;
			esac
		done

		if [ "$should_exclude" = true ]; then
			excluded="${excluded}${file}"$'\n'
		fi
	done

	echo -n "$excluded"
}

# Function: Show exclusion summary with matched files
show_exclusion_summary() {
	if [ ${#EXCLUDE_PATTERNS[@]} -eq 0 ]; then
		echo -e "${BLUE}Exclusions:${NC} none"
		echo ""
		return
	fi

	echo -e "${BLUE}Exclusion configuration:${NC}"

	# Show CLI patterns
	if [ ${#CLI_PATTERNS[@]} -gt 0 ]; then
		echo -e "  ${YELLOW}CLI patterns:${NC}        ${CLI_PATTERNS[*]}"
	fi

	# Show git config patterns (future)
	if [ ${#CONFIG_PATTERNS[@]} -gt 0 ]; then
		echo -e "  ${YELLOW}Git config:${NC}"
		for pattern in "${CONFIG_PATTERNS[@]}"; do
			local source="${PATTERN_SOURCES[$pattern]}"
			echo -e "    $pattern ${DIM}($source)${NC}"
		done
	fi

	# Show file patterns (future)
	if [ ${#FILE_PATTERNS[@]} -gt 0 ]; then
		echo -e "  ${YELLOW}.sync-exclude:${NC}"
		for pattern in "${FILE_PATTERNS[@]}"; do
			local source="${PATTERN_SOURCES[$pattern]}"
			echo -e "    $pattern ${DIM}($source)${NC}"
		done
	fi

	# Summary line
	echo -e "  ${GREEN}──────────────────────────────────────────────${NC}"
	echo -e "  ${GREEN}Total:${NC} ${#EXCLUDE_PATTERNS[@]} patterns    ${GREEN}Matches:${NC} $EXCLUDED_COUNT files"
	echo ""

	# Show excluded files
	if [ $EXCLUDED_COUNT -gt 0 ]; then
		echo -e "${BLUE}Files NOT being copied ($EXCLUDED_COUNT):${NC}"
		echo "$EXCLUDED_FILES" | head -20 | while IFS= read -r file; do
			[ -n "$file" ] && echo -e "  ${RED}✗${NC} $file"
		done
		if [ $EXCLUDED_COUNT -gt 20 ]; then
			echo -e "  ${DIM}... and $((EXCLUDED_COUNT - 20)) more${NC}"
		fi
		echo ""
	fi
}

# Get excluded files list
EXCLUDED_FILES=$(get_excluded_files "$SOURCE_REF" "${EXCLUDE_PATTERNS[@]}")
if [ -z "$EXCLUDED_FILES" ]; then
	EXCLUDED_COUNT=0
else
	EXCLUDED_COUNT=$(echo "$EXCLUDED_FILES" | wc -l)
fi

# Show exclusion summary
show_exclusion_summary

# Show diff summary (excluding patterns)
echo -e "${BLUE}Changes from $MAIN_BRANCH to $SOURCE_REF:${NC}"

# Build pathspec exclusion arguments for git diff
DIFF_PATHSPEC_ARGS=()
if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
	for pattern in "${EXCLUDE_PATTERNS[@]}"; do
		DIFF_PATHSPEC_ARGS+=(":(exclude)$pattern")
	done
fi

# Get diff with exclusions applied
if [ ${#DIFF_PATHSPEC_ARGS[@]} -gt 0 ]; then
	DIFF_STAT=$(git diff --stat "$MAIN_BRANCH".."$SOURCE_REF" -- . "${DIFF_PATHSPEC_ARGS[@]}" 2>/dev/null || true)
else
	DIFF_STAT=$(git diff --stat "$MAIN_BRANCH".."$SOURCE_REF")
fi

if [ -z "$DIFF_STAT" ]; then
	echo -e "${YELLOW}No changes detected between $MAIN_BRANCH and $SOURCE_REF${NC}"
	if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
		echo "(after applying exclusions)"
	fi
	if [ "$IS_BRANCH" != true ]; then
		echo "Nothing to sync."
		exit 0
	fi
	echo "Release preparation will still create version and changelog changes."
	echo ""
else
	echo "$DIFF_STAT"
	echo ""
fi

# Confirmation
if [ "$AUTO_YES" = false ] && [ "$DRY_RUN" = false ]; then
	echo -e "${YELLOW}This will:${NC}"
	if [ "$IS_BRANCH" = true ]; then
		echo "  1. On '$SOURCE_REF', bump patch version to '$RELEASE_VERSION' and create commit: 'release v$RELEASE_VERSION'"
		echo "  2. Create release tag: '$RELEASE_TAG'"
		echo "  3. Make '$MAIN_BRANCH' identical to '$SOURCE_REF' (including deletions)"
		echo "  4. Create commit: 'import from \"$SOURCE_REF\"'"
		echo "  5. Run 'make release' on '$MAIN_BRANCH' and create tag '$MAIN_RELEASE_TAG'"
	else
		echo "  1. Make '$MAIN_BRANCH' identical to '$SOURCE_REF' (including deletions)"
		echo "  2. Create commit: 'import from \"$SOURCE_REF\"'"
	fi
	if [ "$IS_BRANCH" = true ]; then
		echo "  6. Merge '$MAIN_BRANCH' back into '$SOURCE_REF' (for traceability)"
		echo "  7. Commit an empty '[Unreleased]' changelog reset on '$SOURCE_REF'"
	else
		echo "  3. Skip merge-back (source is not a branch)"
	fi
	echo ""
	read -p "Continue? (y/N) " -n 1 -r
	echo
	if [[ ! $REPLY =~ ^[Yy]$ ]]; then
		echo -e "${RED}Aborted${NC}"
		exit 0
	fi
fi

if [ "$DRY_RUN" = true ]; then
	echo -e "${BLUE}[DRY-RUN] Would execute the following:${NC}"
fi

# Release preparation phase for branch sources
if [ "$IS_BRANCH" = true ]; then
	echo ""
	prepare_release_on_source_branch
fi

# Step 1: Checkout main branch
echo ""
echo -e "${GREEN}Step 1: Checkout $MAIN_BRANCH branch${NC}"
run_cmd git checkout "$MAIN_BRANCH"

# Step 2: Remove tracked files from main (except excluded patterns)
echo -e "${GREEN}Step 2: Remove tracked files from $MAIN_BRANCH (preserving exclusions)${NC}"
if [ "$DRY_RUN" = false ]; then
	# Get all tracked files
	if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
		# Build grep exclude pattern
		GREP_PATTERN=""
		for pattern in "${EXCLUDE_PATTERNS[@]}"; do
			if [ -z "$GREP_PATTERN" ]; then
				GREP_PATTERN="$pattern"
			else
				GREP_PATTERN="$GREP_PATTERN|$pattern"
			fi
		done
		# Remove files that don't match exclusion patterns
		git ls-files -z | grep -zEv "^($GREP_PATTERN)" | xargs -0 git rm --quiet 2>/dev/null || true
		echo "  Preserved: ${EXCLUDE_PATTERNS[*]}"
	else
		# Remove all tracked files
		git ls-files -z | xargs -0 git rm --quiet 2>/dev/null || true
	fi
else
	if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
		# Build grep pattern for display
		grep_display=$(printf "|%s" "${EXCLUDE_PATTERNS[@]}")
		grep_display="${grep_display:1}" # Remove leading |
		echo -e "${BLUE}[DRY-RUN]${NC} git ls-files | grep -Ev '($grep_display)' | xargs git rm --quiet"
		echo -e "${BLUE}[DRY-RUN]${NC} Would preserve: ${EXCLUDE_PATTERNS[*]}"
	else
		echo -e "${BLUE}[DRY-RUN]${NC} git ls-files | xargs git rm --quiet"
	fi
fi

# Step 3: Copy all files from source (except excluded patterns)
echo -e "${GREEN}Step 3: Copy all files from $SOURCE_REF (excluding patterns)${NC}"
if [ "$DRY_RUN" = false ]; then
	if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
		# Build git pathspec with exclusions
		PATHSPEC_ARGS=(".")
		for pattern in "${EXCLUDE_PATTERNS[@]}"; do
			PATHSPEC_ARGS+=(":(exclude)$pattern")
		done
		git checkout "$SOURCE_REF" -- "${PATHSPEC_ARGS[@]}" 2>/dev/null || true
		echo "  Excluded from sync: ${EXCLUDE_PATTERNS[*]}"
	else
		git checkout "$SOURCE_REF" -- . 2>/dev/null || true
	fi
else
	if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
		# Build pathspec for display
		pathspecs_display="."
		for pattern in "${EXCLUDE_PATTERNS[@]}"; do
			pathspecs_display="$pathspecs_display ':(exclude)$pattern'"
		done
		echo -e "${BLUE}[DRY-RUN]${NC} git checkout $SOURCE_REF -- $pathspecs_display"
	else
		echo -e "${BLUE}[DRY-RUN]${NC} git checkout $SOURCE_REF -- ."
	fi
fi

# Step 4: Stage all changes (additions, modifications, deletions)
echo -e "${GREEN}Step 4: Stage all changes${NC}"
if [ "$DRY_RUN" = false ]; then
	if [ ${#EXCLUDE_PATTERNS[@]} -gt 0 ]; then
		SOURCE_STAGE_PATTERN=""
		for pattern in "${EXCLUDE_PATTERNS[@]}"; do
			if [ -z "$SOURCE_STAGE_PATTERN" ]; then
				SOURCE_STAGE_PATTERN="$pattern"
			else
				SOURCE_STAGE_PATTERN="$SOURCE_STAGE_PATTERN|$pattern"
			fi
		done
		git ls-tree -r -z --name-only "$SOURCE_REF" | grep -zEv "^($SOURCE_STAGE_PATTERN)" | git add --pathspec-from-file=- --pathspec-file-nul 2>/dev/null || true
	else
		git ls-tree -r -z --name-only "$SOURCE_REF" | git add --pathspec-from-file=- --pathspec-file-nul
	fi
	git add -u
else
	echo -e "${BLUE}[DRY-RUN]${NC} git ls-tree -r -z --name-only $SOURCE_REF | git add --pathspec-from-file=- --pathspec-file-nul"
	echo -e "${BLUE}[DRY-RUN]${NC} git add -u"
fi

# Step 5: Create import commit
if [ -z "${COMMIT_TEXT}" ]; then
	COMMIT_MSG="import from \"$SOURCE_REF\""
else
	COMMIT_MSG="${COMMIT_TEXT} (import from \"$SOURCE_REF\")"
fi
echo -e "${GREEN}Step 5: Create commit: $COMMIT_MSG${NC}"
if [ "$DRY_RUN" = false ]; then
	if git diff --cached --quiet; then
		echo -e "${YELLOW}No changes to commit (branches already in sync)${NC}"
	else
		git commit -m "$COMMIT_MSG"
	fi
else
	echo -e "${BLUE}[DRY-RUN]${NC} git commit -m '$COMMIT_MSG'"
fi

# Step 6: Build release artifacts and tag main release commit
build_release_on_main

# Step 7: Merge main back into source branch (only if source is a branch)
if [ "$IS_BRANCH" = true ]; then
	echo -e "${GREEN}Step 7: Merge $MAIN_BRANCH back into $SOURCE_REF${NC}"
	run_cmd git checkout "$SOURCE_REF"
	run_cmd git merge "$MAIN_BRANCH" -m "Merge $MAIN_BRANCH (import from \"$SOURCE_REF\")"
else
	echo -e "${YELLOW}Step 7: Skip merge-back (source is not a branch)${NC}"
fi

# Step 8: Reset changelog on source branch for next iteration
reset_changelog_on_source_branch

# Step 9: Return to original branch
if [ "$CURRENT_BRANCH" != "detached" ] && [ "$CURRENT_BRANCH" != "$SOURCE_REF" ]; then
	echo -e "${GREEN}Step 9: Return to original branch: $CURRENT_BRANCH${NC}"
	run_cmd git checkout "$CURRENT_BRANCH"
fi

# Summary
echo ""
echo -e "${GREEN}========================================${NC}"
if [ "$DRY_RUN" = true ]; then
	echo -e "${BLUE}[DRY-RUN] Complete! No changes were made.${NC}"
else
	echo -e "${GREEN}✓ Sync complete!${NC}"
fi
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Summary:${NC}"
echo "  Source: $SOURCE_REF"
echo "  Target: $MAIN_BRANCH"
if [ -n "$RELEASE_VERSION" ]; then
	echo "  Release: v$RELEASE_VERSION"
	echo "  Source tag: $RELEASE_TAG"
	echo "  Main tag: $MAIN_RELEASE_TAG"
fi
echo "  Commit: $COMMIT_MSG"
echo ""
if [ "$DRY_RUN" = false ]; then
	echo -e "${BLUE}Recent commits on $MAIN_BRANCH:${NC}"
	git log "$MAIN_BRANCH" --oneline -n 3
fi
