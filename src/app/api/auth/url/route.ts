import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google-auth';

export async function GET() {
    try {
        const url = getAuthUrl();
        return NextResponse.json({ url });
    } catch (error: any) {
        console.error('Error generating auth URL:', error);
        return NextResponse.json(
            { error: 'Failed to generate authentication URL. Check your environment variables.' },
            { status: 500 }
        );
    }
}
