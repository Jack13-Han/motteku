'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { ArrowLeft, CheckCircle2, LockKeyhole, Mail, UserRound } from 'lucide-react';
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
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [profileWarning, setProfileWarning] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!firebaseConfigured || !auth) {
      setAuthReady(true);
      setError('Firebase Authentication is not configured. Check your Firebase project settings.');
      return;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setAuthReady(true);
      // Let the active submission finish saving the profile and showing success.
      if (currentUser && !currentUser.isAnonymous && !submittingRef.current) router.replace('/');
    });
  }, [router]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => router.replace('/'), 1200);
    return () => window.clearTimeout(timer);
  }, [success, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !firebaseConfigured || submittingRef.current || success) return;
    if (isRegister && !name.trim()) {
      setError('Enter a display name.');
      return;
    }
    setError('');
    setProfileWarning('');
    submittingRef.current = true;
    setBusy(true);
    try {
      const normalizedEmail = email.trim();
      if (isRegister) {
        const currentUser = auth.currentUser;
        const anonymousUser = currentUser?.isAnonymous ? currentUser : null;
        const credential = EmailAuthProvider.credential(normalizedEmail, password);
        const result = anonymousUser
          ? await linkWithCredential(anonymousUser, credential)
          : await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        try {
          await updateProfile(result.user, { displayName: name.trim() });
        } catch {
          // Account creation already succeeded; do not ask the user to register again.
          setProfileWarning('Your account was created, but your name could not be saved. Update it in account settings.');
        }
      } else {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
      }
      setSuccess(true);
    } catch (submitError) {
      submittingRef.current = false;
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

        {success ? <div className="auth-success" role="status" aria-live="polite">
          <CheckCircle2 className="auth-success-icon" size={38} aria-hidden="true" />
          <h2 className="auth-success-title">{t(isRegister ? 'Account created successfully!' : 'Signed in successfully!')}</h2>
          <p className="auth-success-message">{t('You are signed in. Opening Motteku…')}</p>
          {profileWarning && <p className="auth-profile-warning">{t(profileWarning)}</p>}
          <button type="button" className="primary auth-submit" onClick={() => router.replace('/')}>{t('Continue to Motteku')}</button>
        </div> : <form className="auth-form" onSubmit={handleSubmit} aria-busy={busy}>
          {isRegister && (
            <label>
              {t('Full name')}
              <span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" required maxLength={80} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Your name')} /></span>
            </label>
          )}
          <label>
            {t('Email address')}
            <span className="auth-input-wrap"><Mail size={17} /><input autoComplete="email" type="email" required disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></span>
          </label>
          <label>
            {t('Password')}
            <span className="auth-input-wrap"><LockKeyhole size={17} /><input autoComplete={isRegister ? 'new-password' : 'current-password'} type="password" required minLength={6} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('At least 6 characters')} /></span>
          </label>
          {error && <p className="auth-error" role="alert">{translatedError(error)}</p>}
          <button className="primary auth-submit" type="submit" disabled={busy || !authReady || !firebaseConfigured}>
            {busy ? t('Please wait…') : t(isRegister ? 'Create account' : 'Log in')}
          </button>
        </form>}

        {!success && <p className="auth-switch">
          {isRegister ? t('Already have an account?') : t("Don't have an account?")}{' '}
          <Link href={isRegister ? '/login' : '/register'}>{t(isRegister ? 'Log in' : 'Register')}</Link>
        </p>}
        {language === 'ja' && <p className="auth-note">{t('Your group trip data stays in your account.')}</p>}
      </section>
    </main>
  );
}

