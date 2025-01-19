import { mkdir, access, constants, chmod } from 'fs/promises';
import { existsSync, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { db } from '@db';
import { projects, type SelectUser } from '@db/schema';
import { eq, and } from 'drizzle-orm';

// Get absolute path for recordings directory with user isolation
export function getRecordingsPath(userId?: number) {
  // Always use .data directory for consistency across environments
  const basePath = join(process.cwd(), '.data');
  const recordingsPath = userId 
    ? join(basePath, 'recordings', `user-${userId}`)
    : join(basePath, 'recordings');

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

    // Create all parent directories if needed with more permissive permissions
    await mkdir(recordingsPath, { recursive: true, mode: 0o777 });

    // Set directory permissions to 777 for development environments
    await chmod(recordingsPath, 0o777);

    // Verify directory is accessible
    await access(recordingsPath, fs.constants.R_OK | fs.constants.W_OK);

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

    // Check in the recordings directory
    const recordingsPath = getRecordingsPath();
    const filePath = join(recordingsPath, filename);

    console.log('Checking file location:', {
      path: filePath,
      exists: existsSync(filePath),
      timestamp: new Date().toISOString()
    });

    if (!existsSync(filePath)) {
      console.error('File not found:', {
        filename,
        userId,
        timestamp: new Date().toISOString()
      });
      return [false, 'File not found'];
    }

    // Set proper file permissions (666 - rw-rw-rw-)
    await chmod(filePath, 0o666);

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