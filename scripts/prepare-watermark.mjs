/**
 * Helper script: Prepare your watermark PNG
 * 
 * Run this script to remove the white background from your BOMIS logo
 * and save it as a transparent PNG ready for watermarking.
 * 
 * Usage: node scripts/prepare-watermark.mjs <path-to-your-logo.png>
 * 
 * Example: node scripts/prepare-watermark.mjs ./bomis-logo.png
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = process.argv[2];

if (!inputPath) {
    console.error('❌ Usage: node scripts/prepare-watermark.mjs <path-to-logo.png>');
    process.exit(1);
}

const outputPath = path.join(__dirname, '..', 'public', 'watermark.png');

async function prepareWatermark() {
    try {
        console.log(`📸 Reading logo from: ${inputPath}`);

        // Read the image and get its raw pixel data
        const { data, info } = await sharp(inputPath)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const pixels = Buffer.from(data);

        // Remove white/near-white background by making those pixels transparent
        // Threshold: if R, G, B are all above 240, treat as white background
        const threshold = 240;
        for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];

            if (r > threshold && g > threshold && b > threshold) {
                // Make pixel fully transparent
                pixels[i + 3] = 0;
            }
        }

        // Save processed watermark
        await sharp(pixels, {
            raw: {
                width: info.width,
                height: info.height,
                channels: 4,
            },
        })
            .png()
            .toFile(outputPath);

        console.log(`✅ Watermark saved to: ${outputPath}`);
        console.log(`   Dimensions: ${info.width}x${info.height}`);
        console.log(`   White background removed, ready for use!`);
    } catch (error) {
        console.error('❌ Error preparing watermark:', error);
        process.exit(1);
    }
}

prepareWatermark();
