import { mkdir, access, constants, chmod } from 'fs/promises';
import { existsSync, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { db } from '@db';
import { projects, type SelectUser } from '@db/schema';
import { eq, and } from 'drizzle-orm';

// Get absolute path for recordings directory with user isolation
export function getRecordingsPath(userId?: number) {
  // In production/staging, recordings are stored in the persistent .data directory
  // In development, they're stored in the project root
  const basePath = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging'
    ? join(process.cwd(), '.data')
    : join(process.cwd(), '.local-data');

  // Create user-specific subdirectory if userId is provided
  const recordingsPath = userId 
    ? join(basePath, 'user-recordings', `user-${userId}`)
    : join(basePath, 'audio-recordings');

  return recordingsPath;
}

export async function ensureStorageDirectory(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    console.log('Ensuring audio storage directory exists:', recordingsPath);

    // Create all parent directories if needed
    await mkdir(recordingsPath, { recursive: true });

    // Set directory permissions - allow read/write/execute for owner and read/execute for others
    await chmod(recordingsPath, 0o755);

    // Verify directory is accessible
    await access(recordingsPath, constants.R_OK | constants.W_OK);

    // Create .gitignore in each storage directory to ensure audio files are never tracked
    const localGitignorePath = join(recordingsPath, '.gitignore');
    if (!existsSync(localGitignorePath)) {
      await fs.writeFile(localGitignorePath, `
# Ignore all audio files
*
!.gitignore
`.trim());
    }

    return recordingsPath;
  } catch (error) {
    console.error('Failed to configure storage directory:', {
      path: recordingsPath,
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

// Enhanced file validation with improved user ownership check
export async function isValidAudioFile(filename: string, userId: number): Promise<[boolean, string]> {
  try {
    const validExtensions = ['.webm', '.mp3', '.wav', '.ogg'];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

    if (!validExtensions.includes(ext)) {
      console.warn('Invalid audio file extension:', {
        filename,
        extension: ext,
        userId,
        timestamp: new Date().toISOString()
      });
      return [false, 'Invalid file extension'];
    }

    const recordingsPath = getRecordingsPath(userId);
    const filePath = join(recordingsPath, filename);

    console.log('Validating audio file:', {
      filename,
      filePath,
      userId,
      exists: existsSync(filePath),
      timestamp: new Date().toISOString()
    });

    try {
      await access(filePath, constants.R_OK);
    } catch (error) {
      console.error('File access error:', {
        filePath,
        userId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      return [false, 'File not found or not accessible'];
    }

    // Verify user ownership through database
    const [project] = await db.query.projects.findMany({
      where: and(
        eq(projects.userId, userId),
        eq(projects.recordingUrl, filename)
      ),
      limit: 1,
    });

    if (!project) {
      console.warn('Unauthorized file access attempt:', {
        filename,
        userId,
        timestamp: new Date().toISOString()
      });
      return [false, 'Unauthorized access - Recording not found in user projects'];
    }

    return [true, ''];
  } catch (error) {
    console.error('Audio file validation error:', {
      filename,
      userId,
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
    return [false, 'Internal validation error - ' + (error instanceof Error ? error.message : String(error))];
  }
}

// Add helper for getting content type
export const getAudioContentType = (filename: string): string => {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  const mimeTypes: Record<string, string> = {
    '.webm': 'audio/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg'
  };

  return mimeTypes[ext] || 'application/octet-stream';
};

// Enhanced cleanup function with better error handling and logging
export async function cleanupOrphanedRecordings(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    console.log('Starting cleanup of orphaned recordings:', {
      directory: recordingsPath,
      userId,
      timestamp: new Date().toISOString()
    });

    if (!existsSync(recordingsPath)) {
      console.log('No recordings directory found to clean:', recordingsPath);
      return;
    }

    // Get list of files in recordings directory
    const files = await fs.readdir(recordingsPath);

    // Get all projects from database to check valid recordings
    const allProjects = await db.query.projects.findMany({
      where: userId ? eq(projects.userId, userId) : undefined
    });

    const validRecordings = new Set(
      allProjects.map((p) => p.recordingUrl).filter(Boolean)
    );

    let cleanedCount = 0;
    let errorCount = 0;

    // Check each file in the directory
    for (const file of files) {
      // Skip temp files and non-audio files
      if (file.startsWith('temp_') || !file.match(/\.(webm|mp3|wav|ogg)$/i)) {
        continue;
      }

      // If the file isn't associated with any project, delete it
      if (!validRecordings.has(file)) {
        const filePath = join(recordingsPath, file);
        try {
          await fs.unlink(filePath);
          cleanedCount++;
          console.log('Deleted orphaned recording:', {
            filePath,
            userId,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          errorCount++;
          console.error('Failed to delete orphaned recording:', {
            filePath,
            userId,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    console.log('Cleanup completed:', {
      directory: recordingsPath,
      filesProcessed: files.length,
      filesDeleted: cleanedCount,
      errorCount,
      userId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error during recordings cleanup:', {
      directory: recordingsPath,
      userId,
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
  }
}