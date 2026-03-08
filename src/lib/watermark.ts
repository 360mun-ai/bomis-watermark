import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

// Apply the BOMIS watermark to the provided image buffer
// The watermark is placed at top-left with 90% opacity
// If applyTrim is true, automatically crop solid background edges
export async function applyWatermark(sourceBuffer: ArrayBuffer, applyTrim: boolean = false): Promise<Buffer> {
    try {
        const watermarkPath = path.join(process.cwd(), 'public', 'watermark.png');

        // Check if watermark exists
        try {
            await fs.access(watermarkPath);
        } catch {
            throw new Error(`Watermark image not found at ${watermarkPath}. Please place your 'watermark.png' in the /public folder.`);
        }

        let originalImage = sharp(Buffer.from(sourceBuffer)).rotate();

        if (applyTrim) {
            originalImage = originalImage.trim(); // Heuristic auto-crop of solid background borders
        }

        // Get metadata to scale the watermark proportionally
        const metadata = await originalImage.metadata();
        const width = metadata.width || 800;

        // Resize watermark to be 20% of the image width
        const watermarkWidth = Math.floor(width * 0.20);

        // Read watermark, resize it, and make it 90% opaque (0.9 opacity)
        // sharp's .ensureAlpha() ensures the image has an alpha channel
        // We then use .composite with a semi-transparent overlay to achieve the desired opacity
        const resizedWatermark = await sharp(watermarkPath)
            .resize({ width: watermarkWidth })
            .ensureAlpha()
            .toBuffer();

        // Create a 90% opacity version by compositing with a transparent overlay
        const watermarkMeta = await sharp(resizedWatermark).metadata();
        const wmWidth = watermarkMeta.width || watermarkWidth;
        const wmHeight = watermarkMeta.height || watermarkWidth;

        // Create a semi-transparent overlay (70% opacity = 179 alpha out of 255)
        const opacityOverlay = await sharp({
            create: {
                width: wmWidth,
                height: wmHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 0 },
            },
        })
            .png()
            .toBuffer();

        // Composite the watermark with reduced opacity
        // We achieve 90% opacity by using the raw watermark pipeline
        const watermarkWithOpacity = await sharp(resizedWatermark)
            .composite([
                {
                    input: opacityOverlay,
                    blend: 'dest-in',
                },
            ])
            // Apply global opacity by extracting alpha and reducing it
            .toBuffer();

        // Actually, the simplest way to achieve 90% opacity with sharp:
        // Use the linear transform on the alpha channel
        const finalWatermark = await sharp(resizedWatermark)
            .ensureAlpha(0.9) // Sets opacity for pixels that need alpha added
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Manually reduce alpha channel to 90%
        const { data, info } = finalWatermark;
        const pixels = Buffer.from(data);
        for (let i = 3; i < pixels.length; i += 4) {
            // Multiply existing alpha by 0.9
            pixels[i] = Math.round(pixels[i] * 0.9);
        }

        const opacifiedWatermark = await sharp(pixels, {
            raw: {
                width: info.width,
                height: info.height,
                channels: 4,
            },
        })
            .png()
            .toBuffer();

        // Composite the 90%-opacity watermark on the top-left of the original image
        const processedBuffer = await originalImage
            .composite([
                {
                    input: opacifiedWatermark,
                    gravity: 'northwest',
                },
            ])
            .toBuffer();

        return processedBuffer;
    } catch (error) {
        console.error('Error applying watermark:', error);
        throw error;
    }
}
