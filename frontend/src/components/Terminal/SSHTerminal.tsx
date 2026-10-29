import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  Copy, Power, RefreshCw, FolderOpen, Eraser, Settings2,
  ZoomIn, ZoomOut, ClipboardPaste, CheckSquare, Download
} from 'lucide-react';
import { useAppStore, Tab } from '@/store/appStore';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  TerminalSettingsModal,
  TerminalSettings,
  DEFAULT_TERMINAL_SETTINGS,
  TERMINAL_THEMES,
} from './TerminalSettingsModal';

const SETTINGS_STORAGE_KEY = 'terminalsql_terminal_settings';

function getStoredSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_TERMINAL_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error('Failed to parse terminal settings:', e);
  }
  return DEFAULT_TERMINAL_SETTINGS;
}

function getEffectiveTheme(preset: string, appTheme: 'dark' | 'light') {
  if (preset === 'auto') {
    return appTheme === 'light' ? TERMINAL_THEMES.oneLight : TERMINAL_THEMES.putty;
  }
  if (preset === 'putty' && appTheme === 'light') {
    return TERMINAL_THEMES.oneLight;
  }
  return TERMINAL_THEMES[preset] || (appTheme === 'light' ? TERMINAL_THEMES.oneLight : TERMINAL_THEMES.putty);
}

function fallbackCopyText(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface TerminalSession {
  term: XTerm;
  fit: FitAddon;
  ws?: WebSocket | null;
  es?: EventSource | null;
  httpToken?: string | null;
  transport: 'ws' | 'http';
  container: HTMLDivElement;
  isConnected: boolean;
  termSize: { cols: number; rows: number };
}

const sessionRegistry = new Map<string, TerminalSession>();

function sendTerminalInput(session: TerminalSession, data: string) {
  if (session.transport === 'ws' && session.ws?.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type: 'input', data }));
  } else if (session.httpToken) {
    fetch(`/api/ssh/http/input/${encodeURIComponent(session.httpToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'input', data }),
    }).catch(() => {});
  }
}

function sendTerminalResize(session: TerminalSession, cols: number, rows: number) {
  if (session.transport === 'ws' && session.ws?.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  } else if (session.httpToken) {
    fetch(`/api/ssh/http/input/${encodeURIComponent(session.httpToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'resize', cols, rows }),
    }).catch(() => {});
  }
}

export function disposeTerminalSession(tabId: string) {
  const session = sessionRegistry.get(tabId);
  if (session) {
    try {
      if (session.ws) session.ws.close();
      if (session.es) session.es.close();
      if (session.httpToken) {
        fetch(`/api/ssh/http/input/${encodeURIComponent(session.httpToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'disconnect' }),
        }).catch(() => {});
      }
      session.term.dispose();
      if (session.container.parentNode) {
        session.container.parentNode.removeChild(session.container);
      }
    } catch { }
    sessionRegistry.delete(tabId);
  }
  useAppStore.getState().setTabStatus(tabId, 'disconnected');
}

interface Props { tab: Tab; }

export function SSHTerminal({ tab }: Props) {
  const openTab = useAppStore((s) => s.openTab);
  const appTheme = useAppStore((s) => s.theme);
  const setTabStatus = useAppStore((s) => s.setTabStatus);
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [termSize, setTermSize] = useState({ cols: 80, rows: 24 });
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [, setTransport] = useState<'ws' | 'http'>('ws');
  const [settings, setSettings] = useState<TerminalSettings>(getStoredSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const settingsRef = useRef<TerminalSettings>(settings);
  settingsRef.current = settings;

  const activeTheme = getEffectiveTheme(settings.themePreset, appTheme);

  // Synchronize terminal theme on appTheme or settings change without reconnecting
  useEffect(() => {
    if (xtermRef.current) {
      const theme = getEffectiveTheme(settings.themePreset, appTheme);
      xtermRef.current.options.theme = theme;
    }
  }, [appTheme, settings.themePreset]);

  const applySettings = useCallback((newSettings: TerminalSettings) => {
    setSettings(newSettings);
    settingsRef.current = newSettings;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
    } catch { }

    if (xtermRef.current) {
      const term = xtermRef.current;
      term.options.fontFamily = newSettings.fontFamily;
      term.options.fontSize = newSettings.fontSize;
      term.options.lineHeight = newSettings.lineHeight;
      term.options.fontWeight = newSettings.fontWeight;
      term.options.cursorStyle = newSettings.cursorStyle;
      term.options.cursorBlink = newSettings.cursorBlink;
      term.options.theme = getEffectiveTheme(newSettings.themePreset, appTheme);

      setTimeout(() => {
        if (fitRef.current) {
          fitRef.current.fit();
          setTermSize({ cols: term.cols, rows: term.rows });
          const sess = sessionRegistry.get(tab.id);
          if (sess) {
            sendTerminalResize(sess, term.cols, term.rows);
          }
        }
      }, 50);
    }
  }, [appTheme, tab.id]);

  const handleZoom = (delta: number) => {
    const nextSize = Math.max(10, Math.min(28, settings.fontSize + delta));
    if (nextSize !== settings.fontSize) {
      applySettings({ ...settings, fontSize: nextSize });
      toast.success(`Font size: ${nextSize}px`, { id: 'term-zoom', duration: 1200 });
    }
  };

  const handlePaste = useCallback(async () => {
    setContextMenu(null);
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          const sess = sessionRegistry.get(tab.id);
          if (sess) sendTerminalInput(sess, text);
        }
      } else {
        toast('Press Ctrl+Shift+V to paste on HTTP connections', { icon: '📋' });
      }
      xtermRef.current?.focus();
    } catch {
      toast('Press Ctrl+Shift+V to paste on HTTP connections', { icon: '📋' });
      xtermRef.current?.focus();
    }
  }, [tab.id]);

  const handleCopySelection = useCallback(() => {
    setContextMenu(null);
    const sel = xtermRef.current?.getSelection();
    if (sel && sel.length > 0) {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(sel).then(() => {
          toast.success('Copied to clipboard');
        }).catch(() => {
          if (fallbackCopyText(sel)) {
            toast.success('Copied to clipboard');
          } else {
            toast.error('Failed to copy to clipboard');
          }
        });
      } else {
        if (fallbackCopyText(sel)) {
          toast.success('Copied to clipboard');
        } else {
          toast.error('Failed to copy to clipboard');
        }
      }
    }
    // Deselect and re-focus terminal cleanly so text highlight doesn't stay stuck
    xtermRef.current?.clearSelection();
    xtermRef.current?.focus();
  }, []);

  const handleSelectAll = useCallback(() => {
    setContextMenu(null);
    xtermRef.current?.selectAll();
    xtermRef.current?.focus();
  }, []);

  const handleClear = useCallback(() => {
    setContextMenu(null);
    xtermRef.current?.clear();
    xtermRef.current?.focus();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (settingsRef.current.rightClickAction === 'paste') {
      handlePaste();
      return;
    }

    const menuWidth = 280;
    const menuHeight = 310;
    const x = Math.max(10, Math.min(e.clientX, window.innerWidth - menuWidth));
    const y = Math.max(10, Math.min(e.clientY, window.innerHeight - menuHeight));
    setContextMenu({ x, y });
  }, [handlePaste]);

  const connect = useCallback((forceNew = false) => {
    let session = sessionRegistry.get(tab.id);
    const isClosed = !session?.isConnected && (
      (session?.transport === 'ws' && session?.ws && (session.ws.readyState === WebSocket.CLOSED || session.ws.readyState === WebSocket.CLOSING)) ||
      (session?.transport === 'http' && !session?.httpToken)
    );

    if (!session || forceNew || isClosed) {
      setIsConnecting(true);
      setIsConnected(false);
      setTabStatus(tab.id, 'connecting');

      if (session) {
        try {
          if (session.ws) session.ws.close();
          if (session.es) session.es.close();
          session.term.dispose();
          // Safe DOM detach — avoid removeChild crash when node ownership has shifted
          if (session.container.parentNode) {
            try { session.container.parentNode.removeChild(session.container); } catch { }
          }
        } catch { }
        sessionRegistry.delete(tab.id);
      }

      const container = document.createElement('div');
      container.className = 'w-full h-full';

      const currentSettings = settingsRef.current;
      const term = new XTerm({
        fontFamily: currentSettings.fontFamily,
        fontSize: currentSettings.fontSize,
        lineHeight: currentSettings.lineHeight,
        fontWeight: currentSettings.fontWeight,
        cursorBlink: currentSettings.cursorBlink,
        cursorStyle: currentSettings.cursorStyle,
        cursorWidth: 2,
        scrollback: 10000,
        theme: getEffectiveTheme(currentSettings.themePreset, appTheme),
        allowProposedApi: true,
      });

      const fit = new FitAddon();
      const links = new WebLinksAddon();
      const search = new SearchAddon();

      term.loadAddon(fit);
      term.loadAddon(links);
      term.loadAddon(search);
      term.open(container);

      session = {
        term,
        fit,
        ws: null,
        es: null,
        httpToken: null,
        transport: 'ws',
        container,
        isConnected: false,
        termSize: { cols: 80, rows: 24 },
      };
      sessionRegistry.set(tab.id, session);

      // Function to start HTTP Streaming Tunnel (bypasses corporate proxies blocking WebSocket)
      const startHttpTunnel = async () => {
        if (!sessionRegistry.has(tab.id)) return;
        setTransport('http');
        if (session) session.transport = 'http';
        try {
          const res = await fetch(`/api/ssh/http/connect/${tab.connectionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tabId: tab.id }),
          });
          const data = await res.json();
          if (!data.ok || !data.sessionToken) {
            throw new Error(data.error || 'Failed to establish connection');
          }

          const httpToken = data.sessionToken;
          session!.httpToken = httpToken;

          const es = new EventSource(`/api/ssh/http/stream/${encodeURIComponent(httpToken)}`);
          session!.es = es;

          es.onmessage = (event) => {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'data') {
                term.write(msg.data);
              } else if (msg.type === 'connected') {
                session!.isConnected = true;
                setIsConnecting(false);
                setIsConnected(true);
                setTabStatus(tab.id, 'connected');
                sendTerminalResize(session!, term.cols, term.rows);
              } else if (msg.type === 'status') {
                term.writeln(`\r\n\x1b[33m● ${msg.message}\x1b[0m\r\n`);
              } else if (msg.type === 'error') {
                term.writeln(`\r\n\x1b[31m✗ ${msg.message}\x1b[0m\r\n`);
                session!.isConnected = false;
                setIsConnecting(false);
                setIsConnected(false);
                setTabStatus(tab.id, 'disconnected');
              }
            } catch {
              term.write(event.data);
            }
          };

          es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) {
              if (session) session.isConnected = false;
              setIsConnecting(false);
              setIsConnected(false);
              setTabStatus(tab.id, 'disconnected');
            }
          };

          sendTerminalResize(session!, term.cols, term.rows);
        } catch (err: any) {
          setIsConnecting(false);
          setIsConnected(false);
          setTabStatus(tab.id, 'disconnected');
          term.writeln(`\r\n\x1b[31m✗ Connection failed: ${err.message}\x1b[0m\r\n`);
        }
      };

      // WebSocket connection with automatic fallback to HTTP Tunnel
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = localStorage.getItem('terminalsql_token');
      const wsUrl = `${proto}//${window.location.host}/api/ssh/connect/${tab.connectionId}?tabId=${encodeURIComponent(tab.id)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      
      let wsHandshakeSuccess = false;
      let fallbackTriggered = false;

      const triggerHttpFallback = () => {
        if (fallbackTriggered) return;
        fallbackTriggered = true;
        try { ws.close(); } catch {}
        startHttpTunnel();
      };

      const ws = new WebSocket(wsUrl);
      session.ws = ws;

      ws.onopen = () => {
        if (!sessionRegistry.has(tab.id)) return;
        wsHandshakeSuccess = true;
        session!.isConnected = true;
        session!.transport = 'ws';
        setTransport('ws');
        setIsConnecting(false);
        setIsConnected(true);
        setTabStatus(tab.id, 'connected');
        sendTerminalResize(session!, term.cols, term.rows);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'data') {
            term.write(msg.data);
          } else if (msg.type === 'connected') {
            session!.isConnected = true;
            setIsConnecting(false);
            setIsConnected(true);
            setTabStatus(tab.id, 'connected');
          } else if (msg.type === 'error') {
            term.writeln(`\r\n\x1b[31m✗ ${msg.message}\x1b[0m\r\n`);
          }
        } catch {
          try {
            const decoded = atob(event.data);
            term.write(decoded);
          } catch {
            term.write(event.data);
          }
        }
      };

      ws.onclose = (event) => {
        if (!sessionRegistry.has(tab.id)) return;
        if (!wsHandshakeSuccess && (event.code === 1006 || event.code === 1005)) {
          // Handshake blocked by corporate proxy -> auto fallback to HTTP streaming!
          triggerHttpFallback();
          return;
        }

        session!.isConnected = false;
        setIsConnecting(false);
        setIsConnected(false);
        setTabStatus(tab.id, 'disconnected');
        term.writeln(`\r\n\x1b[33m● Session closed (${event.reason || 'code ' + event.code})\x1b[0m\r\n`);
      };

      ws.onerror = () => {
        if (!sessionRegistry.has(tab.id)) return;
        if (!wsHandshakeSuccess) {
          triggerHttpFallback();
          return;
        }
        session!.isConnected = false;
        setIsConnecting(false);
        setIsConnected(false);
        setTabStatus(tab.id, 'disconnected');
      };

      term.onData((data) => {
        sendTerminalInput(session!, data);
      });

      term.onResize(({ cols, rows }) => {
        session!.termSize = { cols, rows };
        setTermSize({ cols, rows });
        sendTerminalResize(session!, cols, rows);
      });

      term.onSelectionChange(() => {
        if (settingsRef.current.copyOnSelect) {
          const sel = term.getSelection();
          if (sel && sel.length > 0) {
            navigator.clipboard.writeText(sel).catch(() => { });
          }
        }
      });
    }

    xtermRef.current = session.term;
    fitRef.current = session.fit;
    wsRef.current = session.ws || null;
    setIsConnected(session.isConnected);
    setTermSize(session.termSize);
    setTransport(session.transport);
    setTabStatus(tab.id, session.isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected');

    // Mount container into termRef.current DOM node
    if (termRef.current) {
      if (!termRef.current.contains(session.container)) {
        // Safe clear — avoid innerHTML = '' which can cause removeChild crashes
        while (termRef.current.firstChild) {
          try { termRef.current.removeChild(termRef.current.firstChild); } catch { break; }
        }
        termRef.current.appendChild(session.container);
      }
      setTimeout(() => {
        try {
          session!.fit.fit();
          session!.termSize = { cols: session!.term.cols, rows: session!.term.rows };
          setTermSize({ cols: session!.term.cols, rows: session!.term.rows });
          sendTerminalResize(session!, session!.term.cols, session!.term.rows);
        } catch { }
      }, 50);
    }
  }, [tab.id, tab.connectionId, appTheme]);

  useEffect(() => {
    connect(false);

    const handleTabClosed = (e: any) => {
      if (e.detail?.tabId === tab.id) {
        disposeTerminalSession(tab.id);
      }
    };
    window.addEventListener('terminalsql:tab-closed', handleTabClosed);

    const handleResize = () => {
      if (fitRef.current && xtermRef.current) {
        try {
          fitRef.current.fit();
          setTermSize({ cols: xtermRef.current.cols, rows: xtermRef.current.rows });
        } catch { }
      }
    };
    const handleClickOutside = () => setContextMenu(null);
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        xtermRef.current?.clearSelection();
        xtermRef.current?.focus();
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        handlePaste();
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        handleCopySelection();
      }
    };

    let ro: ResizeObserver | null = null;
    if (termRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (fitRef.current && xtermRef.current) {
          try {
            fitRef.current.fit();
            setTermSize({ cols: xtermRef.current.cols, rows: xtermRef.current.rows });
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }));
            }
          } catch { }
        }
      });
      ro.observe(termRef.current);
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleGlobalKeyDown);

    return () => {
      ro?.disconnect();
      window.removeEventListener('terminalsql:tab-closed', handleTabClosed);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleGlobalKeyDown);
      // NOTE: We do NOT close ws or dispose term on unmount so split-screen does not reconnect!
      const sess = sessionRegistry.get(tab.id);
      if (sess && termRef.current?.contains(sess.container)) {
        try {
          termRef.current.removeChild(sess.container);
        } catch { }
      }
    };
  }, [tab.id, connect, handlePaste, handleCopySelection]);

  const [isTouchDevice, setIsTouchDevice] = useState(false);
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);
  }, []);

  function handleDisconnect() {
    const sess = sessionRegistry.get(tab.id);
    if (sess) {
      if (sess.transport === 'ws' && sess.ws?.readyState === WebSocket.OPEN) {
        try { sess.ws.send(JSON.stringify({ type: 'disconnect' })); } catch { }
        sess.ws.close(1000, 'User disconnected');
      } else if (sess.httpToken) {
        fetch(`/api/ssh/http/input/${encodeURIComponent(sess.httpToken)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'disconnect' }),
        }).catch(() => {});
        sess.es?.close();
      }
      sess.isConnected = false;
    }
    setIsConnecting(false);
    setIsConnected(false);
    setTabStatus(tab.id, 'disconnected');
    xtermRef.current?.writeln('\r\n\x1b[33m⚠ Disconnected by user\x1b[0m\r\n');
  }

  function handleDownloadLog() {
    if (!xtermRef.current) {
      toast.error('No terminal session active');
      return;
    }
    const term = xtermRef.current;
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }

    const raw = lines.join('\r\n');
    const clean = raw.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    const header = [
      '================================================================================',
      ` TerminalSQL SSH Session Log`,
      ` Host: ${tab.connection?.username || 'user'}@${tab.connection?.host || 'localhost'}:${tab.connection?.port || 22} (${tab.connection?.name || ''})`,
      ` Exported: ${new Date().toISOString()}`,
      '================================================================================\r\n',
    ].join('\r\n');

    const blob = new Blob([header + clean], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `ssh-log_${tab.connection?.host || 'remote'}_${dateStr}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Session log downloaded');
  }

  function sendSpecialKey(data: string) {
    const sess = sessionRegistry.get(tab.id);
    if (sess) {
      sendTerminalInput(sess, data);
      xtermRef.current?.focus();
    }
  }

  function handleOpenSFTP() {
    openTab({
      type: 'sftp',
      label: `SFTP: ${tab.connection?.name || 'SFTP'}`,
      connectionId: tab.connectionId,
      connection: tab.connection,
    });
    toast.success(`Opening SFTP for ${tab.connection?.name || 'Session'}`);
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden font-mono select-none bg-white dark:bg-black transition-colors">
      {/* Top Info & Command Bar */}
      <div className="min-h-8 py-0.5 px-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/95 dark:bg-zinc-950 flex items-center justify-between shrink-0 overflow-x-auto no-scrollbar gap-2 transition-colors">
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="outline"
            className={`text-[10px] py-0 px-1.5 h-4 flex items-center gap-1 font-mono transition-colors ${
              isConnected
                ? 'border-emerald-500/50 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                : isConnecting
                ? 'border-amber-500/50 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40'
                : 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-500 bg-zinc-200/60 dark:bg-zinc-900'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              isConnected
                ? 'bg-emerald-500 animate-pulse'
                : isConnecting
                ? 'bg-amber-500 animate-pulse'
                : 'bg-zinc-400 dark:bg-zinc-600'
            }`} />
            {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
          </Badge>

          {!isConnected && !isConnecting && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => connect(true)}
              className="h-5 px-2 text-[10.5px] bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-500/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 hover:text-emerald-900 dark:hover:text-white gap-1 font-sans rounded transition-all shadow-sm"
              title="Reconnect to server"
            >
              <RefreshCw className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
              <span>Reconnect</span>
            </Button>
          )}

          <span className="text-xs text-zinc-800 dark:text-zinc-300 font-medium truncate max-w-[200px]">
            {tab.connection?.username || 'user'}@{tab.connection?.host || 'localhost'}:{tab.connection?.port || 22}
          </span>

          <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline-block">
            ({termSize.cols}x{termSize.rows})
          </span>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Download Session Log */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadLog}
            className="h-6 px-2 text-[11px] border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sky-600 dark:text-sky-400 gap-1 font-mono shadow-xs"
            title="Download Session Output Log (.log)"
          >
            <Download className="w-3 h-3 text-sky-600 dark:text-sky-400" />
            <span className="hidden sm:inline-block">Log</span>
          </Button>

          {/* Quick jump to SFTP */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenSFTP}
            className="h-6 px-2 text-[11px] border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-amber-600 dark:text-amber-400 gap-1 font-mono shadow-xs"
            title="Open SFTP for this server"
          >
            <FolderOpen className="w-3 h-3" />
            <span className="hidden sm:inline-block">SFTP Mode</span>
          </Button>

          <Separator orientation="vertical" className="h-3.5 bg-zinc-300 dark:bg-zinc-800" />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleClear}
            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-900 h-6 w-6"
            title="Clear Terminal Screen"
          >
            <Eraser className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopySelection}
            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-900 h-6 w-6"
            title="Copy Selection"
          >
            <Copy className="w-3 h-3" />
          </Button>

          <Separator orientation="vertical" className="h-3.5 bg-zinc-300 dark:bg-zinc-800" />

          {/* Quick Font Size Controls */}
          <div className="flex items-center bg-white dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 px-1 py-0.5 shadow-xs" title="Quick Font Size">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleZoom(-1)}
              className="h-5 w-5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 p-0"
              title="Decrease Font Size (A-)"
            >
              <ZoomOut className="w-3 h-3" />
            </Button>
            <span className="text-[10px] font-mono text-zinc-700 dark:text-zinc-300 px-1 min-w-[26px] text-center select-none">
              {settings.fontSize}px
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => handleZoom(1)}
              className="h-5 w-5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 p-0"
              title="Increase Font Size (A+)"
            >
              <ZoomIn className="w-3 h-3" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowSettings(true)}
            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-900 h-6 w-6"
            title="Advanced Terminal & Font Settings"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>

          <Separator orientation="vertical" className="h-3.5 bg-zinc-300 dark:bg-zinc-800" />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => connect(true)}
            className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-900 h-6 w-6"
            title="Restart Session"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDisconnect}
            className="h-6 px-2 text-[11px] text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1"
            title="Close SSH Connection"
          >
            <Power className="w-3 h-3" />
            <span className="hidden sm:inline-block">Exit</span>
          </Button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        className="flex-1 p-2 overflow-hidden relative cursor-text select-text transition-colors"
        style={{ backgroundColor: activeTheme.background }}
        onContextMenu={handleContextMenu}
      >
        {/* Dedicated mount node for Xterm container with zero React children */}
        <div ref={termRef} className="w-full h-full" />
      </div>

      {/* Mobile Virtual Key Helper Bar (Touch Screen / Mobile Helper) */}
      {isTouchDevice && (
        <div className="h-8 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 px-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 z-10 select-none">
          <span className="text-[10px] text-zinc-500 font-mono pr-1.5 border-r border-zinc-200 dark:border-zinc-800 shrink-0">KEYPAD</span>
          {[
            { label: 'ESC', key: '\x1b' },
            { label: 'TAB', key: '\t' },
            { label: 'CTRL+C', key: '\x03' },
            { label: 'CTRL+D', key: '\x04' },
            { label: 'CTRL+Z', key: '\x1a' },
            { label: '▲', key: '\x1b[A' },
            { label: '▼', key: '\x1b[B' },
            { label: '◀', key: '\x1b[D' },
            { label: '▶', key: '\x1b[C' },
            { label: '|', key: '|' },
            { label: '~', key: '~' },
            { label: 'CLEAR', key: 'clear\r' },
          ].map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => sendSpecialKey(k.key)}
              className="h-6 px-2 min-w-[28px] rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 active:bg-zinc-200 dark:active:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[10.5px] font-mono shrink-0 transition-colors"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}

      {/* Native Desktop Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => {
              setContextMenu(null);
              xtermRef.current?.focus();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              handleContextMenu(e);
            }}
          />
          <div
            style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
            className="fixed z-50 min-w-[280px] w-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md p-1.5 shadow-2xl text-xs font-sans animate-in fade-in zoom-in-95 duration-100 text-zinc-800 dark:text-zinc-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 uppercase tracking-wider select-none font-semibold">
              Terminal Actions
            </div>

            <button
              onClick={handlePaste}
              className="w-full flex items-center justify-between gap-6 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <ClipboardPaste className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span>Paste from Clipboard</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">Ctrl+Shift+V</span>
            </button>

            <button
              onClick={handleCopySelection}
              className="w-full flex items-center justify-between gap-6 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Copy className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
                <span>Copy Selection</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">Ctrl+Shift+C</span>
            </button>

            <button
              onClick={handleSelectAll}
              className="w-full flex items-center justify-between gap-6 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <CheckSquare className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />
                <span>Select All</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">Ctrl+A</span>
            </button>

            <button
              onClick={handleClear}
              className="w-full flex items-center justify-between gap-6 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Eraser className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                <span>Clear Screen</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">Ctrl+L</span>
            </button>

            <div className="h-px bg-zinc-200 dark:bg-zinc-800/80 my-1" />

            <button
              onClick={() => {
                setContextMenu(null);
                handleDownloadLog();
              }}
              className="w-full flex items-center justify-between gap-6 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <Download className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400 shrink-0" />
                <span>Download Session Log</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0">.log</span>
            </button>

            <button
              onClick={() => {
                setContextMenu(null);
                setShowSettings(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <Settings2 className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
              Appearance & Font Settings
            </button>

            <button
              onClick={() => {
                setContextMenu(null);
                handleOpenSFTP();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <FolderOpen className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
              Open SFTP Manager
            </button>

            <button
              onClick={() => {
                setContextMenu(null);
                connect(true);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-900 dark:hover:text-white transition-colors select-none"
            >
              <RefreshCw className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
              Restart Session
            </button>

            <div className="h-px bg-zinc-200 dark:bg-zinc-800/80 my-1" />

            <button
              onClick={() => {
                setContextMenu(null);
                handleDisconnect();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 transition-colors select-none"
            >
              <Power className="w-3.5 h-3.5 shrink-0" />
              Close Session
            </button>
          </div>
        </>
      )}

      {/* Advanced Terminal Settings Modal */}
      {showSettings && (
        <TerminalSettingsModal
          settings={settings}
          onSave={applySettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
