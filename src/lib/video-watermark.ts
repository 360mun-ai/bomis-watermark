import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';

// Set the path to the ffmpeg binary from the installer package
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Apply watermark to a video using FFmpeg.
 * @param inputVideoPath - The absolute path of the downloaded source video
 * @param outputVideoPath - The absolute path where the watermarked video should be saved
 */
export async function applyVideoWatermark(inputVideoPath: string, outputVideoPath: string): Promise<void> {
    const watermarkPath = path.join(process.cwd(), 'public', 'watermark.png');

    return new Promise((resolve, reject) => {
        ffmpeg(inputVideoPath)
            .input(watermarkPath)
            // Complex filter for overlay:
            // 1. Scale the watermark to 20% of the main video's width ([1:v] is the watermark stream, [0:v] is the main video)
            // 2. Set the watermark opacity to 90% (0.9) using colorchannelmixer
            // 3. Overlay the modified watermark onto the main video at the top left
            .complexFilter([
                '[1:v]scale=iw*0.2:-1[wmScaled]',
                '[wmScaled]colorchannelmixer=aa=0.9[wmOpacified]',
                '[0:v][wmOpacified]overlay=10:10'
            ])
            // Standard optimal mp4 encoding for web
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-preset fast', // Balance between encoding speed and compression
                '-crf 23',      // Constant Rate Factor (0-51, lower is higher quality, 23 is default)
                '-movflags +faststart' // Optimizes video for web streaming
            ])
            .on('end', () => {
                resolve();
            })
            .on('error', (err: Error) => {
                console.error('FFmpeg Error:', err.message);
                reject(err);
            })
            .save(outputVideoPath);
    });
}
