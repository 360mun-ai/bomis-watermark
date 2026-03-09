'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

interface DriveFolder {
  id: string;
  name: string;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [sourceId, setSourceId] = useState<string>('');
  const [destId, setDestId] = useState<string>('');
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [etaText, setEtaText] = useState('');

  const [applyTrim, setApplyTrim] = useState(false);
  const [videoQueue, setVideoQueue] = useState<DriveFile[]>([]);
  const [isScanningVideos, setIsScanningVideos] = useState(false);
  const [isVideoProcessing, setIsVideoProcessing] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoStatusText, setVideoStatusText] = useState('');
  const [videoEtaText, setVideoEtaText] = useState('');

  const [imageAbortController, setImageAbortController] = useState<AbortController | null>(null);
  const [videoAbortController, setVideoAbortController] = useState<AbortController | null>(null);
  const [isUndoing, setIsUndoing] = useState(false);
  const [imageErrors, setImageErrors] = useState<any[]>([]);
  const [videoErrors, setVideoErrors] = useState<any[]>([]);

  // Thread / concurrency configuration
  const [threadCount, setThreadCount] = useState<number>(50);
  const [hardwareInfo, setHardwareInfo] = useState<{
    logicalCores: number;
    totalMemoryGB: number;
    recommended: number;
    cpuModel: string;
    platform: string;
  } | null>(null);

  // Check auth and load folders on mount
  useEffect(() => {
    checkAuthAndLoadFolders();
    fetchVideoQueue();
    fetchHardwareInfo();

    // Check URL for auth success/error
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('success')) {
      toast.success('Successfully authenticated with Google Drive!');
      // remove query params cleanly
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error')) {
      toast.error('Authentication failed. Please try again.');
    }
  }, []);

  const fetchHardwareInfo = async () => {
    try {
      const res = await fetch('/api/hardware');
      if (res.ok) {
        const data = await res.json();
        setHardwareInfo(data);
        // We no longer clamp to CPU recommendation automatically for network tasks
      }
    } catch (err) {
      console.error('Failed to fetch hardware info', err);
    }
  };

  const checkAuthAndLoadFolders = async () => {
    setIsLoadingFolders(true);
    try {
      const res = await fetch('/api/drive/folders');
      if (res.status === 401) {
        setIsAuthenticated(false);
      } else if (res.ok) {
        const data = await res.json();
        setFolders(data.folders);
        setIsAuthenticated(true);
      } else {
        toast.error('Failed to load folders.');
      }
    } catch (error) {
      console.error('Error:', error);
      toast.error('An error occurred connecting to the server.');
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const fetchVideoQueue = async () => {
    try {
      const res = await fetch('/api/videos/queue');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.queue) {
          setVideoQueue(data.queue);
        }
      }
    } catch (error) {
      console.error('Failed to fetch video queue', error);
    }
  };

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/auth/url');
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error('Failed to get login URL');
      }
    } catch (error) {
      toast.error('Error starting login flow');
    }
  };

  const handleCancelImageJob = () => {
    if (imageAbortController) {
      imageAbortController.abort();
      setIsProcessing(false);
      setStatusText('Job cancelled.');
      setEtaText('');
    }
  };

  const handleCancelVideoJob = () => {
    if (videoAbortController) {
      videoAbortController.abort();
      setIsVideoProcessing(false);
      setVideoStatusText('Job cancelled.');
      setVideoEtaText('');
    }
  };

  const handleUndo = async () => {
    if (!destId) {
      toast.error('Please select destination folder first.');
      return;
    }
    if (!confirm('Are you sure you want to delete all "WM_" prefixed files from the destination folder?')) return;

    setIsUndoing(true);
    toast.info('Deleting watermarked files from destination...');
    try {
      const res = await fetch('/api/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destId, prefix: 'WM_' })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Undo complete. Deleted ${data.deleted} files.`);
      } else {
        toast.error(data.error || 'Failed to undo.');
      }
    } catch (e) {
      toast.error('Undo process failed due to network error.');
    } finally {
      setIsUndoing(false);
    }
  };

  const handleStartProcessing = async () => {
    if (!sourceId || !destId) {
      toast.error('Please select both source and destination folders');
      return;
    }
    if (sourceId === destId) {
      toast.error('Source and destination folders cannot be the same');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatusText('Preparing...');
    setEtaText('');
    setImageErrors([]);

    const controller = new AbortController();
    setImageAbortController(controller);

    try {
      toast.info('Processing started...');
      const startTime = Date.now();

      const response = await fetch(`/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, destId, applyTrim, concurrency: threadCount }),
        signal: controller.signal
      });
      if (!response.body) {
        throw new Error('No readable stream returned');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

                if (data.status === 'fetching_list') {
                  setStatusText('Fetching image list from Drive...');
                } else if (data.status === 'error') {
                  toast.error(`Error: ${data.message}`);
                  setIsProcessing(false);
                  done = true;
                  break;
                } else if (data.status === 'processing' || data.status === 'complete') {
                  setProgress(data.progress);
                  if (data.errorFiles && data.errorFiles.length > 0) {
                    setImageErrors(data.errorFiles);
                    setStatusText(`Processed: ${data.processed}/${data.total} (Errors: ${data.errorFiles.length})`);
                  } else if (data.errors && data.errors > 0) {
                    setStatusText(`Processed: ${data.processed}/${data.total} (Errors: ${data.errors})`);
                  } else {
                    setStatusText(`Processed: ${data.processed}/${data.total}`);
                  }

                  // Calculate ETA
                  if (data.status === 'processing' && data.processed > 0 && data.total > data.processed) {
                    const elapsed = Date.now() - startTime;
                    const msPerItem = elapsed / data.processed;
                    const remainingItems = data.total - data.processed;
                    const etaSeconds = Math.round((remainingItems * msPerItem) / 1000);
                    if (etaSeconds > 60) {
                      setEtaText(`ETA: ${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`);
                    } else {
                      setEtaText(`ETA: ${etaSeconds}s`);
                    }
                  } else if (data.status === 'complete') {
                    setEtaText('Complete!');
                  }

                  if (data.status === 'complete') {
                    toast.success(`Completed processing ${data.total} images!`);
                    setIsProcessing(false);
                  }
                }
              } catch (e) {
                console.error("Error parsing SSE chunk", e);
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Fetch aborted.');
      } else {
        console.error(error);
        toast.error('An error occurred during processing');
        setIsProcessing(false);
      }
    } finally {
      setImageAbortController(null);
    }
  };

  const handleRetryImages = async () => {
    if (!destId || imageErrors.length === 0) return;

    const filesToRetry = [...imageErrors];
    setImageErrors([]);
    setIsProcessing(true);
    setProgress(0);
    setStatusText('Retrying...');
    setEtaText('');

    const controller = new AbortController();
    setImageAbortController(controller);

    try {
      toast.info(`Retrying ${filesToRetry.length} failed images...`);
      const startTime = Date.now();

      const response = await fetch(`/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, destId, applyTrim, specificFiles: filesToRetry, concurrency: threadCount }),
        signal: controller.signal
      });
      if (!response.body) {
        throw new Error('No readable stream returned');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

                if (data.status === 'fetching_list') {
                  setStatusText('Preparing retry list...');
                } else if (data.status === 'error') {
                  toast.error(`Error: ${data.message}`);
                  setIsProcessing(false);
                  done = true;
                  break;
                } else if (data.status === 'processing' || data.status === 'complete') {
                  setProgress(data.progress);
                  if (data.errorFiles && data.errorFiles.length > 0) {
                    setImageErrors(data.errorFiles);
                    setStatusText(`Processed: ${data.processed}/${data.total} (Errors: ${data.errorFiles.length})`);
                  } else if (data.errors && data.errors > 0) {
                    setStatusText(`Processed: ${data.processed}/${data.total} (Errors: ${data.errors})`);
                  } else {
                    setStatusText(`Processed: ${data.processed}/${data.total}`);
                  }

                  if (data.status === 'processing' && data.processed > 0 && data.total > data.processed) {
                    const elapsed = Date.now() - startTime;
                    const msPerItem = elapsed / data.processed;
                    const remainingItems = data.total - data.processed;
                    const etaSeconds = Math.round((remainingItems * msPerItem) / 1000);
                    if (etaSeconds > 60) {
                      setEtaText(`ETA: ${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`);
                    } else {
                      setEtaText(`ETA: ${etaSeconds}s`);
                    }
                  } else if (data.status === 'complete') {
                    setEtaText('Complete!');
                    toast.success(`Completed retrying ${data.total} images!`);
                    setIsProcessing(false);
                  }
                }
              } catch (e) {
                console.error("Error parsing SSE chunk", e);
              }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Retry fetch aborted.');
      } else {
        console.error(error);
        toast.error('An error occurred during retry');
        setIsProcessing(false);
      }
    } finally {
      setImageAbortController(null);
    }
  };

  const handleScanVideos = async () => {
    if (!sourceId) {
      toast.error('Please select a source folder to scan for videos.');
      return;
    }
    setIsScanningVideos(true);
    toast.info('Scanning for videos...');
    try {
      const res = await fetch('/api/videos/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Scan complete! Synced ${data.found} videos.`);
        fetchVideoQueue(); // Refresh the list
      } else {
        toast.error(data.error || 'Failed to scan videos');
      }
    } catch (e) {
      toast.error('An error occurred during scan.');
    } finally {
      setIsScanningVideos(false);
    }
  };

  const handleProcessVideos = async () => {
    if (!destId) {
      toast.error('Please select destination folder for videos.');
      return;
    }

    setIsVideoProcessing(true);
    setVideoProgress(0);
    setVideoStatusText('Preparing video pipeline...');
    setVideoEtaText('');
    setVideoErrors([]);

    const controller = new AbortController();
    setVideoAbortController(controller);

    try {
      toast.info('Starting external FFmpeg video job. This will take time.');
      const startTime = Date.now();

      const response = await fetch(`/api/videos/process?destId=${destId}`, {
        signal: controller.signal
      });
      if (!response.body) throw new Error('No readable stream returned');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

                if (data.status === 'fetching_queue') {
                  setVideoStatusText('Reading local queue...');
                } else if (data.status === 'error') {
                  toast.error(`Video Error: ${data.message}`);
                  setIsVideoProcessing(false);
                  done = true;
                  break;
                } else if (data.status === 'processing' || data.status === 'complete') {
                  setVideoProgress(data.progress);

                  if (data.errorFiles && data.errorFiles.length > 0) {
                    setVideoErrors(data.errorFiles);
                  }

                  setVideoStatusText(`Processed: ${data.processed}/${data.total} (Errors: ${data.errors || 0})`);
                  fetchVideoQueue();

                  if (data.status === 'processing' && data.processed > 0 && data.total > data.processed) {
                    const elapsed = Date.now() - startTime;
                    const msPerItem = elapsed / data.processed;
                    const remainingItems = data.total - data.processed;
                    const etaSeconds = Math.round((remainingItems * msPerItem) / 1000);
                    if (etaSeconds > 60) {
                      setVideoEtaText(`ETA: ${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`);
                    } else {
                      setVideoEtaText(`ETA: ${etaSeconds}s`);
                    }
                  } else if (data.status === 'complete') {
                    setVideoEtaText('Complete!');
                  }

                  if (data.status === 'complete') {
                    toast.success(`Completed processing ${data.total} videos!`);
                    setIsVideoProcessing(false);
                  }
                }
              } catch (e) { }
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Video fetch aborted.');
      } else {
        toast.error('Fatal video process error');
        setIsVideoProcessing(false);
      }
    } finally {
      setVideoAbortController(null);
    }
  };

  /* ─────────────────────────── Loading State ─────────────────────────── */
  if (isAuthenticated === null) {
    return (
      <div className="canvas-bg flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-up">
          <div className="w-10 h-10 border-2 border-[oklch(0.82_0.155_72)] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-muted)] tracking-wide uppercase">Initializing</p>
        </div>
      </div>
    );
  }

  /* ─────────────────────────── Login Screen ─────────────────────────── */
  if (!isAuthenticated) {
    return (
      <div className="canvas-bg flex items-center justify-center p-4">
        <div className="card-panel accent-top w-full max-w-md animate-fade-up">
          <div className="relative z-10 p-8 flex flex-col items-center text-center">
            {/* Icon mark */}
            <div className="w-14 h-14 rounded-2xl bg-[oklch(0.82_0.155_72/12%)] border border-[oklch(0.82_0.155_72/25%)] flex items-center justify-center mb-6">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="oklch(0.82 0.155 72)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>

            <h1 className="text-2xl font-semibold shimmer-text mb-2">
              BOMIS Watermark Studio
            </h1>
            <p className="text-sm text-[var(--color-text-muted)] mb-8 max-w-xs leading-relaxed">
              Automate watermarking for hundreds of images locally.
              Tokens are saved on your machine — nothing leaves this device.
            </p>

            <Button
              className="w-full h-10 sheen glow-accent text-sm font-semibold tracking-wide"
              onClick={handleLogin}
            >
              Sign in with Google
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────────────────── Main Dashboard ─────────────────────────── */
  return (
    <div className="canvas-bg p-4 md:p-8 flex flex-col items-center gap-6">

      {/* ── Header ── */}
      <header className="w-full max-w-2xl animate-fade-up">
        <h1 className="text-3xl font-bold text-gold tracking-tight">
          BOMIS Watermarker
        </h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Select Google Drive folders to process
        </p>
        <hr className="rule-accent mt-4" />
      </header>

      {/* ══════════════ IMAGE PROCESSING PANEL ══════════════ */}
      <section className="card-panel accent-top w-full max-w-2xl animate-fade-up-delay-1">
        <div className="relative z-10 p-6 md:p-8 space-y-6">

          {/* Section label */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[oklch(0.82_0.155_72/10%)] border border-[oklch(0.82_0.155_72/20%)] flex items-center justify-center flex-shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.82 0.155 72)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                Image Processing
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">Batch watermark with sharp</p>
            </div>
          </div>

          {/* Folder selectors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                Source Folder
              </label>
              <Select disabled={isLoadingFolders || isProcessing} onValueChange={(val: any) => setSourceId(val || '')}>
                <SelectTrigger className="bg-[var(--color-surface-2)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] h-10 rounded-lg">
                  <SelectValue placeholder="Select source..." />
                </SelectTrigger>
                <SelectContent className="bg-[var(--color-surface-2)] border-[var(--color-border)] max-h-80">
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-[var(--color-text-primary)] focus:bg-[var(--color-surface-3)] cursor-pointer">
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
                Destination Folder
              </label>
              <Select disabled={isLoadingFolders || isProcessing} onValueChange={(val: any) => setDestId(val || '')}>
                <SelectTrigger className="bg-[var(--color-surface-2)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] h-10 rounded-lg">
                  <SelectValue placeholder="Select destination..." />
                </SelectTrigger>
                <SelectContent className="bg-[var(--color-surface-2)] border-[var(--color-border)] max-h-80">
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-[var(--color-text-primary)] focus:bg-[var(--color-surface-3)] cursor-pointer">
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Auto-crop toggle */}
          <label htmlFor="applyTrim" className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                id="applyTrim"
                checked={applyTrim}
                onChange={(e) => setApplyTrim(e.target.checked)}
                className="peer sr-only"
              />
              <div className="w-9 h-5 rounded-full bg-[var(--color-surface-3)] border border-[var(--color-border)] peer-checked:bg-[oklch(0.82_0.155_72/30%)] peer-checked:border-[oklch(0.82_0.155_72/50%)] transition-colors" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-[var(--color-text-muted)] peer-checked:bg-[oklch(0.82_0.155_72)] peer-checked:translate-x-4 transition-all" />
            </div>
            <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors">
              Apply Auto-Crop (trim background edges)
            </span>
          </label>

          {/* ── Concurrent Threads ── */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">
              Concurrent Threads
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={200}
                value={threadCount}
                onChange={(e) => setThreadCount(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                disabled={isProcessing}
                className="w-24 h-9 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] text-center text-sm font-mono text-[var(--color-text-primary)] focus:outline-none focus:border-[oklch(0.82_0.155_72/60%)] disabled:opacity-50"
              />
              {hardwareInfo && threadCount !== 50 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs bg-[var(--color-surface-2)] text-[oklch(0.82_0.155_72)] border-[oklch(0.82_0.155_72/30%)] hover:bg-[oklch(0.82_0.155_72/10%)]"
                  onClick={() => setThreadCount(50)}
                  disabled={isProcessing}
                >
                  Reset to 50
                </Button>
              )}
            </div>
            {hardwareInfo && (
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono leading-relaxed">
                Network Concurrency: Higher is faster for Drive API. Default 50 handles most connections effortlessly regardless of your {hardwareInfo.logicalCores}-core CPU.
              </p>
            )}
          </div>

          {/* ── Progress section ── */}
          {isProcessing && (
            <div className="space-y-3 pt-2 animate-fade-up">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Progress</span>
                <span className="text-sm font-mono font-medium text-[oklch(0.82_0.155_72)]">{progress}%</span>
              </div>
              <div className="progress-glow">
                <Progress value={progress} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-[var(--color-text-muted)]">{statusText}</span>
                <span className="text-xs font-mono text-[oklch(0.82_0.155_72/80%)]">{etaText}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-1"
                onClick={handleCancelImageJob}
              >
                Stop Job
              </Button>
            </div>
          )}

          {/* ── Error list ── */}
          {imageErrors.length > 0 && (
            <div className="space-y-3 pt-2 animate-fade-up">
              <div className="flex items-center gap-2">
                <span className="status-pill error">Failed</span>
                <span className="text-xs text-[var(--color-text-muted)]">{imageErrors.length} image{imageErrors.length > 1 ? 's' : ''}</span>
              </div>
              <ul className="text-xs font-mono text-[var(--color-text-muted)] max-h-28 overflow-y-auto space-y-1 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-3 rounded-lg">
                {imageErrors.map((errFile, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-[oklch(0.65_0.22_27)] flex-shrink-0" />
                    {errFile.name || errFile.id || 'Unknown'}
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="w-full sheen bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                onClick={handleRetryImages}
                disabled={isProcessing}
              >
                Retry Failed Images
              </Button>
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="flex gap-3 pt-2">
            <Button
              className="flex-1 h-10 sheen glow-accent text-sm font-semibold tracking-wide"
              disabled={!sourceId || !destId || isProcessing}
              onClick={handleStartProcessing}
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Processing…
                </span>
              ) : 'Start Job'}
            </Button>
            <Button
              variant="outline"
              className="sheen bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-3)] h-10"
              disabled={!destId || isProcessing || isUndoing}
              onClick={handleUndo}
            >
              {isUndoing ? 'Undoing…' : 'Undo'}
            </Button>
          </div>

          {/* Tip */}
          <p className="text-[10px] text-[var(--color-text-muted)] text-center leading-relaxed pt-1">
            Place <code className="font-mono px-1 py-0.5 rounded bg-[var(--color-surface-2)] text-[oklch(0.82_0.155_72/80%)]">watermark.png</code> in the project&apos;s public directory.
          </p>
        </div>
      </section>

      {/* ══════════════ VIDEO PROCESSING PANEL ══════════════ */}
      <section className="card-panel accent-top w-full max-w-2xl animate-fade-up-delay-2">
        <div className="relative z-10 p-6 md:p-8 space-y-5">

          {/* Section header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[oklch(0.55_0.15_250/12%)] border border-[oklch(0.55_0.15_250/25%)] flex items-center justify-center flex-shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.65 0.12 250)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Video Processing
                </h2>
                <p className="text-xs text-[var(--color-text-muted)]">FFmpeg pipeline • {videoQueue.length} in queue</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="sheen bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-3)]"
              onClick={handleScanVideos}
              disabled={!sourceId || isScanningVideos}
            >
              {isScanningVideos ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Scanning
                </span>
              ) : 'Scan Source'}
            </Button>
          </div>

          {/* Video queue */}
          {videoQueue.length === 0 ? (
            <div className="py-8 flex flex-col items-center gap-2 text-[var(--color-text-muted)]">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <p className="text-sm">No pending videos in queue</p>
              <p className="text-xs opacity-60">Scan a source folder to discover videos</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[var(--color-border-subtle)] max-h-56 overflow-y-auto pr-1 -mx-1 px-1">
                {videoQueue.map((v) => (
                  <li key={v.id} className="py-2.5 flex justify-between items-center group">
                    <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] truncate max-w-[75%] transition-colors font-mono text-xs">
                      {v.name}
                    </span>
                    <span className="status-pill pending">Pending</span>
                  </li>
                ))}
              </ul>

              {/* Video progress */}
              {isVideoProcessing && (
                <div className="space-y-3 pt-2 animate-fade-up">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">Queue Progress</span>
                    <span className="text-sm font-mono font-medium text-[oklch(0.82_0.155_72)]">{videoProgress}%</span>
                  </div>
                  <div className="progress-glow">
                    <Progress value={videoProgress} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-[var(--color-text-muted)]">{videoStatusText}</span>
                    <span className="text-xs font-mono text-[oklch(0.82_0.155_72/80%)]">{videoEtaText}</span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full mt-1"
                    onClick={handleCancelVideoJob}
                  >
                    Stop Job
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Video errors */}
          {videoErrors.length > 0 && (
            <div className="space-y-3 pt-2 animate-fade-up">
              <div className="flex items-center gap-2">
                <span className="status-pill error">Failed</span>
                <span className="text-xs text-[var(--color-text-muted)]">{videoErrors.length} video{videoErrors.length > 1 ? 's' : ''}</span>
              </div>
              <ul className="text-xs font-mono text-[var(--color-text-muted)] max-h-28 overflow-y-auto space-y-1 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] p-3 rounded-lg">
                {videoErrors.map((errName, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-[oklch(0.65_0.22_27)] flex-shrink-0" />
                    {errName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Process button */}
          {videoQueue.length > 0 && (
            <Button
              onClick={handleProcessVideos}
              disabled={!destId || isVideoProcessing || isProcessing}
              className="w-full h-10 sheen text-sm font-semibold tracking-wide bg-[oklch(0.55_0.15_250)] hover:bg-[oklch(0.50_0.15_250)] text-white"
            >
              {isVideoProcessing ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Executing FFmpeg Build…
                </span>
              ) : `Process ${videoQueue.length} Video${videoQueue.length > 1 ? 's' : ''}`}
            </Button>
          )}
        </div>
      </section>

      {/* Footer signature */}
      <footer className="w-full max-w-2xl text-center py-4">
        <p className="text-[10px] text-[var(--color-text-muted)] opacity-50 tracking-widest uppercase">
          BOMIS Industrial Tools
        </p>
      </footer>
    </div>
  );
}
