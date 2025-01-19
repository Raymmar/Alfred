import { useState, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface RecorderOptions {
  audioDeviceId: string | null;
  waveformRef?: HTMLDivElement | null;
}

const CHUNK_INTERVAL = 300000; // Save every 5 minutes
const MAX_CHUNKS_IN_MEMORY = 3; // Keep only last 3 chunks in memory

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
  const chunkInterval = useRef<NodeJS.Timeout>();
  const uploadedChunks = useRef<string[]>([]);

  const cleanup = useCallback((stopTracks = false) => {
    if (chunkInterval.current) {
      clearInterval(chunkInterval.current);
      chunkInterval.current = undefined;
    }

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
    uploadedChunks.current = [];
    setIsRecording(false);
  }, []);

  const uploadChunk = async (audioBlob: Blob, isLastChunk = false): Promise<string> => {
    const formData = new FormData();
    const timestamp = Date.now();
    const filename = `recording-${timestamp}-${isLastChunk ? 'final' : 'chunk'}.webm`;
    formData.append('recording', audioBlob, filename);
    formData.append('isLastChunk', String(isLastChunk));

    if (uploadedChunks.current.length > 0) {
      formData.append('previousChunks', JSON.stringify(uploadedChunks.current));
    }

    try {
      const response = await fetch('/api/recordings/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to upload chunk');
      }

      const { filename: savedFilename } = await response.json();
      uploadedChunks.current.push(savedFilename);
      return savedFilename;
    } catch (error) {
      console.error('Error uploading chunk:', error);
      throw error;
    }
  };

  const saveCurrentChunk = async () => {
    if (chunks.current.length === 0) return;

    const currentBlob = new Blob(chunks.current, { type: 'audio/webm;codecs=opus' });
    if (currentBlob.size === 0) return;

    try {
      await uploadChunk(currentBlob);
      // Clear memory after successful upload
      chunks.current = [];
    } catch (error) {
      console.error('Error saving chunk:', error);
      throw error;
    }
  };

  // Optimized visualization with memory management
  const setupVisualization = useCallback((container: HTMLDivElement) => {
    if (!container) return;

    // Clean up existing canvas
    if (canvas.current) {
      const parent = canvas.current.parentNode;
      if (parent) {
        parent.removeChild(canvas.current);
      }
    }

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

  // Memory-efficient visualization
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
        const samplingRate = Math.ceil(dataArray.current.length / numBars);

        canvasContext.current.clearRect(0, 0, width, height);

        for (let i = 0; i < numBars; i++) {
          const dataIndex = Math.floor(i * samplingRate);
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

      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.current.createMediaStreamSource(audioStream);
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 2048;
      source.connect(analyser.current);

      dataArray.current = new Uint8Array(analyser.current.frequencyBinCount);

      const recorder = new MediaRecorder(audioStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      });

      chunks.current = [];
      uploadedChunks.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunks.current.push(event.data);

          // If chunks exceed threshold, trigger save
          if (chunks.current.length > MAX_CHUNKS_IN_MEMORY) {
            saveCurrentChunk().catch(console.error);
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
      recorder.start(1000); // Collect data every second for more frequent chunks

      // Set up periodic chunk saving
      chunkInterval.current = setInterval(() => {
        saveCurrentChunk().catch(console.error);
      }, CHUNK_INTERVAL);

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
          // Save any remaining chunks
          const finalBlob = new Blob(chunks.current, { 
            type: 'audio/webm;codecs=opus'
          });

          if (finalBlob.size === 0 && uploadedChunks.current.length === 0) {
            throw new Error('No audio data was recorded');
          }

          // Upload final chunk with flag
          const savedFilename = await uploadChunk(finalBlob, true);

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