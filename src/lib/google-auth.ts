import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';

// Store tokens locally in the project root for this specific personal app
const TOKEN_PATH = path.join(process.cwd(), 'tokens.json');

// Get the OAuth2 client configured with local environment variables
export function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Google OAuth credentials are not set in the environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Generate the URL that the user will click to authenticate
export function getAuthUrl() {
  const oauth2Client = getOAuth2Client();

  const scopes = [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file', // Needed to upload processed files
    'https://www.googleapis.com/auth/drive'       // Needed to rename existing folder contents
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline', // Requests a refresh token
    scope: scopes,
    prompt: 'consent' // Forces consent screen to ensure we get a refresh token
  });
}

// Exchange the authorization code (from the callback URL) for tokens
export async function getTokensFromCode(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Save the tokens to the local JSON file
export async function saveTokens(tokens: any) {
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

// Load the tokens from the local JSON file
export async function loadTokens() {
  try {
    const data = await fs.readFile(TOKEN_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error: any) {
    // If file doesn't exist or isn't valid JSON, return null
    if (error.code === 'ENOENT' || error.name === 'SyntaxError') {
      return null;
    }
    throw error;
  }
}

// Check if the user is authenticated (tokens exist and are valid)
export async function isAuthenticated() {
  const tokens = await loadTokens();
  if (!tokens) return false;

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Consider the user authenticated if we have credentials
  // The google-auth-library auto-refreshes if we have a refresh token
  return true;
}

// Get an authenticated client ready to make API calls
export async function getAuthenticatedClient() {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('Not authenticated. No tokens found.');
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  // Setup automatic token saving if they are refreshed
  oauth2Client.on('tokens', async (newTokens) => {
    // If a new refresh token is sent, update it, otherwise just update access token
    const currentTokens = await loadTokens() || {};
    const updatedTokens = {
      ...currentTokens,
      ...newTokens
    };
    await saveTokens(updatedTokens);
  });

  return oauth2Client;
}
