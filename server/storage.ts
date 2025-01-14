import { mkdir, access, constants, chmod } from 'fs/promises';
import { existsSync, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { db } from '@db';
import { projects, type SelectUser } from '@db/schema';
import { eq, and } from 'drizzle-orm';

// Get absolute path for recordings directory with user isolation
export function getRecordingsPath(userId?: number) {
  // Consistently use .local-data for development and .data for production
  const basePath = process.env.NODE_ENV === 'production' 
    ? join(process.cwd(), '.data')
    : join(process.cwd(), '.local-data');

  // Always use user-specific subdirectory for better isolation
  const recordingsPath = userId 
    ? join(basePath, 'user-recordings', `user-${userId}`)
    : join(basePath, 'user-recordings', 'default');

  return recordingsPath;
}

export async function ensureStorageDirectory(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    // Create all parent directories if needed
    await mkdir(recordingsPath, { recursive: true });

    // Set directory permissions to 755 (rwxr-xr-x)
    await chmod(recordingsPath, 0o755);

    // Create .gitignore in storage directory if it doesn't exist
    const gitignorePath = join(recordingsPath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, '*\n!.gitignore');
      await chmod(gitignorePath, 0o644);
    }

    // Verify directory is accessible
    await access(recordingsPath, constants.R_OK | constants.W_OK);

    return recordingsPath;
  } catch (error) {
    console.error('Failed to configure storage directory:', {
      path: recordingsPath,
      error: error instanceof Error ? error.stack : String(error),
      userId: userId || 'default',
      timestamp: new Date().toISOString()
    });
    throw new Error(`Failed to configure storage directory: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function isValidAudioFile(filename: string, userId: number): Promise<[boolean, string]> {
  try {
    const validExtensions = ['.webm', '.mp3', '.wav', '.ogg'];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

    if (!validExtensions.includes(ext)) {
      return [false, 'Invalid file extension'];
    }

    // Ensure storage directory exists and get the path
    const recordingsPath = await ensureStorageDirectory(userId);
    const filePath = join(recordingsPath, filename);

    if (!existsSync(filePath)) {
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

// Initialize storage on application startup
export async function initializeStorage() {
  try {
    // Create base directories first
    const prodPath = join(process.cwd(), '.data');
    const devPath = join(process.cwd(), '.local-data');

    await Promise.all([
      mkdir(prodPath, { recursive: true }),
      mkdir(devPath, { recursive: true })
    ]);

    // Set base directory permissions
    await Promise.all([
      chmod(prodPath, 0o755),
      chmod(devPath, 0o755)
    ]);

    // Create user recordings directories
    const prodUserPath = join(prodPath, 'user-recordings');
    const devUserPath = join(devPath, 'user-recordings');

    await Promise.all([
      mkdir(prodUserPath, { recursive: true }),
      mkdir(devUserPath, { recursive: true })
    ]);

    // Set user recordings directory permissions
    await Promise.all([
      chmod(prodUserPath, 0o755),
      chmod(devUserPath, 0o755)
    ]);

    // Create default user directories
    const prodDefaultPath = join(prodUserPath, 'default');
    const devDefaultPath = join(devUserPath, 'default');

    await Promise.all([
      mkdir(prodDefaultPath, { recursive: true }),
      mkdir(devDefaultPath, { recursive: true })
    ]);

    // Set default user directory permissions
    await Promise.all([
      chmod(prodDefaultPath, 0o755),
      chmod(devDefaultPath, 0o755)
    ]);

    // Create .gitignore files if they don't exist
    const prodGitignore = join(prodUserPath, '.gitignore');
    const devGitignore = join(devUserPath, '.gitignore');

    if (!existsSync(prodGitignore)) {
      await fs.writeFile(prodGitignore, '*\n!.gitignore');
      await chmod(prodGitignore, 0o644);
    }

    if (!existsSync(devGitignore)) {
      await fs.writeFile(devGitignore, '*\n!.gitignore');
      await chmod(devGitignore, 0o644);
    }

    // Verify all directories are accessible
    try {
      await Promise.all([
        access(prodPath, constants.R_OK | constants.W_OK),
        access(devPath, constants.R_OK | constants.W_OK),
        access(prodUserPath, constants.R_OK | constants.W_OK),
        access(devUserPath, constants.R_OK | constants.W_OK),
        access(prodDefaultPath, constants.R_OK | constants.W_OK),
        access(devDefaultPath, constants.R_OK | constants.W_OK)
      ]);
    } catch (error) {
      throw new Error(`Storage directories are not accessible: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log('Storage system initialized successfully:', {
      prod: {
        base: prodPath,
        recordings: prodUserPath,
        default: prodDefaultPath
      },
      dev: {
        base: devPath,
        recordings: devUserPath,
        default: devDefaultPath
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to initialize storage system:', {
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

export async function cleanupOrphanedRecordings(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
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
            userId: userId || 'default',
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('Failed to delete orphaned recording:', {
            filePath,
            userId: userId || 'default',
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  } catch (error) {
    console.error('Error during recordings cleanup:', {
      directory: recordingsPath,
      userId: userId || 'default',
      error: error instanceof Error ? error.stack : String(error),
      timestamp: new Date().toISOString()
    });
  }
}