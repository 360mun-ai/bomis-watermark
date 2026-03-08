import { getAuthenticatedClient } from './google-auth';
import { google } from 'googleapis';

// Interface for Drive folders
export interface DriveFolder {
    id: string;
    name: string;
}

// Interace for Drive files
export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
}

// Returns a drive client
async function getDriveClient() {
    const auth = await getAuthenticatedClient();
    return google.drive({ version: 'v3', auth });
}

// Fetch all folders the user has access to
export async function listFolders(): Promise<DriveFolder[]> {
    const drive = await getDriveClient();
    const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields: 'files(id, name)',
        orderBy: 'name',
        pageSize: 1000,
    });

    return (res.data.files as DriveFolder[]) || [];
}

// Fetch all images inside a specific folder
export async function listImageFiles(folderId: string): Promise<DriveFile[]> {
    const drive = await getDriveClient();
    let allFiles: DriveFile[] = [];
    let pageToken: string | undefined;

    do {
        const res = await drive.files.list({
            // Only fetch images that are not trashed inside the specified folder
            q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 1000,
            pageToken: pageToken
        });

        if (res.data.files) {
            allFiles = allFiles.concat(res.data.files as DriveFile[]);
        }
        pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return allFiles;
}

// Fetch all video files inside a specific folder
export async function listVideoFiles(folderId: string): Promise<DriveFile[]> {
    const drive = await getDriveClient();
    const res = await drive.files.list({
        // Fetch videos (mp4, quicktime/mov) that are not trashed
        q: `'${folderId}' in parents and mimeType contains 'video/' and trashed=false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 1000,
    });

    return (res.data.files as DriveFile[]) || [];
}

// Download an image file as an ArrayBuffer
export async function downloadImage(fileId: string): Promise<ArrayBuffer> {
    const drive = await getDriveClient();
    const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
    );
    return res.data as ArrayBuffer;
}

// Upload a processed image buffer to a specific folder
export async function uploadImage(
    folderId: string,
    fileName: string,
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg'
): Promise<string> {
    const drive = await getDriveClient();

    // We convert the buffer to a readable stream for the Google API
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(imageBuffer);
    stream.push(null);

    const fileMetadata = {
        name: fileName,
        parents: [folderId],
    };

    const media = {
        mimeType: mimeType,
        body: stream,
    };

    const res = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
    });

    return res.data.id || '';
}

// Download a large video file streaming directly to disk (prevents RAM crashes)
export async function downloadVideoToDisk(fileId: string, destinationPath: string): Promise<void> {
    const drive = await getDriveClient();
    const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' }
    );

    const fs = require('fs');
    return new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(destinationPath);
        res.data
            .on('end', () => resolve())
            .on('error', (err: any) => reject(err))
            .pipe(dest);
    });
}

// Upload a large video file streaming directly from disk
export async function uploadVideoFromDisk(
    folderId: string,
    fileName: string,
    filePath: string,
    mimeType: string
): Promise<string> {
    const drive = await getDriveClient();
    const fs = require('fs');

    const fileMetadata = {
        name: fileName,
        parents: [folderId],
    };

    const media = {
        mimeType: mimeType,
        body: fs.createReadStream(filePath),
    };

    const res = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
    });

    return res.data.id || '';
}

// Delete a specific file by its ID
export async function deleteFile(fileId: string): Promise<void> {
    const drive = await getDriveClient();
    await drive.files.delete({
        fileId: fileId
    });
}

// Find and delete all files in a folder that start with a specific prefix
export async function deleteFilesByPrefix(folderId: string, prefix: string): Promise<number> {
    const drive = await getDriveClient();
    let deletedCount = 0;
    let pageToken: string | undefined;

    do {
        // Query to find files in the folder that start with the given prefix
        const res = await drive.files.list({
            q: `'${folderId}' in parents and name contains '${prefix}' and trashed=false`, // Note: 'contains' in Drive API matches word boundaries
            fields: 'nextPageToken, files(id, name)',
            pageSize: 100,
            pageToken: pageToken
        });

        if (res.data.files) {
            for (const file of res.data.files) {
                // Ensure it explicitly starts with the prefix since 'contains' might be too broad
                if (file.name && file.name.startsWith(prefix) && file.id) {
                    await deleteFile(file.id);
                    deletedCount++;
                }
            }
        }
        pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    return deletedCount;
}
