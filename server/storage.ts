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

  console.log('Resolved recordings path:', {
    basePath,
    recordingsPath,
    userId,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });

  return recordingsPath;
}

export async function ensureStorageDirectory(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    console.log('Ensuring audio storage directory exists:', recordingsPath);

    // Create all parent directories if needed
    await mkdir(recordingsPath, { recursive: true });

    // Set directory permissions to 755 (rwxr-xr-x)
    await chmod(recordingsPath, 0o755);

    // Verify directory is accessible
    await access(recordingsPath, constants.R_OK | constants.W_OK);

    // Create .gitignore in storage directory
    const gitignorePath = join(recordingsPath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, `*\n!.gitignore`);
    }

    // Log directory configuration
    const stats = await fs.stat(recordingsPath);
    console.log('Storage directory configured:', {
      path: recordingsPath,
      exists: existsSync(recordingsPath),
      mode: stats.mode.toString(8),
      timestamp: new Date().toISOString()
    });

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

// Enhanced file validation with better error handling
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

    // Check both old and new locations during transition
    const newPath = getRecordingsPath(userId);
    const oldPath = join(process.cwd(), 'recordings');

    const newFilePath = join(newPath, filename);
    const oldFilePath = join(oldPath, filename);

    console.log('Checking file locations:', {
      newPath: newFilePath,
      oldPath: oldFilePath,
      exists: {
        new: existsSync(newFilePath),
        old: existsSync(oldFilePath)
      },
      timestamp: new Date().toISOString()
    });

    // Try to access the file in both locations
    let filePath: string | null = null;
    if (existsSync(newFilePath)) {
      filePath = newFilePath;
    } else if (existsSync(oldFilePath)) {
      // If file exists in old location, move it to new location
      await ensureStorageDirectory(userId);
      await fs.copyFile(oldFilePath, newFilePath);
      await fs.unlink(oldFilePath);
      filePath = newFilePath;
      console.log('Moved file to new location:', {
        from: oldFilePath,
        to: newFilePath,
        timestamp: new Date().toISOString()
      });
    }

    if (!filePath) {
      console.error('File not found in any location:', {
        filename,
        userId,
        timestamp: new Date().toISOString()
      });
      return [false, 'File not found'];
    }

    // Set proper file permissions (644 - rw-r--r--)
    await chmod(filePath, 0o644);

    // Verify the file is associated with the user
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
      return [false, 'Unauthorized access'];
    }

    return [true, ''];
  } catch (error) {
    console.error('Audio file validation error:', {
      filename,
      userId,
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
    return [false, 'Internal validation error'];
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

    const files = await fs.readdir(recordingsPath);
    const allProjects = await db.query.projects.findMany({
      where: userId ? eq(projects.userId, userId) : undefined
    });

    const validRecordings = new Set(
      allProjects.map((p) => p.recordingUrl).filter(Boolean)
    );

    for (const file of files) {
      if (file === '.gitignore' || !file.match(/\.(webm|mp3|wav|ogg)$/i)) {
        continue;
      }

      if (!validRecordings.has(file)) {
        const filePath = join(recordingsPath, file);
        try {
          await fs.unlink(filePath);
          console.log('Deleted orphaned recording:', {
            filePath,
            userId,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('Failed to delete orphaned recording:', {
            filePath,
            userId,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  } catch (error) {
    console.error('Error during recordings cleanup:', {
      directory: recordingsPath,
      userId,
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
  }
}