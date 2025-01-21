#!/bin/bash

# Ensure we're in the repository root
cd "$(dirname "$0")" || exit

echo "Starting recordings cleanup..."

# Create proper storage directories
mkdir -p .data/user-recordings
mkdir -p .local-data/user-recordings

# Add .gitignore to storage directories
echo "*
!.gitignore" > .data/user-recordings/.gitignore
echo "*
!.gitignore" > .local-data/user-recordings/.gitignore

# Remove any existing recordings (audio and video) from Git-tracked directories
find . -type f \( -name "*.webm" -o -name "*.mp3" -o -name "*.wav" -o -name "*.ogg" -o -name "*.mp4" -o -name "*.mov" \) -not -path "*.data/*" -not -path "*.local-data/*" -delete

echo "Recordings cleanup complete"