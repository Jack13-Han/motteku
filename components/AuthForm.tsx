'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import { ArrowLeft, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { auth, firebaseConfigured } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n';

type AuthFormProps = { mode: 'login' | 'register' };

function authErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/user-not-found': 'No account was found for this email.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'An account already exists with this email.',
    'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/operation-not-allowed': 'Email and password sign-in is not enabled in Firebase.',
    'auth/credential-already-in-use': 'This email already belongs to another account. Log in instead.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/network-request-failed': 'Could not connect. Check your internet connection.',
  };
  return messages[code || ''] || 'Something went wrong. Please try again.';
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const isRegister = mode === 'register';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseConfigured || !auth) {
      setAuthReady(true);
      setError('Firebase Authentication is not configured. Check your Firebase project settings.');
      return;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser && !currentUser.isAnonymous) router.replace('/');
    });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !firebaseConfigured) return;
    setError('');
    setBusy(true);
    try {
      const normalizedEmail = email.trim();
      if (isRegister) {
        const anonymousUser = user?.isAnonymous ? user : null;
        const credential = EmailAuthProvider.credential(normalizedEmail, password);
        const result = anonymousUser
          ? await linkWithCredential(anonymousUser, credential)
          : await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        await updateProfile(result.user, { displayName: name.trim() });
      } else {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
      }
      router.replace('/');
      router.refresh();
    } catch (submitError) {
      setError(authErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  }

  const translatedError = (message: string) => {
    if (message === 'Firebase Authentication is not configured. Check your Firebase project settings.') return t(message);
    return t(message);
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-back" href="/" aria-label={t('Back to Motteku')}>
          <ArrowLeft size={16} /> {t('Back to Motteku')}
        </Link>
        <div className="auth-brand">
          <span className="auth-mark">M</span>
          <span>Motteku</span>
        </div>
        <p className="auth-eyebrow">{t('TRAVEL TOGETHER')}</p>
        <h1 id="auth-title">{t(isRegister ? 'Create your Motteku account' : 'Welcome back')}</h1>
        <p className="auth-description">
          {t(isRegister ? 'Create an account to keep your trip plans with you.' : 'Log in to continue planning with your group.')}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && (
            <label>
              {t('Full name')}
              <span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Your name')} /></span>
            </label>
          )}
          <label>
            {t('Email address')}
            <span className="auth-input-wrap"><Mail size={17} /><input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></span>
          </label>
          <label>
            {t('Password')}
            <span className="auth-input-wrap"><LockKeyhole size={17} /><input autoComplete={isRegister ? 'new-password' : 'current-password'} type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('At least 6 characters')} /></span>
          </label>
          {error && <p className="auth-error" role="alert">{translatedError(error)}</p>}
          <button className="primary auth-submit" type="submit" disabled={busy || !authReady || !firebaseConfigured}>
            {busy ? t('Please wait…') : t(isRegister ? 'Create account' : 'Log in')}
          </button>
        </form>

        <p className="auth-switch">
          {isRegister ? t('Already have an account?') : t("Don't have an account?")}{' '}
          <Link href={isRegister ? '/login' : '/register'}>{t(isRegister ? 'Log in' : 'Register')}</Link>
        </p>
        {language === 'ja' && <p className="auth-note">{t('Your group trip data stays in your account.')}</p>}
      </section>
    </main>
  );
}

