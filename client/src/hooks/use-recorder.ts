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
    setIsRecording(false);
  }, []);

  const setupVisualization = useCallback((container: HTMLDivElement) => {
    if (!container) return;

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
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      mediaStream.current = audioStream;

      // Set up audio context and analyzer after getting stream
      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.current.createMediaStreamSource(audioStream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 2048;
      source.connect(analyser.current);

      dataArray.current = new Uint8Array(analyser.current.frequencyBinCount);

      // Create and configure MediaRecorder
      const recorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      });

      chunks.current = [];

      // Handle incoming audio data
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);
        }
      };

      // Set up error handler
      recorder.onerror = (event: Event) => {
        console.error('MediaRecorder error:', event);
        cleanup(true);
        const error = event as ErrorEvent;
        throw new Error('Recording failed: ' + (error.message || 'Unknown error'));
      };

      // Set up visualization
      setupVisualization(waveformRef);

      // Start recording
      mediaRecorder.current = recorder;
      recorder.start(100); // Collect data every 100ms for smoother visualization
      setIsRecording(true);
      visualize();

      console.log('Recording started successfully');

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
      if (!mediaRecorder.current || mediaRecorder.current.state === 'inactive') {
        cleanup(true);
        reject(new Error('No active recording found'));
        return;
      }

      mediaRecorder.current.onstop = async () => {
        try {
          if (chunks.current.length === 0) {
            throw new Error('No audio data was recorded');
          }

          const finalBlob = new Blob(chunks.current, { 
            type: 'audio/webm;codecs=opus'
          });

          if (finalBlob.size === 0) {
            throw new Error('Recorded audio is empty');
          }

          const formData = new FormData();
          const timestamp = Date.now();
          const filename = `recording-${timestamp}.webm`;
          formData.append('recording', finalBlob, filename);

          const response = await fetch('/api/recordings/upload', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            throw new Error('Failed to upload recording to server');
          }

          const { filename: savedFilename } = await response.json();

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