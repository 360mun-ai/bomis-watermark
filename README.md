# BOMIS Watermarker (v1.0.0)

A high-performance local web application for automated batch watermarking of images and videos stored in Google Drive. 

## 🚀 Overview
The BOMIS Watermarker allows users to process hundreds of files directly from Google Drive without manual downloading. It features parallel processing, real-time progress tracking via Server-Sent Events (SSE), and a local persistent state for video job queues.

### Features
- **Batch Image Processing**: High-speed watermarking using `sharp` across 50 concurrent workers.
- **FFmpeg Video Pipeline**: Professional video watermarking with automatic cleanup of temporary local storage.
- **Google Drive Integration**: Automated folder scanning, pagination (supporting 1000+ items), and direct uploads.
- **Job Control**: Stop/Abort active jobs via `AbortController` and "Undo" actions to clear watermarked results.
- **Error Recovery**: Granular reporting of failed files with a "Retry" mechanism for missed images.
- **Zero Hydration Errors**: Optimized layout components to suppress extension-injected UI mismatches.

## 🛠 Tech Stack
- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide Icons, Sonner Toasts.
- **Backend API**: Next.js Edge-compatible server routes with Node.js streaming.
- **Libraries**: 
  - `sharp` (Image processing)
  - `fluent-ffmpeg` & `@ffmpeg-installer/ffmpeg` (Video rendering)
  - `googleapis` (Drive API v3)
  - `p-limit` (Concurrency control)

## 📦 Getting Started

### Prerequisites
- [Node.js 20+](https://nodejs.org/)
- Google Cloud Project with **Google Drive API** enabled.
- OAuth 2.0 Credentials (Client ID & Secret).

### Installation
1. **Clone the repository**:
   ```bash
   git clone <your-repo-link>
   cd watermark_bomis
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Fill in your Google OAuth credentials:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (usually `http://localhost:3000/api/auth/callback`)

4. **Add Watermark Asset**:
   Ensure your watermark logo is named `watermark.png` and placed in the `public/` directory.

### Running Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to begin.

## 📂 Project Structure
- `/src/app/api/process`: Image processing SSE endpoint.
- `/src/app/api/videos/process`: FFmpeg video pipeline.
- `/src/lib/drive-api.ts`: Centralized Google Drive wrapper with pagination.
- `/src/lib/state-store.ts`: Local JSON store for video job tracking.
- `/v2_roadmap.md`: Architectural plan for cloud scaling.

## ⚖️ License
Proprietary - BOMIS Internal Tooling.
