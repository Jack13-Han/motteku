'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import AuthForm from '@/components/AuthForm';

export default function AuthRouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mode = pathname === '/login' ? 'login' : pathname === '/register' ? 'register' : null;

  return mode ? <AuthForm mode={mode} /> : children;
}
