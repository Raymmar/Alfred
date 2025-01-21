import { useState, useEffect } from 'react';

interface MediaDeviceState {
  audioInputs: MediaDeviceInfo[];
  selectedAudioInput: string | null;
}

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceState>({
    audioInputs: [],
    selectedAudioInput: null,
  });

  const loadDevices = async () => {
    try {
      // Request permissions only for audio
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true,
      });

      // Stop the initial stream since we only needed it for permissions
      stream.getTracks().forEach(track => track.stop());

      // Now enumerate devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');

      setDevices(prev => ({
        audioInputs,
        selectedAudioInput: prev.selectedAudioInput || audioInputs[0]?.deviceId || null,
      }));
    } catch (error) {
      console.error('Error accessing media devices:', error);
      setDevices({
        audioInputs: [],
        selectedAudioInput: null,
      });
    }
  };

  useEffect(() => {
    loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
    };
  }, []);

  const selectAudioInput = (deviceId: string) => {
    setDevices(prev => ({ ...prev, selectedAudioInput: deviceId }));
  };

  return {
    ...devices,
    selectAudioInput,
    refreshDevices: loadDevices,
  };
}