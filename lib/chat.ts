export const CHAT_REACTIONS = [
  { id: 'like', emoji: '👍', label: 'Like' },
  { id: 'angry', emoji: '😡', label: 'Angry' },
  { id: 'ok', emoji: '👌', label: 'OK' },
  { id: 'haha', emoji: '😂', label: 'Haha' },
  { id: 'sad', emoji: '😢', label: 'Sad' },
] as const;

export type ChatReaction = typeof CHAT_REACTIONS[number]['id'];
export type ChatReply = { messageId: string; senderUid: string; senderName: string; text: string };
export type ChatMessage = {
  id: string; senderUid: string; senderName: string; text: string;
  createdAt?: { toDate: () => Date } | null; pending?: boolean;
  replyTo?: ChatReply; reactions?: Record<string, ChatReaction>;
  imagePath?: string; // Old attachments remain as placeholders; no Storage request is made.
};

export function buildReply(message: ChatMessage): ChatReply | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(message.id) || message.pending
    || typeof message.senderUid !== 'string' || !message.senderUid || message.senderUid.length > 128
    || typeof message.senderName !== 'string' || !message.senderName || Array.from(message.senderName).length > 80
    || typeof message.text !== 'string' || message.text.length > 2000
    || (!message.text && !message.imagePath)) return null;
  return { messageId: message.id, senderUid: message.senderUid, senderName: message.senderName, text: message.text };
}

export function reactionSummary(reactions: unknown, uid?: string) {
  const values = reactions && typeof reactions === 'object' && !Array.isArray(reactions) ? reactions as Record<string, unknown> : {};
  return CHAT_REACTIONS.map(reaction => ({
    ...reaction,
    count: Object.values(values).filter(value => value === reaction.id).length,
    selected: Boolean(uid && Object.hasOwn(values, uid) && values[uid] === reaction.id),
  }));
}
