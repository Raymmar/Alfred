import { useEffect, useState, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ArrowLeft, Play, Pause, Loader2, Clock, MoreVertical, Pencil, Trash, RefreshCw } from 'lucide-react';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatTime } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

// Add styles for the region
const regionStyles = {
  backgroundColor: 'rgba(244, 96, 54, 0.2)',
  borderRadius: '4px',
};

interface MediaPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
  showControls?: boolean;
  showBackButton?: boolean;
  onClose?: () => void;
  onTimeSelect?: (start: number, end: number) => void;
  projectId?: number;
  onRename?: (id: number) => void;
  onDelete?: (id: number) => void;
  onReprocess?: (id: number) => void;
}

export function MediaPlayer({
  src,
  className,
  autoPlay = false,
  showControls = true,
  showBackButton = false,
  onClose,
  onTimeSelect,
  projectId,
  onRename,
  onDelete,
  onReprocess
}: MediaPlayerProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  const [selectedRegion, setSelectedRegion] = useState<{ start: number; end: number } | null>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const cleanupTimeout = useRef<NodeJS.Timeout>();
  const audioContext = useRef<AudioContext | null>(null);
  const retryCount = useRef(0);
  const maxRetries = 3;
  const [isTimestampDialogOpen, setIsTimestampDialogOpen] = useState(false);
  const [timestampInput, setTimestampInput] = useState('');

  const handleRegionUpdate = useCallback((region: any) => {
    if (!region) return;
    const { start, end } = region;
    setSelectedRegion({ start, end });
    onTimeSelect?.(start, end);
  }, [onTimeSelect]);

  useEffect(() => {
    let isActive = true;

    const initializeWithDelay = () => new Promise<void>(resolve => setTimeout(resolve, 100));

    const validateAudioFile = async (url: string): Promise<boolean> => {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          credentials: 'include'
        });

        if (!response.ok) {
          console.warn(`Audio file validation failed - Status: ${response.status}`);
          return false;
        }

        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');

        console.log('Audio file headers:', {
          contentType,
          contentLength,
          status: response.status
        });

        const isValidContentType = !contentType ||
          contentType.includes('audio/') ||
          contentType.includes('application/octet-stream');

        const hasContent = !contentLength || parseInt(contentLength) > 0;

        if (!isValidContentType) {
          console.warn(`Invalid content type: ${contentType}`);
        }

        if (!hasContent) {
          console.warn('Empty content length');
        }

        return isValidContentType && hasContent;
      } catch (error) {
        console.error('Error validating audio file:', error);
        return true;
      }
    };

    const cleanupWaveSurfer = async (instance: WaveSurfer) => {
      return new Promise<void>((resolve) => {
        try {
          instance.pause();
          instance.unAll();
          cleanupTimeout.current = setTimeout(() => {
            try {
              instance.destroy();
            } catch (error) {
              console.warn('Non-critical cleanup error:', error);
            }
            resolve();
          }, 100);
        } catch (error) {
          console.warn('Error during cleanup:', error);
          resolve();
        }
      });
    };

    const initializeWaveSurfer = async () => {
      if (!waveformRef.current || !isActive) return;

      setError(null);
      setIsLoading(true);
      setIsPlaying(false);
      setCurrentTime('0:00');
      setDuration('0:00');
      setSelectedRegion(null);

      try {
        if (wavesurfer.current) {
          const oldInstance = wavesurfer.current;
          wavesurfer.current = null;
          await cleanupWaveSurfer(oldInstance);
        }

        if (!isActive) return;

        await initializeWithDelay();

        const isValidAudio = await validateAudioFile(src);
        if (!isValidAudio) {
          console.warn('Audio validation warning - attempting to play anyway');
        }

        if (!audioContext.current || audioContext.current.state === 'closed') {
          try {
            audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          } catch (error) {
            console.error('Failed to create AudioContext:', error);
            throw new Error('Failed to initialize audio system');
          }
        }

        if (audioContext.current.state === 'suspended') {
          await audioContext.current.resume();
        }

        const regionsPlugin = RegionsPlugin.create();

        const ws = WaveSurfer.create({
          container: waveformRef.current,
          waveColor: '#385F71',
          progressColor: '#F46036',
          cursorColor: '#F46036',
          barWidth: 2,
          barGap: 1,
          height: 32,
          normalize: true,
          fillParent: true,
          hideScrollbar: true,
          interact: true,
          dragToSeek: false,
          autoCenter: false,
          autoScroll: false,
          plugins: [regionsPlugin]
        });

        ws.on('error', (err) => {
          console.error('WaveSurfer error:', err);
          if (err.toString().includes('decode')) {
            toast({
              title: "Audio Format Error",
              description: "The audio file format is not supported. Try re-recording or converting the file.",
              variant: "destructive"
            });
          }
        });

        ws.on('decode', () => {
          const region = regionsPlugin.addRegion({
            start: 0,
            end: ws.getDuration(),
            drag: true,
            resize: true,
            color: 'rgba(244, 96, 54, 0.2)',
          });

          if (region.element) {
            Object.assign(region.element.style, regionStyles);
          }

          handleRegionUpdate(region);
        });

        regionsPlugin.on('region-updated', handleRegionUpdate);
        regionsPlugin.on('region-update-end', handleRegionUpdate);

        if (!isActive) {
          await cleanupWaveSurfer(ws);
          return;
        }

        wavesurfer.current = ws;

        ws.on('ready', () => {
          if (isActive) {
            setIsLoading(false);
            setDuration(formatTime(ws.getDuration()));
            retryCount.current = 0;
            if (autoPlay) ws.play();
          }
        });

        ws.on('timeupdate', (currentTime: number) => {
          if (isActive) {
            setCurrentTime(formatTime(currentTime));
          }
        });


        ws.on('play', () => { if (isActive) setIsPlaying(true) });
        ws.on('pause', () => { if (isActive) setIsPlaying(false) });
        ws.on('finish', () => { if (isActive) setIsPlaying(false) });

        const loadTimeout = setTimeout(() => {
          if (isActive && isLoading) {
            setError('Loading timeout - please try again');
            setIsLoading(false);
          }
        }, 30000);

        try {
          await ws.load(src);
          clearTimeout(loadTimeout);
        } catch (loadError) {
          clearTimeout(loadTimeout);
          console.error('Error loading audio:', loadError);
          throw loadError;
        }

      } catch (error) {
        console.error('Error initializing WaveSurfer:', error);
        if (isActive) {
          setError(error instanceof Error ? error.message : 'Failed to initialize audio player');
          setIsLoading(false);
          toast({
            title: "Audio Player Error",
            description: error instanceof Error ? error.message : 'Failed to initialize audio player',
            variant: "destructive"
          });
        }
      }
    };

    if (src) {
      initializeWaveSurfer();
    }

    return () => {
      isActive = false;
      if (cleanupTimeout.current) {
        clearTimeout(cleanupTimeout.current);
      }

      if (wavesurfer.current) {
        const instance = wavesurfer.current;
        wavesurfer.current = null;
        cleanupWaveSurfer(instance).catch(console.warn);
      }

      if (audioContext.current?.state !== 'closed') {
        try {
          audioContext.current?.close();
        } catch (error) {
          console.warn('Error closing AudioContext:', error);
        }
      }
    };
  }, [src, autoPlay, toast, handleRegionUpdate]);

  const togglePlay = () => {
    if (!wavesurfer.current) return;
    try {
      wavesurfer.current.playPause();
    } catch (error) {
      console.warn('Error toggling playback:', error);
      setError('Playback control failed');
      toast({
        title: "Playback Error",
        description: "Failed to control audio playback",
        variant: "destructive"
      });
    }
  };

  const handleHomeClick = () => {
    if (onClose) {
      onClose();
    }
    setLocation('/');
  };

  const parseTimestamp = (timestamp: string): number | null => {
    const parts = timestamp.split(':').map(part => parseInt(part, 10));
    if (parts.some(isNaN)) return null;

    let seconds = 0;
    if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else {
      return null;
    }

    return seconds;
  };

  const jumpToTimestamp = (timestamp: string) => {
    const seconds = parseTimestamp(timestamp);
    if (seconds === null || !wavesurfer.current) return;

    const duration = wavesurfer.current.getDuration();
    if (seconds > duration) {
      toast({
        title: "Invalid Timestamp",
        description: "Timestamp exceeds audio duration",
        variant: "destructive"
      });
      return;
    }

    wavesurfer.current.seekTo(seconds / duration);
    setIsTimestampDialogOpen(false);
    setTimestampInput('');
  };

  const handleTimestampClick = () => {
    if (!wavesurfer.current) return;
    setIsTimestampDialogOpen(true);
  };

  if (!src) {
    return (
      <div className={cn('relative rounded-lg bg-muted/30 h-8 flex items-center justify-center', className)}>
        <span className="text-sm text-muted-foreground">No audio available</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {showBackButton && (
        <Button variant="ghost" size="sm" className="gap-2 mb-2" onClick={handleHomeClick}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      )}

      <div className={cn(
        'relative p-4 bg-background border rounded-md shadow-sm',
        className
      )}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            {showControls && (
              <div className="flex items-center gap-2">
                {projectId && (onRename || onDelete || onReprocess) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 p-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {onRename && (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            onRename(projectId!);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                      )}
                      {onReprocess && (
                        <DropdownMenuItem
                          onSelect={(e) => {
                            e.preventDefault();
                            onReprocess(projectId!);
                          }}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Re-process Audio
                        </DropdownMenuItem>
                      )}
                      {onDelete && (
                        <DropdownMenuItem
                          className="text-red-600"
                          onSelect={(e) => {
                            e.preventDefault();
                            onDelete(projectId!);
                          }}
                        >
                          <Trash className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shrink-0",
                    "transition-all duration-200 ease-in-out",
                    isLoading && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={togglePlay}
                  disabled={isLoading}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4 ml-0.5" />
                  )}
                </Button>

                <div className="relative flex-1 group flex items-center">
                  <div
                    ref={waveformRef}
                    className={cn(
                      "w-full transition-opacity duration-200 bg-muted/40 rounded-md",
                      isLoading && "opacity-50"
                    )}
                    style={{ minHeight: '32px' }}
                  />
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between text-xs z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                    <span className="px-2 py-1 rounded-bl bg-background/80 text-foreground">
                      {currentTime}
                    </span>
                    <span className="px-2 py-1 rounded-br bg-background/80 text-foreground">
                      {duration}
                    </span>
                  </div>
                </div>
              </div>
            )}

          </div>
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/90">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
      </div>

      <Dialog open={isTimestampDialogOpen} onOpenChange={setIsTimestampDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Jump to Timestamp</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="timestamp">Enter timestamp (MM:SS or HH:MM:SS)</Label>
              <Input
                id="timestamp"
                value={timestampInput}
                onChange={(e) => setTimestampInput(e.target.value)}
                placeholder="00:00"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    jumpToTimestamp(timestampInput);
                  }
                }}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => jumpToTimestamp(timestampInput)}>
              Jump
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}