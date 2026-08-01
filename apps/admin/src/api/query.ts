import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        return status !== 401 && status !== 403 && failureCount < 2;
      },
    },
  },
});
