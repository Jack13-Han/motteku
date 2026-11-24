export type PollDraftError =
  | 'Enter a poll question using 1–200 characters.'
  | 'Add 2–5 different options using 1–100 characters each.'
  | 'Enter your name using 1–80 characters.';

export type GroupPoll = {
  id: string;
  question: string;
  options: string[];
  createdBy: string;
  createdByName: string;
  closed: boolean;
  votes?: unknown;
  pending: boolean;
};

// Firestore Rules string.size() uses UTF-16 units, as do input maxLength and JS length.
const length = (text: string) => text.length;
const validText = (text: unknown, maximum: number): text is string =>
  typeof text === 'string' && text === text.trim() && length(text) > 0 && length(text) <= maximum;

export function validatePollDraft(question: string, options: string[], userName: string) {
  const cleanQuestion = question.trim();
  const cleanOptions = options.map(option => option.trim());
  const createdByName = userName.trim();
  if (!validText(cleanQuestion, 200)) {
    return { ok: false as const, error: 'Enter a poll question using 1–200 characters.' as PollDraftError };
  }
  if (cleanOptions.length < 2 || cleanOptions.length > 5
    || cleanOptions.some(option => !validText(option, 100))
    || new Set(cleanOptions).size !== cleanOptions.length) {
    return { ok: false as const, error: 'Add 2–5 different options using 1–100 characters each.' as PollDraftError };
  }
  if (!validText(createdByName, 80)) {
    return { ok: false as const, error: 'Enter your name using 1–80 characters.' as PollDraftError };
  }
  return { ok: true as const, question: cleanQuestion, options: cleanOptions, createdByName };
}

// Ignore malformed documents rather than exposing unusable voting controls.
export function readPoll(id: string, value: unknown, pending = false): GroupPoll | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (!validText(data.question, 200) || !Array.isArray(data.options)
    || data.options.length < 2 || data.options.length > 5
    || data.options.some(option => !validText(option, 100))
    || new Set(data.options).size !== data.options.length
    || typeof data.createdBy !== 'string' || !data.createdBy || data.createdBy.length > 128
    || !validText(data.createdByName, 80) || typeof data.closed !== 'boolean') return null;
  return {
    id, question: data.question, options: data.options as string[],
    createdBy: data.createdBy, createdByName: data.createdByName,
    closed: data.closed, votes: data.votes, pending,
  };
}

export function pollResults(options: readonly string[], votes: unknown, uid: string) {
  const values = votes && typeof votes === 'object' && !Array.isArray(votes) ? votes as Record<string, unknown> : {};
  const validIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < options.length;
  const counts = options.map(() => 0);
  for (const value of Object.values(values)) if (validIndex(value)) counts[value]++;
  const total = counts.reduce((sum, count) => sum + count, 0);
  const ownVote = Object.hasOwn(values, uid) ? values[uid] : undefined;
  const selectedIndex = validIndex(ownVote) ? ownVote : null;
  return {
    total, selectedIndex,
    options: options.map((text, index) => ({
      text, count: counts[index], percent: total ? Math.round(counts[index] * 100 / total) : 0,
      selected: selectedIndex === index,
    })),
  };
}

// Firebase may attach server messages and request details. Display only known SDK codes.
export function pollErrorCode(error: unknown): string | undefined {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code !== 'string') return undefined;
  const normalized = code.replace(/^firestore\//, '');
  return ['permission-denied', 'unauthenticated', 'unavailable', 'aborted', 'deadline-exceeded', 'resource-exhausted', 'failed-precondition', 'not-found'].includes(normalized) ? normalized : undefined;
}
