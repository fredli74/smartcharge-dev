#!/bin/bash
set -x -e -o pipefail

# Set the save-prefix to "~" to avoid caret (^) in package.json
prefix=$(npm config get save-prefix)
if [ "$prefix" != "~" ]; then
  npm config set save-prefix="~"
fi
# on error or exit, set it back
trap 'npm config set save-prefix="$prefix"' EXIT

# Function to fetch all versions and their release dates for a package
get_version_dates() {
  local package=$1
  npm info "$package" time --json 2>/dev/null | grep -Eo '"([^"@]+)":\s*"([^"]+)"' | sed 's/"//g' | awk -F: '{print $1 "|" $2}'
}

# Take two versions and return true if the first one is greater
version_is_greater() {
  local version1=$1
  local version2=$2

  # Trim spaces and strip -suffix from the versions
  version1=$(echo "$version1" | sed -E 's/\s*[~^]//g' | sed -E 's/\s//g' | sed -E 's/-.*//g')
  version2=$(echo "$version2" | sed -E 's/\s*[~^]//g' | sed -E 's/\s//g' | sed -E 's/-.*//g')

  # compare versions and return true if the first one is greater (but not equal)
  # which is the same as first row of reverse sorted versions is not equal to the second version
  [[ $(echo -e "$version1\n$version2" | sort -Vr | head -n1) != "$version2" ]]
}

# Process dependencies globally in date order
update_packages_globally() {
  local testcmd=$1

  # Ensure a test command is provided
  if [ -z "$testcmd" ]; then
    echo "Error: Test command must be provided."
    exit 1
  fi

  # Temporary file to store package release dates globally
  temp_file=$(mktemp)
  failed_packages=()

  set +x

  # Collect release dates for all dependencies
  grep -E '"dependencies":|"devDependencies":' -A 100 package.json | \
    grep -Eo '"([^"@]+)":\s*"([^"]+)"' | \
    sed 's/"//g' | \
    awk -F: '{print $1 "|" $2}' | while IFS='|' read -r package current_version; do
      # Skip fixed versions (no ^ or ~)
      if [[ ! "$current_version" =~ [~^] ]]; then
        echo "Skipping fixed version: $package@$current_version"
        failed_packages+=("$package")
        continue
      fi

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

        # Skip versions older than or equal to the current one
        if ! version_is_greater "$version" "$current_version"; then
          continue
        fi
        
        # Skip versions with pre-release tags
        if [[ "$version" =~ -([a-zA-Z0-9]+) ]]; then
          echo "Skipping $package@$version because it is a '${BASH_REMATCH[1]}' version."
          continue
        fi

        # Add valid versions to the processing queue
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
      echo "Failed upgrade $package $current_version → $updated_version"
      echo "Test command failed for $package@$updated_version. Blocking further updates for this package."
      failed_packages+=("$package")
      git reset --hard
      continue
    fi

    # Commit changes for this update
    if [[ -n $(git diff --name-only) ]]; then
      echo "Committing changes for $package $current_version → $updated_version"
      git add package.json package-lock.json
      git commit -m "$package $current_version → $updated_version"
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
update_packages_globally "$1"

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
