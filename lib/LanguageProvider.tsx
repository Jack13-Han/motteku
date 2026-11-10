'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { formatDate, resolveLanguage, translate, type Language, type Params } from './messages';
export type { Language } from './messages';
type Translator = (key: string, params?: Params) => string;
const LanguageContext = createContext<{
  language: Language; setLanguage: (language: Language) => void; t: Translator;
  date: (value: string | Date, time?: boolean) => string;
} | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ja');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem('motteku-language'); } catch { /* Storage may be disabled. */ }
    setLanguageState(resolveLanguage(saved, navigator.languages?.length ? navigator.languages : [navigator.language]));
    setLoaded(true);
    const sync = (event: StorageEvent) => {
      if (event.key === 'motteku-language') setLanguageState(resolveLanguage(event.newValue, navigator.languages));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const t = useCallback<Translator>((key, params) => translate(language, key, params), [language]);
  const date = useCallback((value: string | Date, time = false) => formatDate(language, value, time), [language]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `Motteku | ${t('Trip overview')}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('Pack together, go further'));
  }, [language, t]);
  useEffect(() => {
    const controls = () => document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
    controls().forEach(control => control.setCustomValidity(''));
    const invalid = (event: Event) => {
      const control = event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        control.setCustomValidity('');
        if (!control.validity.valid) control.setCustomValidity(t(control.validity.valueMissing ? 'Complete this required field.' : control.validity.typeMismatch && control instanceof HTMLInputElement && control.type === 'email' ? 'Enter a valid email address.' : 'Check this value.'));
      }
    };
    const clear = (event: Event) => {
      const control = event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) control.setCustomValidity('');
    };
    document.addEventListener('invalid', invalid, true);
    document.addEventListener('input', clear, true);
    document.addEventListener('change', clear, true);
    return () => {
      document.removeEventListener('invalid', invalid, true);
      document.removeEventListener('input', clear, true);
      document.removeEventListener('change', clear, true);
    };
  }, [t]);
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    try { localStorage.setItem('motteku-language', next); } catch { /* Keep the selection in memory. */ }
  };
  // Resolve preferences before mounting effects that show prompts or request localized content.
  return <LanguageContext.Provider value={{ language, setLanguage, t, date }}>{loaded ? children : null}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
