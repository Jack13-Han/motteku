export type ChatSendStage = 'reply-read' | 'message-write';

export function chatSendError(error: unknown, stage: ChatSendStage, hasReply: boolean) {
  const rawCode = (error as { code?: unknown } | null)?.code;
  const knownCodes = ['permission-denied', 'unauthenticated', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'invalid-argument', 'not-found', 'failed-precondition', 'aborted', 'cancelled'];
  const normalized = typeof rawCode === 'string' ? rawCode.replace(/^firestore\//, '') : '';
  const code = knownCodes.includes(normalized) ? normalized : '';
  let message = 'Message was not sent. Check your connection and try again.';
  if (code === 'permission-denied') {
    message = stage === 'reply-read'
      ? 'The original message could not be read. Check your group membership and Firestore rules.'
      : hasReply
        ? 'Reply was blocked. Publish the latest Firestore rules, then try again.'
        : 'Message was blocked. Check your group membership and Firestore rules.';
  } else if (code === 'unauthenticated') message = 'Sign in again before sending this message.';
  else if (['unavailable', 'deadline-exceeded', 'aborted', 'cancelled'].includes(code)) message = 'Message was not sent. Check your connection and try again.';
  else if (code === 'resource-exhausted') message = 'The chat service has reached its usage limit. Try again later.';
  else if (stage === 'reply-read' && code === 'not-found') message = 'The original message is not available. Choose another message to reply to.';
  else if (code === 'invalid-argument') message = 'This message could not be saved. Check its length and try again.';
  else if (code === 'failed-precondition') message = 'The chat service is not ready. Try again later.';
  return { message, code };
}
