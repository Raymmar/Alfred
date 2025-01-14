import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface CameraPreviewProps {
  stream: MediaStream | null;
  showPlaceholder?: boolean;
}

export function CameraPreview({ stream, showPlaceholder = true }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    let mounted = true;

    const setupVideo = async () => {
      // Don't update if the stream hasn't actually changed
      if (stream === streamRef.current) return;

      try {
        setIsLoading(true);
        setError(null);

        // Cleanup previous stream if exists
        if (streamRef.current) {
          console.log('Cleaning up previous stream');
          streamRef.current = null;
          videoElement.srcObject = null;
        }

        if (stream && stream.active) {
          console.log('Setting up new video preview stream:', stream.id);
          streamRef.current = stream;
          videoElement.srcObject = stream;
          
          // Wait for loadedmetadata event before playing
          await new Promise<void>((resolve) => {
            const handleLoadedMetadata = () => {
              videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
              resolve();
            };
            videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
          });

          await videoElement.play();
          console.log('Video preview playing');
        } else {
          console.log('No active stream available');
        }
      } catch (error) {
        console.error('Error setting up video:', error);
        if (mounted) {
          setError('Failed to setup video preview');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    // Use requestAnimationFrame to ensure smooth stream setup
    const rafId = requestAnimationFrame(() => setupVideo());

    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
      
      // Only cleanup stream if component is unmounting
      if (!videoElement.srcObject) return;
      try {
        videoElement.srcObject = null;
        if (streamRef.current && streamRef.current !== stream) {
          console.log('Cleaning up stream on unmount');
          streamRef.current = null;
        }
      } catch (error) {
        console.error('Error cleaning up video:', error);
      }
    };
  }, [stream]);

  if (!stream && showPlaceholder) {
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No camera selected</p>
      </div>
    );
  }

  if (!stream && !showPlaceholder) {
    return null;
  }

  return (
    <div className="relative w-full aspect-video bg-muted rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}
