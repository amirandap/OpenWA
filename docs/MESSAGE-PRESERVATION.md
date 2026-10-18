# Message preservation in this fork

Based on OpenWA 0.23.7, commit `3a47b43038ad7a2e388fa161d1ff2622df43065e`, matching the installation inspected on 2026-10-18. The fork's default branch may follow a newer upstream release; deploy the preservation branch explicitly rather than `main`.

## Responsibilities

OpenWA receives the message and downloads its media. It is the primary preservation point. COS keeps an independent copy of received text through its existing webhook. The public MCP provides authenticated access; it must not be the only archive because it only runs when someone queries it.

## Changed behavior

- Incoming sender deletions and deletions through the REST API keep `messages.body`, the caption, `metadata.media`, `mediaPath`, and `mediaMimetype` intact.
- The row is still marked `type: revoked`. `metadata.revocation.originalType` records its prior type and `observedAt` records when the gateway processed the deletion, not the original send time or a proven deletion time on the sender's device.
- Repeated deletion events keep the first marker. Reactions, REST edits and deletions use the same per-message queue. A late edit cannot replace an already revoked row's text.
- A deletion arriving during inbound processing is reapplied after insertion, preserving the received content.
- The existing authenticated media endpoint continues serving stored bytes for revoked messages. List responses expose the retained text and marker to authorized readers. The dashboard can continue displaying its existing deleted-message placeholder.
- Existing rows need no schema migration. Already erased text cannot be reconstructed by this change. It must be recovered separately from COS or another pre-deletion copy.

## Media configuration

Apply `docker-compose.preservation.yml` AFTER existing site overrides. It enables incoming and outgoing chat-media archival, media downloads and disappearing-message storage. Archive TTL is zero (no scheduled expiry). It sets both download and file archive caps to 50 MiB so the archive does not silently stop at the upstream 25 MiB default. Photos, voice notes, audio, videos, stickers and documents share this policy.

The policy does not promise impossible recovery: an attachment deleted before this gateway receives/downloads it, an offline gateway, exhausted storage, a failed download, historical sync without bytes, URL-only outbound sends, or a file larger than 50 MiB can still leave a message without an archive. An omitted marker is evidence of missing bytes, not a backup. Raising the limit requires memory/storage sizing because this engine materializes decrypted media in memory. Review archive/download errors and free space; back up SQLite and the media store off the gateway. The current archive writer logs storage failures and retains its inline fallback; it is not a durable retry queue.

Explicit administrative session/data deletion and deliberate storage cleanup are outside sender-deletion preservation. Do not delete a session to restart it. Never run `docker compose down -v` during cutover.

## Deployment procedure (not executed by this change)

1. Record the current image digest, source revision, Compose configuration, session IDs and connection state. Preserve the site's existing overrides and secrets outside Git.
2. Create consistent SQLite backups using SQLite's backup API (including `main.sqlite` and `openwa.sqlite`) and a protected copy of the media/session data volume. Confirm the copies can be opened; do not copy live SQLite database files alone while writes are active.
3. Check out the preservation commit in a separate source directory. Build the fork's image. Merge the preservation overlay last and inspect only the resolved image and preservation settings; never publish full resolved environment output. `Dockerfile.preservation` also permits layering a freshly built `dist/` onto the exact deployed runtime digest without reinstalling/changing dependencies; use it only while the fork's package lock matches 0.23.7. This produces a locally tagged image, not a published registry image.

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.preservation.yml build openwa-api
   ```

   Runtime-preserving alternative after `npm ci` and `npm run build`:

   ```sh
   docker build -f Dockerfile.preservation -t openwa-preservation:local .
   ```

4. Run focused tests and the build before replacing the container. Recreate only `openwa-api`, mounting the original named volume. Keep the rollback image locally and avoid pulling upstream over the custom image.
5. Check API health, unchanged session IDs, ready state and both text and media read endpoints. Deploy COS's revoked-media retrieval fix as well so MCP file/audio/image tools can retrieve the archive.
6. With an explicitly authorized test chat, receive each supported attachment type and a caption, delete the messages from the sending device, restart the service, and verify original byte hashes and text through the authenticated API/MCP. Local tests are not production receipt/deletion proof.
7. Roll back the image and overrides if health/session checks fail. This change is additive JSON metadata with no schema migration, so the old image can read the same volume. Keep the backups; rolling back also restores the old destructive handling of future deletion events.

## Local validation

Real SQLite tests verify preservation across all supported message types and session scoping. Real filesystem archive tests verify exact bytes remain readable after deletion and a future retention sweep with TTL zero. Queue tests cover reaction/deletion overlap, late edits and deletion during initial message processing. No real WhatsApp messages are sent by these tests.
