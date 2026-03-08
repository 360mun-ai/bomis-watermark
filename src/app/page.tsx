'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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

  // Check auth and load folders on mount
  useEffect(() => {
    checkAuthAndLoadFolders();
    fetchVideoQueue();

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
        body: JSON.stringify({ sourceId, destId, applyTrim }),
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
          // Streams can pass multiple data lines in one chunk, parse them
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
        body: JSON.stringify({ sourceId, destId, applyTrim, specificFiles: filesToRetry }),
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

                  // Assume video process API might be updated later to send errorFiles as well
                  if (data.errorFiles && data.errorFiles.length > 0) {
                    setVideoErrors(data.errorFiles);
                  }

                  setVideoStatusText(`Processed: ${data.processed}/${data.total} (Errors: ${data.errors || 0})`);
                  fetchVideoQueue(); // keep UI up to date with dequeue

                  // Calculate ETA
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

  if (isAuthenticated === null) {
    return <div className="flex h-screen items-center justify-center"><p>Loading...</p></div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Google Drive Watermark tool</CardTitle>
            <CardDescription>Automate watermarking for hundreds of images locally.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              To begin, you need to authorize this app to read and write to your Google Drive.
              Tokens will be saved locally on your machine.
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={handleLogin}>Sign in with Google</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-4">
      <Card className="w-full max-w-2xl bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-2xl text-zinc-100">BOMIS Watermarker</CardTitle>
          <CardDescription className="text-zinc-400">Select Google Drive folders to process</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200">Source Folder</label>
            <Select disabled={isLoadingFolders || isProcessing} onValueChange={(val: any) => setSourceId(val || '')}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                <SelectValue placeholder="Select source folder..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700 max-h-80">
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-zinc-100 focus:bg-zinc-700 cursor-pointer">
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-200">Destination Folder</label>
            <Select disabled={isLoadingFolders || isProcessing} onValueChange={(val: any) => setDestId(val || '')}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                <SelectValue placeholder="Select destination folder..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700 max-h-80">
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-zinc-100 focus:bg-zinc-700 cursor-pointer">
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2 pt-2 pb-2">
            <input
              type="checkbox"
              id="applyTrim"
              checked={applyTrim}
              onChange={(e) => setApplyTrim(e.target.checked)}
              className="w-4 h-4 rounded text-zinc-100 bg-zinc-800 border-zinc-700"
            />
            <label htmlFor="applyTrim" className="text-sm text-zinc-300 font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Apply Auto-Crop (Trims away solid/transparent background edges around subject using sharp)
            </label>
          </div>

          {isProcessing && (
            <div className="space-y-2 pt-4">
              <div className="flex justify-between text-sm text-zinc-400">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{statusText}</span>
                <span>{etaText}</span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-2"
                onClick={handleCancelImageJob}
              >
                Stop Job
              </Button>
            </div>
          )}

          {imageErrors.length > 0 && (
            <div className="pt-4 space-y-2">
              <p className="text-sm text-red-500 font-semibold">Failed Images:</p>
              <ul className="text-xs text-zinc-400 max-h-32 overflow-y-auto space-y-1 border border-zinc-800 p-2 rounded">
                {imageErrors.map((errFile, idx) => (
                  <li key={idx}>Failed: {errFile.name || errFile.id || 'Unknown'}</li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
                onClick={handleRetryImages}
                disabled={isProcessing}
              >
                Retry Failed Images
              </Button>
            </div>
          )}

        </CardContent>
        <CardFooter className="flex flex-col gap-4">
          <div className="flex w-full space-x-2">
            <Button
              className="flex-1 hover:bg-zinc-200"
              disabled={!sourceId || !destId || isProcessing}
              onClick={handleStartProcessing}
            >
              {isProcessing ? 'Processing...' : 'Start Job'}
            </Button>
            <Button
              variant="outline"
              className="bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700"
              disabled={!destId || isProcessing || isUndoing}
              onClick={handleUndo}
            >
              {isUndoing ? 'Undoing...' : 'Undo (Clear Dest)'}
            </Button>
          </div>

          {/* Instructions note */}
          <p className="text-xs text-zinc-500 text-center mt-4">
            Make sure your &apos;watermark.png&apos; file exists in the correct local directory as per the plan. Let&apos;s process batches!
          </p>
        </CardFooter>
      </Card>

      {/* Video Processing Placeholder Panel */}
      <Card className="w-full max-w-2xl bg-zinc-900 border-zinc-800 mt-6">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-xl text-zinc-100">Discovered Videos</CardTitle>
              <CardDescription className="text-zinc-400">Queue of videos awaiting FFmpeg routing.</CardDescription>
            </div>
            <Button
              variant="outline"
              className="bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700"
              onClick={handleScanVideos}
              disabled={!sourceId || isScanningVideos}
            >
              {isScanningVideos ? 'Scanning...' : 'Scan Source for Videos'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {videoQueue.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-4">No pending videos in local persistent queue.</p>
          ) : (
            <>
              <ul className="divide-y divide-zinc-800 max-h-60 overflow-y-auto pr-2">
                {videoQueue.map((v) => (
                  <li key={v.id} className="py-2 flex justify-between items-center">
                    <span className="text-sm text-zinc-300 truncate max-w-[80%]">{v.name}</span>
                    <span className="text-xs px-2 py-1 bg-zinc-800 text-zinc-400 rounded-full">Pending</span>
                  </li>
                ))}
              </ul>

              {isVideoProcessing && (
                <div className="space-y-2 pt-4">
                  <div className="flex justify-between text-sm text-zinc-400">
                    <span>Total Queue Progress</span>
                    <span>{videoProgress}%</span>
                  </div>
                  <Progress value={videoProgress} className="h-2 bg-zinc-700" />
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>{videoStatusText}</span>
                    <span>{videoEtaText}</span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full mt-2"
                    onClick={handleCancelVideoJob}
                  >
                    Stop Job
                  </Button>
                </div>
              )}
            </>
          )}

          {videoErrors.length > 0 && (
            <div className="pt-4 space-y-2">
              <p className="text-sm text-red-500 font-semibold">Failed Videos:</p>
              <ul className="text-xs text-zinc-400 max-h-32 overflow-y-auto space-y-1 border border-zinc-800 p-2 rounded">
                {videoErrors.map((errName, idx) => (
                  <li key={idx}>Failed: {errName}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
        {videoQueue.length > 0 && (
          <CardFooter>
            <Button
              onClick={handleProcessVideos}
              disabled={!destId || isVideoProcessing || isProcessing}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold tracking-wide"
            >
              {isVideoProcessing ? 'Executing FFmpeg Build...' : `Process ${videoQueue.length} Videos`}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
