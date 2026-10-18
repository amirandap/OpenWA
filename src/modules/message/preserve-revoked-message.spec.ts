import { DataSource, Repository } from 'typeorm';
import { Message, MessageDirection } from './entities/message.entity';
import { preserveRevokedMessage } from './preserve-revoked-message';

describe('sender deletion preservation (real SQLite)', () => {
  let db: DataSource;
  let repository: Repository<Message>;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Message],
      synchronize: true,
    }).initialize();
    repository = db.getRepository(Message);
  });
  afterEach(async () => {
    await db.destroy();
  });

  it.each(['text', 'image', 'audio', 'voice', 'video', 'sticker', 'document'])(
    'retains the %s body, inline bytes, archive pointer and receipt state',
    async type => {
      const metadata = {
        media: { data: 'YWJj', mimetype: 'application/octet-stream' },
        quotedMessage: { body: 'quote' },
      };
      await repository.save(
        repository.create({
          sessionId: 's1',
          waMessageId: 'm1',
          chatId: 'peer@c.us',
          from: 'peer@c.us',
          to: 'me@c.us',
          body: 'original text or caption',
          type,
          direction: MessageDirection.INCOMING,
          metadata,
          mediaPath: 'chat-media/s1/original.bin',
          mediaMimetype: 'application/octet-stream',
        }),
      );
      await preserveRevokedMessage(repository, 's1', 'm1');
      const row = await repository.findOneByOrFail({ sessionId: 's1', waMessageId: 'm1' });
      expect(row).toMatchObject({
        type: 'revoked',
        body: 'original text or caption',
        mediaPath: 'chat-media/s1/original.bin',
        metadata: { ...metadata, revocation: { originalType: type, observedAt: expect.any(String) as unknown } },
      });
      await preserveRevokedMessage(repository, 's1', 'm1');
      expect(await repository.findOneByOrFail({ id: row.id })).toEqual(row);
    },
  );

  it('cannot affect another session or any row when the target id is empty', async () => {
    const row = await repository.save(
      repository.create({
        sessionId: 'other',
        waMessageId: 'm1',
        chatId: 'peer@c.us',
        from: 'peer@c.us',
        to: 'me@c.us',
        body: 'private original',
        type: 'text',
      }),
    );
    await preserveRevokedMessage(repository, 's1', 'm1');
    await preserveRevokedMessage(repository, 'other', '');
    expect(await repository.findOneByOrFail({ id: row.id })).toEqual(row);
  });
});
