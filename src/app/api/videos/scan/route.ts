import { NextRequest, NextResponse } from 'next/server';
import { listVideoFiles } from '@/lib/drive-api';
import { enqueueVideos } from '@/lib/state-store';
import { isAuthenticated } from '@/lib/google-auth';

// Force dynamic execution for API routes interacting with external APIs
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const auth = await isAuthenticated();
        if (!auth) {
            return new NextResponse('Not authenticated', { status: 401 });
        }

        const body = await request.json();
        const sourceId = body.sourceId;

        if (!sourceId) {
            return new NextResponse('Missing sourceId', { status: 400 });
        }

        // Fetch videos from the drive folder
        const videos = await listVideoFiles(sourceId);

        // If videos are found, save them to local JSON state permanently
        if (videos.length > 0) {
            await enqueueVideos(videos);
        }

        return NextResponse.json({
            success: true,
            found: videos.length,
            message: `Found ${videos.length} videos and synced to local queue.`
        });

    } catch (error: any) {
        console.error('Error scanning videos:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
