import { useState, useEffect, useRef } from 'react';

interface MediaDeviceState {
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  selectedAudioInput: string | null;
  selectedVideoInput: string | null;
}

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceState>({
    audioInputs: [],
    videoInputs: [],
    selectedAudioInput: null,
    selectedVideoInput: 'none', // Set default to 'none' for audio-only recording
  });

  const currentStream = useRef<MediaStream | null>(null);

  const stopCurrentStream = () => {
    if (currentStream.current) {
      currentStream.current.getTracks().forEach(track => track.stop());
      currentStream.current = null;
    }
  };

  const loadDevices = async () => {
    try {
      // Request permissions first - only request video if explicitly needed
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true, 
        video: true 
      });

      // Stop the initial stream since we only needed it for permissions
      stream.getTracks().forEach(track => track.stop());

      // Now enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();

      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const videoInputs = devices.filter(device => device.kind === 'videoinput');

      setDevices(prev => {
        const newState = {
          audioInputs,
          videoInputs,
          selectedAudioInput: prev.selectedAudioInput || audioInputs[0]?.deviceId || null,
          selectedVideoInput: prev.selectedVideoInput || 'none', // Maintain 'none' as default
        };

        // Only start video stream if explicitly selected
        if (newState.selectedVideoInput && newState.selectedVideoInput !== 'none') {
          getVideoStream(newState.selectedVideoInput);
        }

        return newState;
      });
    } catch (error) {
      console.error('Error accessing media devices:', error);
      setDevices({
        audioInputs: [],
        videoInputs: [],
        selectedAudioInput: null,
        selectedVideoInput: 'none', // Keep 'none' as fallback
      });
    }
  };

  useEffect(() => {
    loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
      stopCurrentStream();
    };
  }, []);

  const getVideoStream = async (deviceId: string | null = null) => {
    // If deviceId is null or 'none', stop any existing stream and return null
    if (!deviceId || deviceId === 'none') {
      stopCurrentStream();
      return null;
    }

    try {
      // If we already have a stream with the same device ID, reuse it
      if (currentStream.current) {
        const videoTrack = currentStream.current.getVideoTracks()[0];
        if (videoTrack && videoTrack.getSettings().deviceId === deviceId) {
          if (videoTrack.readyState === 'live') {
            console.log('Reusing existing video stream:', deviceId);
            return currentStream.current;
          } else {
            console.log('Existing video track is not live, creating new stream');
          }
        }
      }

      // Otherwise, create a new stream
      console.log('Creating new video stream for device:', deviceId);
      stopCurrentStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      // Verify the stream is active before returning
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        throw new Error('Failed to get live video track');
      }

      console.log('Successfully created video stream:', stream.id);
      currentStream.current = stream;
      return stream;
    } catch (error) {
      console.error('Error getting video stream:', error);
      stopCurrentStream();
      return null;
    }
  };

  const selectAudioInput = (deviceId: string) => {
    setDevices(prev => ({ ...prev, selectedAudioInput: deviceId }));
  };

  const selectVideoInput = async (deviceId: string) => {
    setDevices(prev => ({ ...prev, selectedVideoInput: deviceId }));
    return deviceId === 'none' ? null : getVideoStream(deviceId);
  };

  return {
    ...devices,
    selectAudioInput,
    selectVideoInput,
    getVideoStream,
    refreshDevices: loadDevices,
  };
}