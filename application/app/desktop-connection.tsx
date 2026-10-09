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
      } catch { if (live) setError('无法读取桌面连接状态。仍可打开服务器连接设置。'); }
      finally { reading = false; }
    };
    void read();
    window.addEventListener('focus', read);
    return () => { live = false; alive.current = false; clearTimeout(timer); window.removeEventListener('focus', read); };
  }, [bridge]);
  const openSettings = async () => {
    if (!bridge || opening.current) return;
    opening.current = true; setBusy(true); setError(''); setMessage('正在打开连接设置…');
    try {
      const result = await bridge.openConnectionSettings();
      if (!result.ok) throw new Error('Connection settings did not open');
      if (alive.current) setMessage('已打开连接设置。选择本机模式或填写私服地址后，再确认连接。');
    } catch { if (alive.current) { setMessage(''); setError('连接设置未能打开，请使用应用菜单“文件 → 服务器连接”。'); } }
    finally { opening.current = false; if (alive.current) setBusy(false); }
  };
  if (compact && !bridge) return null;
  const local = connection ? connection.mode === 'builtin' : mode === 'local';
  return <section className="desktop-connection-panel" aria-label="服务器连接">
    <h3>{bridge ? '使用方式与服务器' : '当前服务'}</h3>
    <p className="connection-summary"><strong>{bridge ? connection ? local ? '本机模式 · 免登录' : '私服模式' : '正在读取连接…' : mode === 'local' ? '本地单人模式' : '服务器账号模式'}</strong>
      <span>{connection ? connection.status === 'connected' ? '服务已连接' : connection.status === 'connecting' ? '正在连接服务' : '服务未连接' : bridge ? '' : '网页版'}</span></p>
    <p className="connection-address">{connection?.serverUrl || (typeof location !== 'undefined' ? location.origin : '')}</p>
    {bridge && <button type="button" className="primary" disabled={busy} onClick={() => void openSettings()}>{busy ? '正在打开…' : '服务器连接'}</button>}
    <p className="connection-help">{bridge ? '可切换本机模式或连接自己的青单私服。切换保留本机数据，不会自动上传或合并。私服使用该服务器的账号登录。' : '数据保存在当前服务。要连接其他青单服务器，请在浏览器打开它的地址；各服务的账号和数据独立。'}</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
