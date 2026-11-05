import { useTranslation } from "react-i18next";
import { SNAPSHOT_INVALID_PAYLOAD, SNAPSHOT_MALFORMED } from "../../hooks/useSnapshot";

type ConnectionBannerProps = {
  connected: boolean;
  lastValidSnapshotAt: number | null;
  snapshotError: string | null;
  now: number;
  stale: boolean;
};

function formatAge(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function ConnectionBanner({
  connected,
  lastValidSnapshotAt,
  snapshotError,
  now,
  stale,
}: ConnectionBannerProps) {
  const { t } = useTranslation("common");
  if (connected && !snapshotError && !stale) return null;

  let message = t("connection.connecting");
  // The hook's own two messages are translated; anything else is shown as received.
  if (snapshotError === SNAPSHOT_INVALID_PAYLOAD) message = t("connection.invalidPayload");
  else if (snapshotError === SNAPSHOT_MALFORMED) message = t("connection.malformed");
  else if (snapshotError) message = snapshotError;
  else if (lastValidSnapshotAt != null) {
    const age = formatAge(now - lastValidSnapshotAt);
    message = connected
      ? t("connection.staleSince", { age })
      : t("connection.disconnectedSince", { age });
  } else if (!connected) {
    message = t("connection.disconnectedWaiting");
  }

  const announced = snapshotError
    ? t("connection.announceError")
    : connected
      ? t("connection.announceStale")
      : t("connection.announceDisconnected");

  return (
    <div className="connection-banner">
      <span className="connection-banner-dot" aria-hidden="true" />
      <span className="sr-only" role="status" aria-live="polite">
        {announced}
      </span>
      <span aria-hidden="true">{message}</span>
    </div>
  );
}
