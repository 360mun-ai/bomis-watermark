import { NextResponse } from 'next/server';
import { getTokensFromCode, saveTokens } from '@/lib/google-auth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get('code');
        const error = searchParams.get('error');

        if (error) {
            console.error('OAuth Error:', error);
            return NextResponse.redirect(new URL('/?error=auth_failed', request.url));
        }

        if (!code) {
            return NextResponse.redirect(new URL('/?error=missing_code', request.url));
        }

        // Exchange the code for tokens
        const tokens = await getTokensFromCode(code);

        // Save tokens locally
        await saveTokens(tokens);

        // Redirect back to the main app dashboard
        return NextResponse.redirect(new URL('/?success=true', request.url));

    } catch (error: any) {
        console.error('Error in OAuth callback:', error);
        return NextResponse.redirect(new URL('/?error=token_exchange_failed', request.url));
    }
}
