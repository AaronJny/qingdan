
import {t as tr, translateError} from '../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { desktopBridge, type DesktopConnection } from '../lib/desktop-connection';

export default function DesktopConnectionPanel({ mode, compact = false }: { mode?: 'local' | 'accounts'; compact?: boolean }) {
  const bridge = desktopBridge();
  const [connection, setConnection] = useState<DesktopConnection | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let live = true, reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (!bridge || !live || reading) return;
      reading = true; clearTimeout(timer);
      try {
        const value = await bridge.getConnection();
        if (live) {
          setConnection(value);
          if (value.status === 'connecting') timer = setTimeout(() => void read(), 800);
        }
      } catch { if (live) setError(tr("ui.secondary.desktopConnection.unableToReadDesktopConnectionStatusYou")); }
      finally { reading = false; }
    };
    void read();
    window.addEventListener('focus', read);
    return () => { live = false; alive.current = false; clearTimeout(timer); window.removeEventListener('focus', read); };
  }, [bridge]);
  const openSettings = async () => {
    if (!bridge || opening.current) return;
    opening.current = true; setBusy(true); setError(''); setMessage(tr("ui.secondary.desktopConnection.openingConnectionSettings"));
    try {
      const result = await bridge.openConnectionSettings();
      if (!result.ok) throw new Error('Connection settings did not open');
      if (alive.current) setMessage(tr("ui.secondary.desktopConnection.connectionSettingsOpenedChooseLocalModeOr"));
    } catch { if (alive.current) { setMessage(''); setError(tr("ui.secondary.desktopConnection.couldNotOpenConnectionSettingsUseFile")); } }
    finally { opening.current = false; if (alive.current) setBusy(false); }
  };
  if (compact && !bridge) return null;
  const local = connection ? connection.mode === 'builtin' : mode === 'local';
  return <section className="desktop-connection-panel" aria-label={tr("ui.secondary.desktopConnection.serverConnection")}>
    <h3>{bridge ? tr("ui.secondary.desktopConnection.modeAndServer") : tr("ui.secondary.desktopConnection.currentService")}</h3>
    <p className="connection-summary"><strong>{bridge ? connection ? local ? tr("ui.secondary.desktopConnection.localModeNoSignInNeeded") : tr("ui.secondary.desktopConnection.privateServerMode") : tr("ui.secondary.desktopConnection.readingConnection") : mode === 'local' ? tr("ui.secondary.desktopConnection.localSingleUserMode") : tr("ui.secondary.desktopConnection.serverAccountMode")}</strong>
      <span>{connection ? connection.status === 'connected' ? tr("ui.secondary.desktopConnection.serviceConnected") : connection.status === 'connecting' ? tr("ui.secondary.desktopConnection.connectingToService") : tr("ui.secondary.desktopConnection.serviceDisconnected") : bridge ? '' : tr("ui.secondary.desktopConnection.webApp")}</span></p>
    <p className="connection-address">{connection?.serverUrl || (typeof location !== 'undefined' ? location.origin : '')}</p>
    {bridge && <button type="button" className="primary" disabled={busy} onClick={() => void openSettings()}>{busy ? tr("ui.secondary.desktopConnection.opening") : tr("ui.secondary.desktopConnection.serverConnection")}</button>}
    <p className="connection-help">{bridge ? tr("ui.secondary.desktopConnection.switchToLocalModeOrConnectYour") : tr("ui.secondary.desktopConnection.dataIsStoredOnTheCurrentServer")}</p>
    {message && <p role="status" aria-live="polite">{translateError(message)}</p>}
    {error && <p className="inline-error" role="alert">{translateError(error)}</p>}
  </section>;
}
