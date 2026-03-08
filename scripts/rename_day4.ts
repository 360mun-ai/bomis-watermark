import { getAuthenticatedClient } from '../src/lib/google-auth';
import { google } from 'googleapis';
import pLimit from 'p-limit'; // Using the pre-installed p-limit for speed

async function main() {
    const FOLDER_ID = '1LCkpZbAz2MLaDjqExl_QgC2aCpWQfKJi';

    console.log("Authenticating...");
    const auth = await getAuthenticatedClient();
    const drive = google.drive({ version: 'v3', auth });

    console.log(`Fetching files for folder ID: ${FOLDER_ID}`);
    // Fetch files in the folder
    let pageToken: string | undefined;
    let allFiles: any[] = [];
    do {
        const res = await drive.files.list({
            q: `'${FOLDER_ID}' in parents and trashed=false`,
            fields: 'nextPageToken, files(id, name)',
            pageToken: pageToken,
            pageSize: 1000,
        });
        if (res.data.files) {
            allFiles = allFiles.concat(res.data.files);
        }
        pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    console.log(`Found ${allFiles.length} files in the folder.`);

    const limit = pLimit(20); // 20 concurrent connections to Google
    let renamedCount = 0;

    // We build the rename tasks array
    const tasks = allFiles.map((file) =>
        limit(async () => {
            if (!file.name) return;
            // Find if it has _2_day4 at the end (before any extension)
            const matches = file.name.match(/^(.*?)_2_day4(\.[a-zA-Z0-9]+)?$/);

            if (matches) {
                const baseName = matches[1];
                const extension = matches[2] || '';
                const newName = `2_day4_${baseName}${extension}`;

                console.log(`Renaming: ${file.name} --> ${newName}`);

                try {
                    await drive.files.update({
                        fileId: file.id,
                        requestBody: {
                            name: newName
                        }
                    });
                    renamedCount++;
                } catch (err) {
                    console.error(`Failed to rename ${file.name}`, err);
                }
            }
        })
    );

    // Run them in parallel
    await Promise.all(tasks);

    console.log(`Renaming complete. Total files processed: ${renamedCount}`);
}

main().catch(console.error);
