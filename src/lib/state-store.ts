import fs from 'fs/promises';
import path from 'path';
import { DriveFile } from './drive-api';

const STATE_FILE_PATH = path.join(process.cwd(), 'video_queue.json');

// Get currently queued videos
export async function getVideoQueue(): Promise<DriveFile[]> {
    try {
        const data = await fs.readFile(STATE_FILE_PATH, 'utf-8');
        return JSON.parse(data) as DriveFile[];
    } catch (error: any) {
        if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
            return []; // No queue exists yet or it's malformed
        }
        throw error;
    }
}

// Add new videos to the queue (avoiding duplicates by ID)
export async function enqueueVideos(newVideos: DriveFile[]): Promise<void> {
    const currentQueue = await getVideoQueue();

    const queueMap = new Map(currentQueue.map(v => [v.id, v]));

    // Add new videos
    for (const v of newVideos) {
        queueMap.set(v.id, v);
    }

    const updatedQueue = Array.from(queueMap.values());

    await fs.writeFile(STATE_FILE_PATH, JSON.stringify(updatedQueue, null, 2));
}

// Clear or process a specific video by saving state
export async function dequeueVideo(videoId: string): Promise<void> {
    const currentQueue = await getVideoQueue();
    const updatedQueue = currentQueue.filter(v => v.id !== videoId);
    await fs.writeFile(STATE_FILE_PATH, JSON.stringify(updatedQueue, null, 2));
}
