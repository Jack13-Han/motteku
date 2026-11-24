'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import { CheckCircle2, CircleAlert, Eye, EyeOff, Info, LoaderCircle, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { auth, firebaseConfigured } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n';
import { safeReturnPath } from '@/lib/trips';

type AuthFormProps = { mode: 'login' | 'register' };
type PetalConfig = { left: number; size: number; duration: number; delay: number; animation: 'auth-petal-drift' | 'auth-petal-drift-reverse' };
const backPetals: PetalConfig[] = [
  { left: 8, size: 16, duration: 14, delay: -2, animation: 'auth-petal-drift' },
  { left: 21, size: 14, duration: 17, delay: -9, animation: 'auth-petal-drift-reverse' },
  { left: 36, size: 18, duration: 15, delay: -5, animation: 'auth-petal-drift' },
  { left: 49, size: 15, duration: 18, delay: -12, animation: 'auth-petal-drift-reverse' },
  { left: 62, size: 17, duration: 16, delay: -3, animation: 'auth-petal-drift' },
  { left: 75, size: 14, duration: 19, delay: -14, animation: 'auth-petal-drift-reverse' },
  { left: 86, size: 18, duration: 15, delay: -7, animation: 'auth-petal-drift' },
  { left: 95, size: 15, duration: 17, delay: -10, animation: 'auth-petal-drift-reverse' },
];
const frontPetals: PetalConfig[] = [
  { left: 4, size: 24, duration: 11.5, delay: -1, animation: 'auth-petal-drift-reverse' },
  { left: 15, size: 20, duration: 13.5, delay: -6, animation: 'auth-petal-drift' },
  { left: 27, size: 26, duration: 12, delay: -3.5, animation: 'auth-petal-drift-reverse' },
  { left: 39, size: 21, duration: 14.5, delay: -9.5, animation: 'auth-petal-drift' },
  { left: 52, size: 25, duration: 12.5, delay: -5, animation: 'auth-petal-drift-reverse' },
  { left: 64, size: 22, duration: 15, delay: -11, animation: 'auth-petal-drift' },
  { left: 73, size: 24, duration: 13, delay: -2.5, animation: 'auth-petal-drift-reverse' },
  { left: 82, size: 19, duration: 14, delay: -8, animation: 'auth-petal-drift' },
  { left: 90, size: 26, duration: 11.8, delay: -4, animation: 'auth-petal-drift-reverse' },
  { left: 97, size: 20, duration: 13.8, delay: -7.5, animation: 'auth-petal-drift' },
];
const sakuraPetalColors = ['#ffb7d5', '#ff9ec7', '#ffd6e8', '#fff', '#ffc4df'];

function FallingPetals({ petals, depth }: { petals: PetalConfig[]; depth: 'back' | 'front' }) {
  return (
    <div className={`auth-petals auth-petals-${depth}`} aria-hidden="true">
      {petals.map((petal, index) => {
        const color = sakuraPetalColors[index % sakuraPetalColors.length];
        return (
          <span
            className="auth-petal"
            key={`${depth}-${petal.left}`}
            style={{
              left: `${petal.left}%`,
              width: `${petal.size}px`,
              height: `${petal.size}px`,
              animationName: petal.animation,
              animationDuration: `${petal.duration}s`,
              animationDelay: `${petal.delay}s`,
            }}
          >
            <svg viewBox="0 0 36 36">
              <path d="M18 32C10 27 5 19 7 11 9 5 14 4 18 9c4-5 9-4 11 2 2 8-3 16-11 21Z" fill={color} />
              <path d="M18 29c-4-4-7-10-5-16 2-3 4-2 5 1 1-3 3-4 5-1 2 6-1 12-5 16Z" fill={color === '#fff' ? '#ffd6e8' : '#fff'} opacity=".45" />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

function TravelScenery() {
  return (
    <div className="auth-scenery" aria-hidden="true">
      <svg className="auth-landscape" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="auth-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#c9d8ff" />
            <stop offset=".38" stopColor="#ddd2ff" />
            <stop offset=".75" stopColor="#fce1f2" />
            <stop offset="1" stopColor="#f5f3ff" />
          </linearGradient>
          <radialGradient id="auth-sun">
            <stop stopColor="#fff" stopOpacity=".95" />
            <stop offset=".55" stopColor="#fff0fa" stopOpacity=".62" />
            <stop offset="1" stopColor="#fce1f2" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="auth-fuji" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#6b7ff2" />
            <stop offset="52%" stopColor="#8b99fa" />
            <stop offset="100%" stopColor="#c4c2ff" />
          </linearGradient>
          <linearGradient id="auth-snow" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#fff" />
            <stop offset="1" stopColor="#e7eaff" />
          </linearGradient>
          <linearGradient id="auth-far-hill" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#c9bfff" />
            <stop offset="1" stopColor="#b4a6f8" />
          </linearGradient>
          <linearGradient id="auth-near-hill" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#ddd4ff" />
            <stop offset="1" stopColor="#c7bafa" />
          </linearGradient>
          <linearGradient id="auth-meadow" x1="0" x2="0" y1="0" y2="1">
            <stop stopColor="#ede7ff" />
            <stop offset="1" stopColor="#dfd5ff" />
          </linearGradient>
          <linearGradient id="auth-road" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#9a92c8" />
            <stop offset="50%" stopColor="#8a81ba" />
            <stop offset="100%" stopColor="#7b72ad" />
          </linearGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#auth-sky)" />
        <circle className="auth-sun-glow" cx="720" cy="300" r="245" fill="url(#auth-sun)" />
        <circle cx="720" cy="300" r="75" fill="#fff" opacity=".58" />
        <g className="auth-scenic-cloud auth-scenic-cloud-one" fill="#fff" opacity=".76">
          <ellipse cx="140" cy="175" rx="95" ry="24" /><ellipse cx="195" cy="162" rx="64" ry="22" /><ellipse cx="95" cy="168" rx="52" ry="18" />
        </g>
        <g className="auth-scenic-cloud auth-scenic-cloud-two" fill="#fff7fc" opacity=".7">
          <ellipse cx="210" cy="255" rx="115" ry="22" /><ellipse cx="275" cy="244" rx="70" ry="20" /><ellipse cx="145" cy="249" rx="58" ry="16" />
        </g>
        <g className="auth-scenic-cloud auth-scenic-cloud-three" fill="#fff" opacity=".72">
          <ellipse cx="160" cy="120" rx="82" ry="19" /><ellipse cx="210" cy="112" rx="50" ry="16" />
        </g>
        <path d="M275 705c175-65 295-225 383-357q62-14 124 0c88 132 208 292 383 357Z" fill="url(#auth-fuji)" />
        <path d="M720 341q32 0 62 7c88 132 208 292 383 357H750c15-135-5-255-30-364Z" fill="#5b6ce6" opacity=".16" />
        <path d="M658 348q62-14 124 0c30 46 60 89 90 127l-44-23-33 32-39-28-36 36-36-38-38 28-44-24c30-36 60-80 90-126Z" fill="url(#auth-snow)" />
        <path d="M720 341q32 0 62 7c30 46 60 89 90 127l-44-23-33 32-39-28-36 36Z" fill="#c7d2fe" opacity=".32" />
        <path d="M0 655q230-80 490-13t520-10q230 18 430 18v250H0Z" fill="url(#auth-far-hill)" opacity=".72" />
        <path d="M0 705q320-70 690-10t750-15v220H0Z" fill="url(#auth-near-hill)" opacity=".92" />
        <g className="auth-pagoda" transform="translate(215 456)" fill="#9383e8" opacity=".78">
          <rect x="48" y="0" width="4" height="36" rx="2" /><circle cx="50" cy="14" r="4" /><circle cx="50" cy="24" r="3" />
          <path d="M22 42q28-12 56 0l-6 6H28Zm-6 24q34-12 68 0l-7 7H23Zm-6 27q40-13 80 0l-8 7H18Zm-6 29q46-14 92 0l-9 8H13Zm-8 32q54-16 108 0l-10 9H6Z" />
          <path d="M36 48h28v14H36zm-3 27h34v18H33zm-3 27h40v20H30zm-4 28h48v22H26zm-4 32h56v32H22Z" />
        </g>
        <g fill="#ffc5df" opacity=".72">
          <circle cx="170" cy="680" r="34" /><circle cx="205" cy="686" r="24" /><circle cx="385" cy="672" r="28" />
          <circle cx="1055" cy="675" r="32" /><circle cx="1095" cy="682" r="24" /><circle cx="1260" cy="668" r="36" />
        </g>
        <rect y="735" width="1440" height="165" fill="url(#auth-meadow)" />
        <rect y="768" width="1440" height="106" fill="url(#auth-road)" />
        <rect y="766" width="1440" height="5" fill="#f5f3ff" opacity=".9" />
        <rect y="872" width="1440" height="4" fill="#635b96" opacity=".55" />
        <path d="M0 821h1440" stroke="#fff" strokeWidth="4" strokeDasharray="36 28" strokeLinecap="round" opacity=".78" />
        <g opacity=".85">
          <ellipse cx="265" cy="756" rx="7" ry="3.5" fill="#ffb7d5" transform="rotate(-14 265 756)" />
          <ellipse cx="440" cy="884" rx="8" ry="3.8" fill="#ff9ec7" transform="rotate(12 440 884)" />
          <ellipse cx="670" cy="758" rx="6.5" ry="3" fill="#ffd6e8" transform="rotate(-8 670 758)" />
          <ellipse cx="910" cy="886" rx="8" ry="3.5" fill="#ffb7d5" transform="rotate(18 910 886)" />
          <ellipse cx="1150" cy="755" rx="7.5" ry="3.5" fill="#ff9ec7" transform="rotate(-10 1150 755)" />
        </g>
      </svg>
      <svg className="auth-sakura-tree auth-sakura-left" viewBox="0 0 320 900">
        <path d="M-12 900V185Q18 240 36 350q16 140 12 550Z" fill="#4c3b6e" />
        <path d="M22 380q54-85 120-145-50 90-106 195Zm-12-110q54-85 108-138-42 88-92 178Z" fill="#3d2e5c" />
        <g className="auth-tree-crown">
          <circle cx="20" cy="65" r="132" fill="#ffb7d5" /><circle cx="145" cy="95" r="92" fill="#ffd6e8" />
          <circle cx="72" cy="190" r="84" fill="#ff9ec7" /><circle cx="195" cy="45" r="76" fill="#fff" opacity=".85" />
          <circle cx="18" cy="245" r="74" fill="#ffb7d5" /><circle cx="132" cy="222" r="56" fill="#ffe6f2" />
          <circle cx="220" cy="132" r="46" fill="#ffb7d5" opacity=".85" />
        </g>
        <g><circle cx="8" cy="890" r="68" fill="#b79ced" /><circle cx="78" cy="898" r="50" fill="#ffb7d5" /><circle cx="128" cy="908" r="34" fill="#ffd6e8" /></g>
      </svg>
      <svg className="auth-sakura-tree auth-sakura-right" viewBox="0 0 320 900">
        <path d="M230 900q12-390-4-580-8-95 40-175h32q-26 165-14 395l28 360Z" fill="#4c3b6e" />
        <path d="M234 355q-62-80-130-135 60 85 126 185Zm68 545h32V240q-28 130-32 660Z" fill="#3d2e5c" />
        <g className="auth-tree-crown auth-tree-crown-right">
          <circle cx="295" cy="68" r="138" fill="#ff9ec7" /><circle cx="172" cy="108" r="98" fill="#ffd6e8" />
          <circle cx="240" cy="198" r="86" fill="#ffb7d5" /><circle cx="112" cy="175" r="68" fill="#fff" opacity=".86" />
          <circle cx="305" cy="242" r="80" fill="#ff9ec7" /><circle cx="185" cy="238" r="52" fill="#ffe8f3" />
          <circle cx="96" cy="90" r="48" fill="#ffb7d5" opacity=".85" />
        </g>
        <g><circle cx="312" cy="890" r="72" fill="#b79ced" /><circle cx="238" cy="898" r="52" fill="#ffb7d5" /><circle cx="184" cy="908" r="36" fill="#ffd6e8" /></g>
      </svg>
    </div>
  );
}

function TravelCar() {
  return (
    <div className="auth-car-track" aria-hidden="true">
      <div className="auth-car-suspension">
        <svg viewBox="0 0 340 165">
          <defs>
            <linearGradient id="auth-car-headlight" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="#fff9d6" stopOpacity=".82" />
              <stop offset="55%" stopColor="#ffe8f5" stopOpacity=".28" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="auth-car-body" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="55%" stopColor="#ece9ff" />
              <stop offset="100%" stopColor="#d5ceff" />
            </linearGradient>
            <linearGradient id="auth-car-window" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#a5b4fc" />
              <stop offset="100%" stopColor="#6366f1" />
            </linearGradient>
          </defs>
          <ellipse cx="155" cy="146" rx="108" ry="9" fill="#312e81" opacity=".24" />
          <g>
            <circle className="auth-car-puff auth-car-puff-one" cx="42" cy="126" r="6" fill="#fff" opacity=".8" />
            <circle className="auth-car-puff auth-car-puff-two" cx="35" cy="122" r="5" fill="#fce1f2" opacity=".8" />
            <circle className="auth-car-puff auth-car-puff-three" cx="40" cy="128" r="4.5" fill="#ddd2ff" opacity=".8" />
          </g>
          <rect x="44" y="122" width="14" height="6" rx="3" fill="#6d669e" />
          <polygon points="256,105 338,88 338,136 256,122" fill="url(#auth-car-headlight)" />
          <g>
            <rect x="92" y="55" width="102" height="4.5" rx="2.2" fill="#4338ca" />
            <rect x="106" y="57" width="4" height="7" fill="#4338ca" />
            <rect x="176" y="57" width="4" height="7" fill="#4338ca" />
            <rect x="98" y="34" width="54" height="22" rx="6" fill="#7c5cff" stroke="#5b46f6" strokeWidth="2" />
            <path d="M119 34v-4q6-3 12 0v4" fill="none" stroke="#4338ca" strokeWidth="2.5" strokeLinecap="round" />
            <rect x="107" y="35" width="4" height="20" fill="#ddd2ff" opacity=".7" />
            <rect x="139" y="35" width="4" height="20" fill="#ddd2ff" opacity=".7" />
            <rect x="155" y="38" width="34" height="18" rx="6" fill="#ff9ec7" stroke="#ec6fa6" strokeWidth="2" />
            <path d="M167 38v-4q5-2 10 0v4" fill="none" stroke="#d94f8c" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M115 34v23m55-19v19" stroke="#312e81" strokeWidth="2" opacity=".65" />
          </g>
          <path d="M54 126V96q2-14 18-18l16-18q10-7 28-7h62q20 0 34 15l16 16 20 4q14 4 14 18v20q0 8-10 8H64q-10 0-10-8Z" fill="url(#auth-car-body)" stroke="#7c5cff" strokeWidth="2.2" />
          <path d="M55 118h206v8q0 7-9 7H64q-9 0-9-7Z" fill="#7c5cff" opacity=".88" />
          <rect x="64" y="106" width="186" height="4" rx="2" fill="#c4b5fd" opacity=".85" />
          <path d="M93 64q7-5 21-5h28v28H78Z" fill="url(#auth-car-window)" opacity=".85" />
          <g fill="#312e81" opacity=".58">
            <circle cx="116" cy="76" r="7.5" />
            <path d="m110 71 2-7 4 5 4-5 2 7Zm-4 16q10-7 20 0Z" />
          </g>
          <path d="M150 59h26q17 0 29 12l14 16h-69Z" fill="url(#auth-car-window)" opacity=".88" />
          <g fill="#1e1b4b" opacity=".72">
            <circle cx="177" cy="72" r="7.5" />
            <path d="M170 69q7-8 16-1l3 1Zm-6 18q13-9 26 0Z" />
            <path d="m196 87 6-9" stroke="#1e1b4b" strokeWidth="2.5" strokeLinecap="round" />
          </g>
          <path d="m156 61 9 0-12 24h-4Zm-52 0h7L99 85h-7Z" fill="#fff" opacity=".4" />
          <rect x="154" y="96" width="12" height="3.5" rx="1.7" fill="#5b46f6" />
          <rect x="106" y="96" width="12" height="3.5" rx="1.7" fill="#5b46f6" />
          <rect x="212" y="83" width="11" height="7" rx="3.5" fill="#7c5cff" />
          <rect x="53" y="96" width="7" height="14" rx="3" fill="#ff7eb6" />
          <rect x="252" y="96" width="10" height="12" rx="4" fill="#fff7c2" stroke="#f59e0b" />
          <path d="M77 134a24 24 0 0 1 48 0Zm114 0a24 24 0 0 1 48 0Z" fill="#312e81" />
          <g className="auth-car-wheel">
            <circle cx="101" cy="134" r="19" fill="#1e1b4b" />
            <circle cx="101" cy="134" r="11.5" fill="#ede9fe" />
            <g stroke="#5b46f6" strokeWidth="2.2" strokeLinecap="round">
              <path d="M101 124v20m-10-10h20m-17-7 14 14m0-14-14 14" />
            </g>
            <circle cx="101" cy="134" r="4" fill="#5b46f6" />
          </g>
          <g className="auth-car-wheel">
            <circle cx="215" cy="134" r="19" fill="#1e1b4b" />
            <circle cx="215" cy="134" r="11.5" fill="#ede9fe" />
            <g stroke="#5b46f6" strokeWidth="2.2" strokeLinecap="round">
              <path d="M215 124v20m-10-10h20m-17-7 14 14m0-14-14 14" />
            </g>
            <circle cx="215" cy="134" r="4" fill="#5b46f6" />
          </g>
        </svg>
      </div>
    </div>
  );
}

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
  const [resetBusy, setResetBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [returnTo, setReturnTo] = useState('/');
  const [success, setSuccess] = useState(false);
  const [profileWarning, setProfileWarning] = useState('');
  const submittingRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const nextQuery = returnTo !== '/' ? `?next=${encodeURIComponent(returnTo)}` : '';
  const loginHref = `/login${nextQuery}`;
  const registerHref = `/register${nextQuery}`;

  useEffect(() => {
    const destination = safeReturnPath(new URLSearchParams(window.location.search).get('next'));
    setReturnTo(destination);
    if (!firebaseConfigured || !auth) {
      setAuthReady(true);
      setError('Firebase Authentication is not configured. Check your Firebase project settings.');
      return;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setAuthReady(true);
      // Let the active submission finish saving the profile and showing success.
      if (currentUser && !currentUser.isAnonymous && !submittingRef.current) router.replace(destination);
    });
  }, [router]);

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => router.replace(returnTo), 1200);
    return () => window.clearTimeout(timer);
  }, [success, router, returnTo]);

  useEffect(() => {
    if (!error && !info) return;
    const timer = window.setTimeout(() => {
      setError('');
      setInfo('');
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [error, info]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || !firebaseConfigured || submittingRef.current || success) return;
    if (isRegister && !name.trim()) {
      setError('Enter a display name.');
      return;
    }
    setError('');
    setInfo('');
    setProfileWarning('');
    submittingRef.current = true;
    setBusy(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
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
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    if (!auth || resetBusy || busy) return;
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('');
      setInfo('Enter your email address to reset your password.');
      emailInputRef.current?.focus();
      return;
    }
    setError('');
    setInfo('');
    setResetBusy(true);
    try {
      auth.languageCode = language;
      await sendPasswordResetEmail(auth, normalizedEmail);
      setInfo('Password reset email sent. Check your inbox.');
    } catch (resetError) {
      setError(authErrorMessage(resetError));
    } finally {
      setResetBusy(false);
    }
  }

  const translatedError = (message: string) => {
    if (message === 'Firebase Authentication is not configured. Check your Firebase project settings.') return t(message);
    return t(message);
  };

  return (
    <main className="auth-page">
      <TravelScenery />
      <FallingPetals petals={backPetals} depth="back" />
      <TravelCar />
      <FallingPetals petals={frontPetals} depth="front" />
      {(error || info) && (
        <div className={`auth-toast ${error ? 'auth-toast-error' : 'auth-toast-info'}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'}>
          <span className="auth-toast-icon">{error ? <CircleAlert size={18} /> : <Info size={18} />}</span>
          <span>{error ? translatedError(error) : t(info)}</span>
        </div>
      )}
      <section className="auth-card" aria-label={t(isRegister ? 'Create your Motteku account' : 'Welcome back')}>
        <header className="auth-brand">
          <svg className="auth-brand-mark" viewBox="0 0 110 64" aria-hidden="true">
            <path d="M52 22c8-10 20-8 16 1-3 6-9 0-4-6 7-7 19-7 28-2" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3.5 3.5" strokeLinecap="round" />
            <g transform="translate(94 13) rotate(-22)"><path d="m-7 0 14-3-5 4 3 4-5-3-4 3 1-4Z" fill="currentColor" /></g>
            <path d="m14 54 24-36 15 21 10-14 19 29Z" fill="url(#auth-logo-gradient)" />
            <path d="m38 18 7 11-4-2-3 4-4-4-4 2Z" fill="#fff" />
            <path d="m63 25 5 8-3-2-2 2-3-2-3 2Z" fill="#fff" opacity=".92" />
            <defs><linearGradient id="auth-logo-gradient" x1="12" y1="16" x2="78" y2="56"><stop stopColor="#5b46f6" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs>
          </svg>
          <h1>motteku</h1>
          <p>Plan · Pack · Travel</p>
        </header>
        <nav className="auth-mode-switch" aria-label={t('Authentication mode')}>
          <span className={`auth-mode-indicator ${isRegister ? 'signup-active' : ''}`} aria-hidden="true" />
          <Link href={loginHref} aria-current={!isRegister ? 'page' : undefined}>{t('Sign In')}</Link>
          <Link href={registerHref} aria-current={isRegister ? 'page' : undefined}>{t('Sign Up')}</Link>
        </nav>

        {success ? <div className="auth-success" role="status" aria-live="polite">
          <CheckCircle2 className="auth-success-icon" size={38} aria-hidden="true" />
          <h2 className="auth-success-title">{t(isRegister ? 'Account created successfully!' : 'Signed in successfully!')}</h2>
          <p className="auth-success-message">{t('You are signed in. Opening Motteku…')}</p>
          {profileWarning && <p className="auth-profile-warning">{t(profileWarning)}</p>}
          <button type="button" className="primary auth-submit" onClick={() => router.replace(returnTo)}>{t('Continue to Motteku')}</button>
        </div> : <form className="auth-form" onSubmit={handleSubmit} aria-busy={busy}>
          <div className={`auth-name-field ${isRegister ? 'open' : ''}`} aria-hidden={!isRegister}>
            <label>
              {t('Full name')}
              <span className="auth-input-wrap"><UserRound size={17} /><input autoComplete="name" tabIndex={isRegister ? 0 : -1} required={isRegister} maxLength={80} disabled={busy || !isRegister} value={name} onChange={event => setName(event.target.value)} placeholder="Ruby Tanaka" /></span>
            </label>
          </div>
          <label>
            {t('Email address')}
            <span className="auth-input-wrap"><Mail size={17} /><input ref={emailInputRef} autoComplete="email" type="email" required disabled={busy || resetBusy} value={email} onChange={event => { setEmail(event.target.value); setInfo(''); }} placeholder="you@motteku.jp" /></span>
          </label>
          <label>
            {t('Password')}
            <span className="auth-input-wrap"><LockKeyhole size={17} /><input autoComplete={isRegister ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} required minLength={6} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" />
              <button className="auth-password-toggle" type="button" onClick={() => setShowPassword(value => !value)} aria-label={t(showPassword ? 'Hide password' : 'Show password')} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </span>
          </label>
          {!isRegister && <div className="auth-signin-options">
            <label className="auth-remember"><input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} /><span>{t('Remember me')}</span></label>
            <button type="button" className="auth-forgot" disabled={busy || resetBusy} onClick={() => void handlePasswordReset()}>{t(resetBusy ? 'Please wait…' : 'Forgot password?')}</button>
          </div>}
          <button className="primary auth-submit" type="submit" disabled={busy || resetBusy || !authReady || !firebaseConfigured}>
            {busy && <LoaderCircle className="auth-submit-spinner" size={16} aria-hidden="true" />}
            {busy ? t(isRegister ? 'Creating Account…' : 'Signing In…') : t(isRegister ? 'Create Account' : 'Sign In')}
          </button>
        </form>}

        <p className="auth-footer">{t('Let’s make great memories together ✨')}</p>
      </section>
    </main>
  );
}

