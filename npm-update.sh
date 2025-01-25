#!/bin/bash
set -x -e -o pipefail

# Check script arguments
#  1. (patch|minor|major) - the version bump to apply
#  2. (test command) - the command to run to test the changes
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 (patch|minor|major) 'test command'"
  exit 1
fi

target=$1
testcmd=$2

# Set the save-prefix to "~" to avoid caret (^) in package.json
prefix=$(npm config get save-prefix)
# Set prefix to patch:~, minor:^, major:~
if [ "$target" == "minor" ]; then
  npm config set save-prefix="^"
else 
  npm config set save-prefix="~"
fi
# on error or exit, set it back
trap 'npm config set save-prefix="$prefix"' EXIT

# Function to fetch all versions and their release dates for a package
get_version_dates() {
  local package=$1
  npm info "$package" time --json 2>/dev/null | grep -Eo '"([^"@]+)":\s*"([^"]+)"' | sed 's/"//g' | awk -F: '{print $1 "|" $2}'
}

# Process dependencies globally in date order
update_packages_globally() {
  # Temporary file to store package release dates globally
  temp_file=$(mktemp)
  failed_packages=()

  set +x

  # Collect release dates for all dependencies
  grep -E '"dependencies":|"devDependencies":' -A 100 package.json | \
    grep -Eo '"([^"@]+)":\s*"([^"]+)"' | \
    sed 's/"//g' | \
    awk -F: '{print $1 "|" $2}' | while IFS='|' read -r package current_version; do
      echo "Looking for updates for $package@$current_version"

      # Skip fixed versions (no ^ or ~)
      if [[ ! "$current_version" =~ [~^] ]]; then
        echo "Skipping fixed version: $package@$current_version"
        failed_packages+=("$package")
        continue
      fi

      # Split current version into major, minor, patch
      IFS='.' read -r current_major current_minor current_patch <<< $(echo "$current_version" | sed -E 's/\s*[~^]//g' | sed -E 's/\s//g' | sed -E 's/-.*//g')

      # Get all versions and release dates for this package
      get_version_dates "$package" | while IFS='|' read -r version release_date; do
        # Skip anything that is not a valid version x.x.x ...
        if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
          continue
        fi
        # Skip versions with null release dates (unexpected edge case)
        if [[ "$release_date" == null ]]; then
          continue
        fi

        # Split version into major, minor, patch 
        IFS='.' read -r new_major new_minor new_patch <<< $(echo "$version" | sed -E 's/\s*[~^]//g' | sed -E 's/\s//g' | sed -E 's/-.*//g')

        # Skip versions older or equal to the current version
        if [ "$new_major" -lt "$current_major" ] ||
          { [ "$new_major" -eq "$current_major" ] && [ "$new_minor" -lt "$current_minor" ]; } ||
          { [ "$new_major" -eq "$current_major" ] && [ "$new_minor" -eq "$current_minor" ] && [ "$new_patch" -le "$current_patch" ]; }; then
          continue
        fi

        # Filter out versions based on the target
        if [ "$target" == "patch" ] && { [ "$new_major" != "$current_major" ] || [ "$new_minor" != "$current_minor" ]; }; then
          continue
        fi

        if [ "$target" == "minor" ] && [ "$new_major" != "$current_major" ]; then
          continue
        fi
        
        # Skip versions with pre-release tags
        if [[ "$version" =~ -([a-zA-Z0-9]+) ]]; then
          # echo "Skipping $package@$version because it is a '${BASH_REMATCH[1]}' version."
          continue
        fi

        # Add valid versions to the processing queue
        echo "Found update: $package@$version (released: $release_date)"
        echo "$release_date|$package|$current_version|$version" >> "$temp_file"
      done
  done

  set -x
  
  # Sort updates globally by release date and process them
  sort "$temp_file" | while IFS='|' read -r release_date package current_version updated_version; do
    # Skip previously failed packages or pinned packages
    if [[ " ${failed_packages[*]} " =~ " $package " ]]; then
      echo "Skipping $package due to previous failure or pinned version."
      continue
    fi

    echo "Updating $package to $updated_version (released: $release_date)"
    npm install "$package@$updated_version"

    # Run test command
    echo "Running test command: $testcmd"
    if ! eval "$testcmd"; then
      echo "Failed upgrade $package $current_version → ~$updated_version"
      echo "Test command failed for $package@$updated_version. Blocking further updates for this package."
      failed_packages+=("$package")
      git reset --hard
      continue
    fi

    # Commit changes for this update
    if [[ -n $(git diff --name-only) ]]; then
      echo "Committing changes for $package $current_version → ~$updated_version"
      git add package.json package-lock.json
      git commit -m "$package $current_version → ~$updated_version"
    else
      echo "No changes detected for $package at $updated_version."
    fi
  done

  # Run npm audit fix and commit if necessary
  echo "Running npm audit fix"
  npm audit fix
  if [[ -n $(git diff --name-only) ]]; then
    git add package.json package-lock.json
    git commit -m "Fix security vulnerabilities"
  fi

  # Clean up
  rm -f "$temp_file"
}

# Switch to the npm-update branch
echo "Switching to branch 'npm-update' (or creating it if it doesn't exist)"
git checkout -B npm-update

# Run the update process
update_packages_globally

# Instructions for squashing commits and merging
echo "==== Update process completed ===="
echo "You can now squash and merge the 'npm-update' branch into your main branch."
echo ""
echo "Run the following commands to squash merge:"
echo ""
echo "    git checkout master"
echo "    git merge --squash npm-update"
echo "    git commit -m 'updated dependencies'"
echo ""
echo "This will combine all your commits into one."
