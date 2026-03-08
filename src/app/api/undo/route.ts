import { NextRequest, NextResponse } from 'next/server';
import { deleteFilesByPrefix } from '@/lib/drive-api';
import { isAuthenticated } from '@/lib/google-auth';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { destId, prefix } = body;

        if (!destId) {
            return NextResponse.json({ error: 'Missing destination folder ID' }, { status: 400 });
        }

        const auth = await isAuthenticated();
        if (!auth) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const deletedCount = await deleteFilesByPrefix(destId, prefix || 'WM_');

        return NextResponse.json({
            success: true,
            deleted: deletedCount
        });

    } catch (error: any) {
        console.error('Failed to undo/delete files:', error);
        return NextResponse.json({ error: error.message || 'Failed to delete files' }, { status: 500 });
    }
}
