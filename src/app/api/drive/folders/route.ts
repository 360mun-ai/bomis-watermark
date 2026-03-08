import { NextResponse } from 'next/server';
import { listFolders } from '@/lib/drive-api';
import { isAuthenticated } from '@/lib/google-auth';

export async function GET() {
    try {
        const auth = await isAuthenticated();

        if (!auth) {
            return NextResponse.json({ error: 'Not authenticated with Google Drive' }, { status: 401 });
        }

        const folders = await listFolders();
        return NextResponse.json({ folders });
    } catch (error: any) {
        console.error('Error fetching folders:', error);
        return NextResponse.json(
            { error: 'Failed to fetch folders.' },
            { status: 500 }
        );
    }
}
