import { NextRequest } from 'next/server';
import { listImageFiles, downloadImage, uploadImage } from '@/lib/drive-api';
import { applyWatermark } from '@/lib/watermark';
import { isAuthenticated } from '@/lib/google-auth';
import pLimit from 'p-limit';

// Next.js config to allow streaming response for a long-running process
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sourceId, destId, applyTrim, specificFiles, concurrency: rawConcurrency } = body;
        const concurrency = Math.min(200, Math.max(1, Number(rawConcurrency) || 50));

        if ((!sourceId && (!specificFiles || specificFiles.length === 0)) || !destId) {
            return new Response('Missing sourceId or specificFiles, or destId', { status: 400 });
        }

        const auth = await isAuthenticated();
        if (!auth) {
            return new Response('Not authenticated', { status: 401 });
        }

        // Set up SSE (Server-Sent Events) headers
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (data: any) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                };

                try {
                    sendEvent({ status: 'fetching_list', progress: 0 });

                    // 1. Fetch images from drive or use specific error list provided
                    const files = (specificFiles && specificFiles.length > 0)
                        ? specificFiles
                        : await listImageFiles(sourceId);

                    if (files.length === 0) {
                        sendEvent({ status: 'error', message: 'No images found to process.' });
                        controller.close();
                        return;
                    }

                    sendEvent({
                        status: 'processing',
                        total: files.length,
                        processed: 0,
                        progress: 0
                    });

                    // 2. Set up concurrency pool (user-configurable)
                    const limit = pLimit(concurrency);
                    let processedCount = 0;
                    let errorFiles: any[] = [];

                    // 3. Process each image in the bounded pool
                    const tasks = files.map((file: any) =>
                        limit(async () => {
                            try {
                                // Download
                                const sourceBuffer = await downloadImage(file.id);

                                // Watermark
                                const processedBuffer = await applyWatermark(sourceBuffer, applyTrim === true || applyTrim === 'true');

                                // Upload (Save with prefixed name)
                                await uploadImage(destId, `WM_${file.name}`, processedBuffer, file.mimeType);

                                processedCount++;
                            } catch (err: any) {
                                console.error(`Failed to process file ${file.name}:`, err);
                                // Output real file objects to retry them completely
                                errorFiles.push(file);
                            } finally {
                                // Report progress after every individual file
                                const percentage = Math.round((processedCount / files.length) * 100);
                                sendEvent({
                                    status: 'processing',
                                    total: files.length,
                                    processed: processedCount,
                                    errors: errorFiles.length,
                                    errorFiles: errorFiles,
                                    progress: percentage
                                });
                            }
                        })
                    );

                    // Wait for all promises in the pool to resolve
                    await Promise.all(tasks);

                    // 4. Finish
                    sendEvent({
                        status: 'complete',
                        total: files.length,
                        processed: processedCount,
                        errors: errorFiles.length,
                        errorFiles: errorFiles,
                        progress: 100
                    });

                } catch (error: any) {
                    console.error('Fatal batch error:', error);
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
    } catch (e: any) {
        return new Response('Unhandled Server Error: ' + e.message, { status: 500 });
    }
}
