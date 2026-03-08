import { NextResponse } from 'next/server';
import { getVideoQueue } from '@/lib/state-store';
import { isAuthenticated } from '@/lib/google-auth';

// Ensure the endpoint doesn't cache the local file
export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const auth = await isAuthenticated();
        if (!auth) {
            return new NextResponse('Not authenticated', { status: 401 });
        }

        const queue = await getVideoQueue();

        return NextResponse.json({ success: true, queue });
    } catch (error: any) {
        console.error('Error fetching video queue:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
