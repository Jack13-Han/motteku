'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { sendPasswordResetEmail, updateProfile, type User } from 'firebase/auth';
import { ChevronDown, LoaderCircle, LogOut, Settings, X } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n';

type AccountMenuProps = { user: User; onLogout: () => Promise<void>; loggingOut: boolean };

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${Array.from(parts[0])[0]}${Array.from(parts[parts.length - 1])[0]}`.toUpperCase();
  return Array.from(parts[0] || 'M').slice(0, 2).join('').toUpperCase();
}

export default function AccountMenu({ user, onLogout, loggingOut }: AccountMenuProps) {
  const { language, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileName, setProfileName] = useState(user.displayName || '');
  const [draftName, setDraftName] = useState(user.displayName || '');
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const titleId = useId();
  const emailNoteId = useId();
  const identityName = profileName || user.email?.split('@')[0] || 'Motteku';
  const initials = getInitials(identityName);

  useEffect(() => {
    setProfileName(user.displayName || '');
    setDraftName(user.displayName || '');
  }, [user.uid, user.displayName]);

  useEffect(() => {
    if (!menuOpen) return;
    dropdown.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    nameInput.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSettingsOpen(false); return; }
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keyboard);
      trigger.current?.focus();
    };
  }, [settingsOpen]);

  function menuKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') { setMenuOpen(false); trigger.current?.focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(dropdown.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') || []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }

  function openSettings() {
    setMenuOpen(false); setDraftName(profileName); setError(''); setSuccess(''); setSettingsOpen(true);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || sendingReset) return;
    setError(''); setSuccess('');
    const name = draftName.trim();
    if (!name) { setError('Enter a display name.'); return; }
    if (Array.from(name).length > 80) { setError('Use 80 characters or fewer.'); return; }
    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== user.uid) { setError('Your session has changed. Please sign in again.'); return; }
    setSaving(true);
    try {
      await updateProfile(currentUser, { displayName: name });
      if (auth?.currentUser?.uid !== user.uid) return;
      setProfileName(name); setDraftName(name); setSuccess('Profile updated successfully.');
    } catch { setError('Could not update your profile. Please try again.'); }
    finally { setSaving(false); }
  }

  async function resetPassword() {
    if (saving || sendingReset) return;
    setError(''); setSuccess('');
    const currentAuth = auth, currentUser = currentAuth?.currentUser;
    if (!currentAuth || !currentUser || currentUser.uid !== user.uid || !currentUser.email) {
      setError('Your session has changed. Please sign in again.'); return;
    }
    setSendingReset(true);
    try {
      currentAuth.languageCode = language;
      await sendPasswordResetEmail(currentAuth, currentUser.email);
      if (currentAuth.currentUser?.uid !== user.uid) return;
      setSuccess('Password reset email sent. Check your inbox.');
    } catch { setError('Could not send a password reset email. Please try again.'); }
    finally { setSendingReset(false); }
  }

  return <div className="account-menu" ref={wrapper}>
    <button ref={trigger} type="button" className="account-trigger" aria-label={`${t('Account menu')}: ${identityName}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => setMenuOpen(value => !value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setMenuOpen(true); } }}>
      <span className="account-avatar" aria-hidden="true">{initials}</span><ChevronDown size={14} aria-hidden="true"/>
    </button>
    {menuOpen && <div ref={dropdown} id={menuId} role="menu" className="account-dropdown" aria-label={t('Account menu')} onKeyDown={menuKeyboard}>
      <div className="account-summary"><span className="account-avatar" aria-hidden="true">{initials}</span><div className="account-identity"><small>{t('Signed in as')}</small><strong>{identityName}</strong>{user.email && <small>{user.email}</small>}</div></div>
      <button type="button" role="menuitem" className="account-menu-item" onClick={openSettings}><Settings size={17}/>{t('Account settings')}</button>
      <button type="button" role="menuitem" className="account-menu-item danger" disabled={loggingOut} onClick={() => { setMenuOpen(false); void onLogout(); }}><LogOut size={17}/>{t(loggingOut ? 'Signing out…' : 'Log out')}</button>
    </div>}
    {settingsOpen && <div className="account-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className="account-settings-dialog">
        <div className="account-settings-heading"><h2 id={titleId}>{t('Account settings')}</h2><button type="button" className="icon-button" aria-label={t('Close account settings')} onClick={() => setSettingsOpen(false)}><X size={18}/></button></div>
        <form className="account-settings-form" onSubmit={saveProfile}>
          <label className="field-label">{t('Display name')}<input ref={nameInput} name="displayName" autoComplete="name" value={draftName} required maxLength={80} disabled={saving} onChange={event => setDraftName(event.target.value)}/></label>
          <label className="field-label">{t('Email address')}<input type="email" value={user.email || ''} readOnly aria-describedby={emailNoteId}/></label>
          <p className="account-email-note" id={emailNoteId}>{t('Your email address is used to sign in.')}</p>
          {error && <p className="account-message error" role="alert">{t(error)}</p>}
          {success && <p className="account-message success" role="status">{t(success)}</p>}
          <div className="account-settings-actions"><button type="submit" className="primary" disabled={saving || sendingReset || !draftName.trim() || draftName.trim() === profileName}>{saving && <LoaderCircle size={16} className="spin"/>}{t(saving ? 'Saving…' : 'Save changes')}</button><button type="button" className="soft-button" onClick={() => setSettingsOpen(false)}>{t('Cancel')}</button></div>
        </form>
        <div className="account-password-section"><h3>{t('Password reset')}</h3><button type="button" className="soft-button" disabled={saving || sendingReset || !user.email} onClick={() => void resetPassword()}>{sendingReset && <LoaderCircle size={16} className="spin"/>}{t(sendingReset ? 'Sending…' : 'Send password reset email')}</button></div>
      </div>
    </div>}
  </div>;
}
