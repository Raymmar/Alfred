import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from './use-user';
import { useToast } from './use-toast';

type UserSettings = {
  openaiApiKey?: string;
  defaultPrompt?: string;
  todoPrompt?: string;
  systemPrompt?: string; // Added new field for chat system prompt
};

type RequestResult = {
  ok: true;
} | {
  ok: false;
  message: string;
};

async function updateSettings(settings: UserSettings): Promise<RequestResult> {
  try {
    console.log('Sending settings update request');

    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
      credentials: 'include',
    });

    if (!response.ok) {
      const data = await response.json();
      console.error('Settings update failed:', data);
      return {
        ok: false,
        message: data.message || response.statusText,
      };
    }

    await response.json();
    console.log('Settings update successful');
    return { ok: true };
  } catch (error: any) {
    console.error('Settings update error:', error);
    return {
      ok: false,
      message: error.message || 'Failed to update settings',
    };
  }
}

export function useSettings() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  console.log('useSettings hook render', {
    hasUser: !!user,
    userData: user ? {
      id: user.id,
      username: user.username,
      hasOpenAiKey: !!user.openaiApiKey,
      hasDefaultPrompt: !!user.defaultPrompt,
      hasTodoPrompt: !!user.todoPrompt,
      hasSystemPrompt: !!user.systemPrompt // Added log for new field
    } : null
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
      toast({
        title: 'Settings Updated',
        description: 'Your settings have been saved successfully.',
      });
    },
    onError: (error: Error) => {
      console.error('Settings mutation error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update settings',
        variant: 'destructive',
      });
    },
  });

  // Return actual settings values instead of empty strings when user exists
  const settings = user ? {
    openaiApiKey: user.openaiApiKey ?? '',
    defaultPrompt: user.defaultPrompt ?? '',
    todoPrompt: user.todoPrompt ?? '',
    systemPrompt: user.systemPrompt ?? '', // Added new field
  } : null;

  console.log('useSettings returning', {
    hasSettings: !!settings,
    isUpdating: updateSettingsMutation.isPending
  });

  return {
    settings,
    updateSettings: updateSettingsMutation.mutateAsync,
    isUpdating: updateSettingsMutation.isPending
  };
}