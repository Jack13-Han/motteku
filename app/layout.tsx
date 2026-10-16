import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Motteku | Group Trip Planner', description: 'Plan together. Pack smarter.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
