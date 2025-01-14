import { useState, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface RecorderOptions {
  audioDeviceId: string | null;
  waveformRef?: HTMLDivElement | null;
}

export function useRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const dataArray = useRef<Uint8Array | null>(null);
  const animationFrame = useRef<number>();
  const chunks = useRef<Blob[]>([]);
  const currentOptions = useRef<RecorderOptions | null>(null);
  const canvasContext = useRef<CanvasRenderingContext2D | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const chunkCount = useRef(0);
  const totalSize = useRef(0);

  const cleanup = useCallback((stopTracks = false) => {
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = undefined;
    }

    if (mediaStream.current && stopTracks) {
      mediaStream.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Error stopping track:', e);
        }
      });
      mediaStream.current = null;
    }

    if (mediaRecorder.current) {
      try {
        if (mediaRecorder.current.state !== 'inactive') {
          mediaRecorder.current.stop();
        }
      } catch (e) {
        console.warn('Error stopping recorder:', e);
      }
      mediaRecorder.current = null;
    }

    if (audioContext.current) {
      try {
        audioContext.current.close();
      } catch (e) {
        console.warn('Error closing audio context:', e);
      }
      audioContext.current = null;
    }

    if (canvas.current) {
      try {
        const parent = canvas.current.parentNode;
        if (parent) {
          parent.removeChild(canvas.current);
        }
      } catch (e) {
        console.warn('Error removing canvas:', e);
      }
      canvas.current = null;
      canvasContext.current = null;
    }

    analyser.current = null;
    dataArray.current = null;
    chunks.current = [];
    chunkCount.current = 0;
    totalSize.current = 0;
    setIsRecording(false);
  }, []);

  // Function to periodically save and clear chunks
  const processSavedChunks = async () => {
    if (chunks.current.length === 0) return;

    const currentChunks = chunks.current;
    chunks.current = []; // Reset chunks array

    try {
      const blob = new Blob(currentChunks, { type: mediaRecorder.current?.mimeType || 'audio/webm;codecs=opus' });

      // Create FormData and upload
      const formData = new FormData();
      const timestamp = Date.now();
      const filename = `recording-${timestamp}-part-${chunkCount.current}.webm`;
      formData.append('recording', blob, filename);

      const response = await fetch('/api/recordings/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        console.error('Failed to upload chunk:', response.statusText);
      }

      chunkCount.current++;
      console.log(`Processed chunk ${chunkCount.current}. Size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
    } catch (error) {
      console.error('Error processing chunks:', error);
    }
  };

  const setupVisualization = useCallback((container: HTMLDivElement) => {
    canvas.current = document.createElement('canvas');
    canvas.current.style.width = '100%';
    canvas.current.style.height = '100%';
    canvas.current.style.display = 'block';

    const rect = container.getBoundingClientRect();
    canvas.current.width = rect.width;
    canvas.current.height = rect.height;

    container.innerHTML = '';
    container.appendChild(canvas.current);

    canvasContext.current = canvas.current.getContext('2d');

    if (canvasContext.current) {
      canvasContext.current.fillStyle = '#385F71';
    }

    console.log('Visualization setup complete:', {
      width: canvas.current.width,
      height: canvas.current.height,
      hasContext: !!canvasContext.current
    });
  }, []);

  const visualize = useCallback(() => {
    if (!analyser.current || !dataArray.current || !canvasContext.current || !canvas.current) {
      return;
    }

    const draw = () => {
      if (!analyser.current || !dataArray.current || !canvasContext.current || !canvas.current) {
        return;
      }

      try {
        analyser.current.getByteFrequencyData(dataArray.current);

        const width = canvas.current.width;
        const height = canvas.current.height;
        const barWidth = 2;
        const barGap = 1;
        const numBars = Math.floor(width / (barWidth + barGap));

        canvasContext.current.clearRect(0, 0, width, height);

        for (let i = 0; i < numBars; i++) {
          const dataIndex = Math.floor((i / numBars) * dataArray.current.length);
          const value = dataArray.current[dataIndex];
          const percent = value / 255;
          const barHeight = (height * percent) * 0.9;

          const x = i * (barWidth + barGap);
          const y = (height - barHeight) / 2;

          canvasContext.current.fillRect(x, y, barWidth, barHeight);
        }
      } catch (error) {
        console.error('Visualization error:', error);
      }

      animationFrame.current = requestAnimationFrame(draw);
    };

    draw();
  }, []);

  const startRecording = async (options: RecorderOptions) => {
    try {
      currentOptions.current = options;
      const { audioDeviceId, waveformRef } = options;

      cleanup(true);

      if (!waveformRef) {
        throw new Error('Waveform container reference is required');
      }

      const audioConstraints: MediaTrackConstraints = {
        deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined,
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      };

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      mediaStream.current = audioStream;

      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.current.createMediaStreamSource(audioStream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 2048;
      source.connect(analyser.current);

      dataArray.current = new Uint8Array(analyser.current.frequencyBinCount);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      // Increased chunk size to 5 seconds for better performance with long recordings
      const recorder = new MediaRecorder(audioStream, {
        mimeType,
        audioBitsPerSecond: 128000
      });

      chunks.current = [];
      chunkCount.current = 0;
      totalSize.current = 0;

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunks.current.push(e.data);
          totalSize.current += e.data.size;

          // Process chunks when total size exceeds 10MB
          if (totalSize.current >= 10 * 1024 * 1024) {
            await processSavedChunks();
            totalSize.current = 0;
          }
        }
      };

      recorder.onerror = (event: Event) => {
        console.error('MediaRecorder error:', event);
        cleanup(true);
        const error = event as ErrorEvent;
        throw new Error('Recording failed: ' + (error.message || 'Unknown error'));
      };

      setupVisualization(waveformRef);

      mediaRecorder.current = recorder;
      // Increased timeslice to 5000ms (5 seconds) for more efficient chunking
      recorder.start(5000);
      setIsRecording(true);

      visualize();

      console.log('Recording started with optimized settings');

    } catch (error) {
      console.error('Recording error:', error);
      cleanup(true);
      throw new Error(
        error instanceof Error
          ? error.message
          : 'Failed to start recording. Please check your microphone permissions.'
      );
    }
  };

  const stopRecording = async () => {
    return new Promise<{ blob: Blob, filePath: string }>((resolve, reject) => {
      if (!mediaRecorder.current || !mediaStream.current || !currentOptions.current) {
        reject(new Error('No active recording found'));
        return;
      }

      mediaRecorder.current.onstop = async () => {
        try {
          // Process any remaining chunks
          await processSavedChunks();

          if (chunkCount.current === 0 && chunks.current.length === 0) {
            throw new Error('No audio data was recorded');
          }

          const mimeType = mediaRecorder.current?.mimeType || 'audio/webm;codecs=opus';
          const finalBlob = new Blob(chunks.current, { type: mimeType });

          if (finalBlob.size === 0) {
            throw new Error('Recorded audio is empty');
          }

          const timestamp = Date.now();
          const filename = `recording-${timestamp}-final.webm`;

          const formData = new FormData();
          formData.append('recording', finalBlob, filename);

          const response = await fetch('/api/recordings/upload', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload recording to server');
          }

          const { filename: savedFilename } = await response.json();
          console.log('Final recording uploaded:', savedFilename);

          cleanup(true);
          resolve({ blob: finalBlob, filePath: savedFilename });
        } catch (error) {
          console.error('Error saving recording:', error);
          cleanup(true);
          reject(new Error('Failed to save recording: ' + (error instanceof Error ? error.message : 'Unknown error')));
        }
      };

      try {
        mediaRecorder.current.stop();
      } catch (error) {
        console.error('Error stopping recording:', error);
        cleanup(true);
        reject(new Error('Failed to stop recording'));
      }
    });
  };

  return {
    isRecording,
    startRecording,
    stopRecording,
  };
}