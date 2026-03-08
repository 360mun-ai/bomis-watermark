import { NextResponse } from 'next/server';
import { downloadVideoToDisk, uploadVideoFromDisk } from '@/lib/drive-api';
import { applyVideoWatermark } from '@/lib/video-watermark';
import { getVideoQueue, dequeueVideo } from '@/lib/state-store';
import { isAuthenticated } from '@/lib/google-auth';
import pLimit from 'p-limit';
import path from 'path';
import fs from 'fs/promises';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const destId = searchParams.get('destId');

    if (!destId) {
        return new Response('Missing destId', { status: 400 });
    }

    const auth = await isAuthenticated();
    if (!auth) {
        return new Response('Not authenticated', { status: 401 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (data: any) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            try {
                sendEvent({ status: 'fetching_queue', progress: 0 });

                const videos = await getVideoQueue();
                if (videos.length === 0) {
                    sendEvent({ status: 'error', message: 'No queued videos found to process.' });
                    controller.close();
                    return;
                }

                sendEvent({
                    status: 'processing',
                    total: videos.length,
                    processed: 0,
                    progress: 0
                });

                // Ensure tmp directory exists
                const tmpDir = path.join(process.cwd(), 'tmp');
                await fs.mkdir(tmpDir, { recursive: true });

                // Process strictly 1 video at a time completely so we don't melt the disk or CPU
                const limit = pLimit(1);
                let processedCount = 0;
                let errorFiles: any[] = [];

                const tasks = videos.map((video) =>
                    limit(async () => {
                        const inputPath = path.join(tmpDir, `in_${video.id}.mp4`);
                        const outputPath = path.join(tmpDir, `out_${video.id}.mp4`);

                        try {
                            // 1. Stream video from Drive to Local Disk
                            await downloadVideoToDisk(video.id, inputPath);

                            // 2. Apply Watermark via FFmpeg
                            await applyVideoWatermark(inputPath, outputPath);

                            // 3. Upload Result back to Drive
                            await uploadVideoFromDisk(destId, `WM_${video.name}`, outputPath, video.mimeType);

                            // 4. Remove from pending State Queue
                            await dequeueVideo(video.id);

                            processedCount++;
                        } catch (err: any) {
                            console.error(`Failed to process video ${video.name}:`, err);
                            errorFiles.push(video);
                        } finally {
                            // 5. Cleanup Local Disk 
                            await fs.unlink(inputPath).catch(() => { });
                            await fs.unlink(outputPath).catch(() => { });

                            const percentage = Math.round((processedCount / videos.length) * 100);
                            sendEvent({
                                status: 'processing',
                                total: videos.length,
                                processed: processedCount,
                                errors: errorFiles.length,
                                errorFiles: errorFiles,
                                progress: percentage
                            });
                        }
                    })
                );

                await Promise.all(tasks);

                sendEvent({
                    status: 'complete',
                    total: videos.length,
                    processed: processedCount,
                    errors: errorFiles.length,
                    errorFiles: errorFiles,
                    progress: 100
                });

            } catch (error: any) {
                console.error('Fatal video batch error:', error);
                sendEvent({ status: 'error', message: error.message });

            } finally {
                controller.close();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
