#!/bin/bash

# Ensure we're in the repository root
cd "$(dirname "$0")" || exit

echo "Starting recordings cleanup..."

# Create proper storage directory structure
mkdir -p .data/user-recordings/default

# Add .gitignore to storage directory
echo "*
!.gitignore" > .data/user-recordings/.gitignore

# Remove any existing recordings from old locations
find . -type f \( -name "*.webm" -o -name "*.mp3" -o -name "*.wav" -o -name "*.ogg" -o -name "*.mp4" -o -name "*.mov" \) \
  -not -path "*.data/user-recordings/*" \
  -delete

echo "Recordings cleanup complete"