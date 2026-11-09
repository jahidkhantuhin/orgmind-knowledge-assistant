import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ThemeProvider } from '../components/theme-provider';
import { FeedbackProvider } from '../components/feedback-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'OrgMind — Company knowledge, clearly connected',
  description: 'A private AI knowledge assistant for your organization.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try { if (localStorage.getItem('orgmind-theme') === 'dark') document.documentElement.classList.add('dark'); } catch {}",
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <FeedbackProvider>{children}</FeedbackProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
