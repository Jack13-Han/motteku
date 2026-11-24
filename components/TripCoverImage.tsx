'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from '@/lib/firebase';
import { useLanguage } from '@/lib/i18n';
import { coverImageSizeLimit, coverImageTypes, defaultTripCover, findDestinationCover, tripCoverCandidates, type TripCover } from '@/lib/tripCover';

type Props = {
  trip: Partial<TripCover> & { id: string; location: string; type: string };
  accountId?: string;
  onChange?: (cover: TripCover) => void;
};

export default function TripCoverImage({ trip, accountId, onChange }: Props) {
  const { t } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [image, setImage] = useState<{ candidates: TripCover[]; cover?: TripCover; failed: boolean }>();
  const { location, type, coverImageSource, coverImageUrl, coverImageAttribution } = trip;
  const candidates = useMemo(() => tripCoverCandidates({ location, type, coverImageSource, coverImageUrl, coverImageAttribution }), [
    location, type, coverImageSource, coverImageUrl, coverImageAttribution,
  ]);

  useEffect(() => {
    let index = 0;
    const pendingImage = new Image();
    function load() {
      const cover = candidates[index];
      if (cover) pendingImage.src = cover.coverImageUrl;
      else setImage({ candidates, failed: true });
    }
    pendingImage.onload = () => setImage({ candidates, cover: candidates[index], failed: index > 0 });
    pendingImage.onerror = () => { index++; load(); };
    load();
    return () => { pendingImage.onload = null; pendingImage.onerror = null; };
  }, [candidates]);

  const activeImage = image?.candidates === candidates ? image : undefined;
  const cover = activeImage?.cover;
  const labelId = `trip-cover-title-${trip.id}`;

  function select(cover: TripCover) {
    onChange?.(cover);
    setFeedback('Cover image updated');
    dialog.current?.close();
  }

  async function upload(file?: File) {
    if (!file || !storage || !accountId || !onChange || uploading.current) return;
    if (!coverImageTypes.includes(file.type) || !file.size || file.size > coverImageSizeLimit) {
      setFeedback('Choose a JPEG, PNG, or WebP image up to 5 MB.');
      return;
    }
    uploading.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const decoded = await createImageBitmap(file);
      decoded.close();
      if (auth?.currentUser?.uid !== accountId) throw new Error('Account changed');
      const object = ref(storage, `users/${accountId}/tripCovers/${trip.id}/${crypto.randomUUID()}`);
      await uploadBytes(object, file, { contentType: file.type });
      const coverImageUrl = await getDownloadURL(object);
      if (auth?.currentUser?.uid !== accountId) throw new Error('Account changed');
      select({ coverImageUrl, coverImageSource: 'uploaded' });
    } catch {
      setFeedback('Could not upload the cover image.');
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  return <>
    <div className="travel-hero-cover" aria-hidden="true" style={cover ? { backgroundImage: `url(${JSON.stringify(cover.coverImageUrl)})` } : undefined} />
    {cover?.coverImageAttribution && <small className="travel-cover-credit">{cover.coverImageAttribution}</small>}
    {onChange && <>
      <button type="button" className="travel-hero-delete travel-cover-edit" title={t('Change cover')} aria-label={t('Change cover')}
        onClick={() => { setFeedback(''); dialog.current?.showModal(); }}><ImagePlus size={17} /></button>
      <dialog ref={dialog} className="travel-cover-dialog" aria-labelledby={labelId} onCancel={event => { if (busy) event.preventDefault(); }}>
        <h3 id={labelId}>{t('Change cover')}</h3>
        <div className="travel-cover-options">
          <button type="button" className="soft-button" disabled={busy} onClick={() => {
            const destination = findDestinationCover(trip.location);
            if (destination) select(destination);
            else setFeedback('No cover photo is available for this location.');
          }}>{t('Find a photo for this location')}</button>
          <button type="button" className="soft-button" disabled={busy || !accountId || !storage} onClick={() => fileInput.current?.click()}>{t('Upload my photo')}</button>
          <input ref={fileInput} type="file" hidden accept={coverImageTypes.join(',')} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void upload(file);
          }} />
          <button type="button" className="soft-button" disabled={busy} onClick={() => select(defaultTripCover)}>{t('Use default image')}</button>
        </div>
        {(!accountId || !storage) && <p>{t('Sign in to upload a cover image. Firebase Storage must be available.')}</p>}
        <p role="status">{busy ? t('Uploading cover image…') : feedback && t(feedback)}</p>
        <button className="primary" type="button" disabled={busy} onClick={() => dialog.current?.close()}>{t('Close')}</button>
      </dialog>
    </>}
    <span className="travel-cover-status" role="status">
      {activeImage?.failed ? t('Could not load the image') : feedback === 'Cover image updated' ? t(feedback) : ''}
    </span>
  </>;
}
