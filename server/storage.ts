import { mkdir, access, constants } from 'fs/promises';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { db } from '@db';
import { projects } from '@db/schema';
import { eq, and } from 'drizzle-orm';

const VALID_EXTENSIONS = ['.webm', '.mp3', '.wav', '.ogg'];
const DEFAULT_PERMISSIONS = 0o666; // rw-rw-rw-
const DEFAULT_DIR_PERMISSIONS = 0o777; // rwxrwxrwx

// Get absolute path for recordings directory with user isolation
export function getRecordingsPath(userId?: number) {
  const basePath = join(process.cwd(), '.data');
  const recordingsPath = userId 
    ? join(basePath, 'recordings', `user-${userId}`)
    : join(basePath, 'recordings');

  return recordingsPath;
}

export async function ensureStorageDirectory(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    console.log('Ensuring audio storage directory exists:', recordingsPath);

    // Create directory with permissive permissions
    await mkdir(recordingsPath, { recursive: true, mode: DEFAULT_DIR_PERMISSIONS });

    // Double-check directory permissions after creation
    await fs.chmod(recordingsPath, DEFAULT_DIR_PERMISSIONS);

    // Create .gitignore if it doesn't exist
    const gitignorePath = join(recordingsPath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, '*\n!.gitignore');
      await fs.chmod(gitignorePath, DEFAULT_PERMISSIONS);
    }

    // Verify directory is accessible
    await access(recordingsPath, constants.R_OK | constants.W_OK);

    console.log('Storage directory configured:', {
      path: recordingsPath,
      exists: existsSync(recordingsPath),
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

// Get content type for response headers
export function getAudioContentType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  const mimeTypes: Record<string, string> = {
    '.webm': 'audio/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Validate audio file with enhanced error handling
export async function isValidAudioFile(filename: string, userId: number): Promise<[boolean, string]> {
  try {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

    // Basic extension validation
    if (!VALID_EXTENSIONS.includes(ext)) {
      return [false, 'Invalid file extension'];
    }

    const filePath = join(getRecordingsPath(), filename);

    // Check if file exists
    if (!existsSync(filePath)) {
      return [false, 'File not found'];
    }

    // Get file stats and verify size
    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      return [false, 'File is empty'];
    }

    // Verify file is readable
    try {
      await access(filePath, constants.R_OK);
      await fs.chmod(filePath, DEFAULT_PERMISSIONS);
      return [true, ''];
    } catch (error) {
      console.error('File access error:', {
        filename,
        userId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      return [false, 'File access denied'];
    }
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

// Cleanup orphaned recordings
export async function cleanupOrphanedRecordings(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    if (!existsSync(recordingsPath)) {
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
          console.log('Deleted orphaned recording:', filePath);
        } catch (error) {
          console.error('Failed to delete orphaned recording:', {
            filePath,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  } catch (error) {
    console.error('Error during recordings cleanup:', {
      directory: recordingsPath,
      error: error instanceof Error ? error.stack : String(error)
    });
  }
}