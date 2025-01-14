import { mkdir, access, constants, chmod } from 'fs/promises';
import { existsSync, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { db } from '@db';
import { projects, type SelectUser } from '@db/schema';
import { eq, and } from 'drizzle-orm';

// Get absolute path for recordings directory with user isolation
export function getRecordingsPath(userId?: number) {
  const basePath = join(process.cwd(), '.data');
  const recordingsPath = userId 
    ? join(basePath, 'user-recordings', `user-${userId}`)
    : join(basePath, 'user-recordings', 'default');

  return recordingsPath;
}

export async function ensureStorageDirectory(userId?: number) {
  const recordingsPath = getRecordingsPath(userId);

  try {
    // Create directory with all parent directories
    await mkdir(recordingsPath, { recursive: true });

    // Set directory permissions to 755 (rwxr-xr-x)
    await chmod(recordingsPath, 0o755);

    // Create .gitignore if it doesn't exist
    const gitignorePath = join(recordingsPath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      await fs.writeFile(gitignorePath, '*\n!.gitignore');
      await chmod(gitignorePath, 0o644);
    }

    return recordingsPath;
  } catch (error) {
    console.error('Storage directory configuration failed:', error);
    throw error;
  }
}

export async function isValidAudioFile(filename: string, userId: number): Promise<[boolean, string]> {
  try {
    const validExtensions = ['.webm', '.mp3', '.wav', '.ogg'];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

    if (!validExtensions.includes(ext)) {
      return [false, 'Invalid file extension'];
    }

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
    console.error('Audio file validation error:', error);
    return [false, 'Internal validation error'];
  }
}

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
          console.error('Failed to delete orphaned recording:', filePath, error);
        }
      }
    }
  } catch (error) {
    console.error('Error during recordings cleanup:', error);
  }
}