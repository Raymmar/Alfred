import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnMount: false,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      staleTime: Infinity, // Keep data fresh indefinitely
      gcTime: Infinity, // Never remove from cache
      queryFn: async ({ queryKey }) => {
        // Ensure queryKey is always treated as an array
        const endpoint = Array.isArray(queryKey)
          ? queryKey.join('/')
          : queryKey;

        const res = await fetch(`/api/${endpoint}`, {
          credentials: "include",
        });

        if (!res.ok) {
          if (res.status === 401) {
            return null;
          }

          if (res.status >= 500) {
            throw new Error(`${res.status}: ${res.statusText}`);
          }

          throw new Error(`${res.status}: ${await res.text()}`);
        }

        return res.json();
      },
    },
    mutations: {
      retry: false,
    }
  },
});

// Initialize persisted cache from localStorage
const CACHE_KEY = 'ALFRED_QUERY_CACHE';

// Load persisted data on client initialization
const loadPersistedCache = () => {
  try {
    const persistedCache = localStorage.getItem(CACHE_KEY);
    if (persistedCache) {
      const cache = JSON.parse(persistedCache);

      // Only restore message-related queries with array query keys
      Object.entries(cache.queries || {}).forEach(([queryHash, query]: [string, any]) => {
        if (Array.isArray(query.queryKey) && query.queryKey[0] === 'messages') {
          queryClient.setQueryData(query.queryKey, query.state.data);
        }
      });
    }
  } catch (error) {
    console.warn('Failed to load persisted cache:', error);
  }
};

// Save cache to localStorage whenever it changes
queryClient.getQueryCache().subscribe(async (event) => {
  if (event?.query?.queryKey?.[0] === 'messages') {
    try {
      const state = queryClient.getQueryCache().getAll()
        .filter(query => Array.isArray(query.queryKey) && query.queryKey[0] === 'messages')
        .reduce((acc: { queries: Record<string, any> }, query) => {
          acc.queries[query.queryHash] = {
            queryKey: query.queryKey,
            state: { data: query.state.data }
          };
          return acc;
        }, { queries: {} });

      localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn('Failed to persist cache:', error);
    }
  }
});

// Load the persisted cache when the app starts
if (typeof window !== 'undefined') {
  loadPersistedCache();
}