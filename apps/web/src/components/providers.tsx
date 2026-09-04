"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";

import { config } from "@/lib/wagmi";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "@nuts/ui/components/sonner";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  // One client per browser session. Created in state so React does not share it
  // across requests during SSR.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors />
        </ThemeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
