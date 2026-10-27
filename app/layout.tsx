import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n';
export const metadata: Metadata = { title: 'Motteku | Group Trip Planner', description: 'Plan together. Pack smarter.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body><LanguageProvider>{children}</LanguageProvider></body></html>;
}
