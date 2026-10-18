import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';

/** Mark a sender's deletion without erasing the locally received text or attachment.
 * Callers serialize this with edits/reactions on the session's per-message queue.
 * The existing media endpoint remains usable; metadata records the pre-delete type.
 */
export async function preserveRevokedMessage(
  repository: Repository<Message>,
  sessionId: string,
  waMessageId: string,
): Promise<void> {
  if (!sessionId || !waMessageId) return;
  const where = { sessionId, waMessageId };
  const row = await repository.findOne({ where });
  if (row?.type === 'revoked') return; // Duplicate events must not replace the first marker.
  const metadata = row
    ? { ...row.metadata, revocation: { originalType: row.type, observedAt: new Date().toISOString() } }
    : undefined;
  await repository.update(where, {
    type: 'revoked',
    ...(metadata ? { metadata } : {}),
  });
}
