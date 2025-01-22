import { mkdir, access, constants } from 'fs/promises';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';
import { db } from '@db';
import { projects } from '@db/schema';
import { eq, and } from 'drizzle-orm';

const VALID_EXTENSIONS = ['.webm', '.mp3', '.wav', '.ogg'];
const DEFAULT_PERMISSIONS = 0o644; // rw-r--r--
const DEFAULT_DIR_PERMISSIONS = 0o755; // rwxr-xr-x

// Get absolute path for recordings directory with user isolation
export function getRecordingsPath(userId?: number) {
  const basePath = join(process.cwd(), '.data', 'recordings');
  return userId ? join(basePath, `user-${userId}`) : basePath;
}

export async function ensureStorageDirectory(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    console.log('Ensuring audio storage directory exists:', recordingsPath);

    // Create base directory with proper permissions
    await mkdir(recordingsPath, { recursive: true, mode: DEFAULT_DIR_PERMISSIONS });

    // Ensure proper directory permissions
    await fs.chmod(recordingsPath, DEFAULT_DIR_PERMISSIONS);

    // Create .gitignore if it doesn't exist
    const gitignorePath = join(recordingsPath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, '*\n!.gitignore\n');
      await fs.chmod(gitignorePath, DEFAULT_PERMISSIONS);
    }

    // Verify directory is accessible
    await access(recordingsPath, constants.R_OK | constants.W_OK);

    // Log directory status
    const dirStats = await fs.stat(recordingsPath);
    console.log('Storage directory configured:', {
      path: recordingsPath,
      exists: existsSync(recordingsPath),
      mode: dirStats.mode.toString(8),
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
    const recordingsPath = getRecordingsPath(userId);
    const filePath = join(recordingsPath, filename);

    console.log('Validating audio file:', {
      filename,
      userId,
      path: filePath,
      exists: existsSync(filePath),
      timestamp: new Date().toISOString()
    });

    // Basic extension validation
    if (!VALID_EXTENSIONS.includes(ext)) {
      return [false, 'Invalid file extension'];
    }

    // Check if file exists
    if (!existsSync(filePath)) {
      return [false, 'File not found'];
    }

    // Get file stats and verify size
    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
      return [false, 'File is empty'];
    }

    // Log file permissions
    console.log('File permissions:', {
      filename,
      mode: stats.mode.toString(8),
      size: stats.size,
      timestamp: new Date().toISOString()
    });

    // Verify file is readable and set proper permissions
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

// Cleanup orphaned recordings with improved logging
export async function cleanupOrphanedRecordings(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    if (!existsSync(recordingsPath)) {
      console.log('Recordings directory does not exist:', recordingsPath);
      return;
    }

    const files = await fs.readdir(recordingsPath);

    // Get all valid recordings from database
    const allProjects = await db.query.projects.findMany({
      where: userId ? eq(projects.userId, userId) : undefined,
      columns: {
        recordingUrl: true,
      }
    });

    const validRecordings = new Set(allProjects.map(p => p.recordingUrl).filter(Boolean));
    console.log('Found valid recordings:', {
      count: validRecordings.size,
      path: recordingsPath,
      timestamp: new Date().toISOString()
    });

    for (const file of files) {
      if (file === '.gitignore' || !file.match(/\.(webm|mp3|wav|ogg)$/i)) {
        continue;
      }

      const filePath = join(recordingsPath, file);
      const stats = await fs.stat(filePath);

      console.log('Checking recording:', {
        filename: file,
        size: stats.size,
        mode: stats.mode.toString(8),
        isValid: validRecordings.has(file),
        timestamp: new Date().toISOString()
      });

      if (!validRecordings.has(file)) {
        try {
          await fs.unlink(filePath);
          console.log('Deleted orphaned recording:', filePath);
        } catch (error) {
          console.error('Failed to delete orphaned recording:', {
            filePath,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      } else {
        // Ensure proper permissions for valid files
        await fs.chmod(filePath, DEFAULT_PERMISSIONS);
      }
    }
  } catch (error) {
    console.error('Error during recordings cleanup:', {
      directory: recordingsPath,
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
  }
}