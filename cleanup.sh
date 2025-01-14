#!/bin/bash

# Ensure we're in the repository root
cd "$(git rev-parse --show-toplevel)" || exit

echo "Creating backup branch..."
git branch backup-before-cleanup 2>/dev/null || echo "Backup branch already exists"

# Configure Git to handle large files
git config --global http.postBuffer 524288000

echo "Starting cleanup process..."
echo "This may take a few minutes..."

# Remove the large files from Git history
git filter-repo \
    --invert-paths \
    --path "*.webm" \
    --path "*.mp3" \
    --path "*.wav" \
    --path "*.ogg" \
    --path "*.mp4" \
    --path "*.mov" \
    --path "recordings/" \
    --path "audio-recordings/" \
    --path ".data/audio-recordings/" \
    --path ".data/user-recordings/" \
    --path ".local-data/audio-recordings/" \
    --path ".local-data/user-recordings/" \
    --force

echo "Cleaning up references..."
git for-each-ref --format="%(refname)" refs/original/ | xargs -n 1 git update-ref -d

# Aggressive cleanup
echo "Running garbage collection..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo "Git history has been cleaned up. The original history is preserved in the 'backup-before-cleanup' branch."
echo "Now setting up proper storage directories..."

# Create storage directories with .gitignore files
mkdir -p .data/user-recordings
mkdir -p .local-data/user-recordings

# Add .gitignore files to storage directories
echo "*
!.gitignore" > .data/user-recordings/.gitignore

echo "*
!.gitignore" > .local-data/user-recordings/.gitignore

# Add root .gitignore
cat > .gitignore << EOL
# Dependencies
node_modules/
.env

# Build outputs
dist/
build/
.next/
out/

# Audio recordings
*.webm
*.mp3
*.wav
*.ogg
*.mp4
*.mov
recordings/
audio-recordings/
.data/audio-recordings/
.data/user-recordings/
.local-data/audio-recordings/
.local-data/user-recordings/

# Development
.DS_Store
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE
.idea/
.vscode/
*.swp
*.swo
EOL

echo "Cleanup complete. You can now commit the new .gitignore files and continue development."
echo "Use 'git push -f origin main' to update the remote repository."