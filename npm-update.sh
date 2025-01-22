#!/bin/bash
set -x -e -o pipefail

# Set the save-prefix to "~" to avoid caret (^) in package.json
prefix=$(npm config get save-prefix)
if [ "$prefix" != "~" ]; then
  npm config set save-prefix="~"
fi
# on error or exit, set it back
trap 'npm config set save-prefix="$prefix"' EXIT

# Function to get the release date of a package version
get_release_date() {
  local package=$1
  local version=$2
  # Strip the leading ^ or ~ from the version string
  version=${version//[^0-9.]/}
  # Fetch the package's release dates
  npm info "$package" time --json 2>/dev/null | grep "\"$version\"" | awk -F '"' '{print $4}'
}

# Function to update dependencies based on the target (patch, minor, latest)
update_dependencies() {
  local target=$1  # patch, minor, latest, newest, etc.
  local testcmd=$2    # test or empty

  echo "==== Running ncu to check for $target updates ===="

  # Run ncu to check for updates
  ncu_output=$(ncu --target "$target")

  if [ -z "$ncu_output" ]; then
    echo "No $target updates available."
    return
  fi

  # Temporary file to store updates with release dates
  temp_file=$(mktemp)
  
  # Extract the current and updated versions from the ncu output
  echo "$ncu_output" | grep -E "→" | while read -r line; do
      # Extract the package name and version details
      package=$(echo "$line" | awk '{print $1}')
      current_version=$(echo "$line" | awk '{print $2}')

      # Check if the current version contains ~ or ^, meaning it's updatable
      if [[ "$current_version" =~ [~^] ]]; then
        updated_version=$(echo "$line" | awk '{print $4}')
        
        release_date=$(get_release_date "$package" "$updated_version")
        # If no release date is found, set to a very old date to prevent breaking
        [[ -z "$release_date" ]] && release_date="1970-01-01T00:00:00.000Z"

        # Write to the temp file: date|package|updated_version
        echo "$release_date|$package|$current_version|$updated_version" >> "$temp_file"
      else
        echo "Skipping $package (fixed version: $current_version)"
      fi
  done

  # Sort updates by release date and process them
  sort "$temp_file" | while IFS='|' read -r release_date package current_version updated_version; do
      echo "Updating $package from $current_version to $updated_version ($target)"
      
      # Install updated package
      npm install "$package@$updated_version"

      # Run the second argument as a command if it is included and abort if it fails
      if [ -n "$testcmd" ]; then
        $testcmd || exit 1
      fi
   
      # Check if there are any changes to commit
      if [[ -n $(git diff --name-only) ]]; then
        # Commit the changes with version numbers in the message
        echo "Committing changes for $package $current_version → $updated_version"
        git add package.json package-lock.json
        git commit -m "$package $current_version → $updated_version"
      else
        echo "No changes detected for $package."
      fi
  done

  # Run npm audit fix to apply security patches
  echo "Running npm audit fix"
  npm audit fix
  if [[ -n $(git diff --name-only) ]]; then
    git add package.json package-lock.json
    git commit -m "Fix security vulnerabilities"
  fi

  # Clean up
  rm -f "$temp_file" 
}

# Step 1: Silently create or overwrite the npm-update branch
echo "Switching to branch 'npm-update' (or creating it if it doesn't exist)"
git checkout -B npm-update

# Step 2: Perform updates (patch, minor, latest) based on the first script argument
# if "patch" or none, run update_dependencies "patch"
if [ "$1" == "patch" ] || [ -z "$1" ]; then
  update_dependencies "patch" "$2"
fi
# if "minor" or none, run update_dependencies "minor"
if [ "$1" == "minor" ] || [ -z "$1" ]; then
  update_dependencies "minor" "$2"
fi
# if "latest" or none, run update_dependencies "latest"
if [ "$1" == "latest" ] || [ -z "$1" ]; then
  update_dependencies "latest" "$2"
fi

# Step 3: Instructions for squashing commits and merging
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
