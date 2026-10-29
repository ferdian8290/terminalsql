import { useState, useEffect, useRef } from 'react';
import { LogOut, Lock, Terminal, Plus, X, Copy, Sun, Moon, Rows2, Columns2, Menu } from 'lucide-react';
import { useAppStore, Tab } from '@/store/appStore';
import { api } from '@/utils/api';
import { APP_VERSION } from '@/version';
import { TabBar } from './TabBar';
import { ConnectionSidebar } from './ConnectionSidebar';
import { NewConnectionModal } from '../ConnectionManager/NewConnectionModal';
import { SSHTerminal } from '../Terminal/SSHTerminal';
import { QueryEditor } from '../QueryEditor/QueryEditor';
import { SFTPManager } from '../FileManager/SFTPManager';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export function AppShell() {
  const {
    user,
    setUser,
    connections,
    setConnections,
    tabs,
    activeTabId,
    setActiveTab,
    splitMode,
    splitTabId,
    setSplitMode,
    setSplitTabId,
    duplicateTab,
    theme,
    setTheme,
    draggingTabId,
    setDraggingTabId,
  } = useAppStore();

  const navigate = useNavigate();
  const [showNewModal, setShowNewModal] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setMobileDrawerOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Left sidebar resizable width (persisted in localStorage)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('terminalsql_sidebar_width');
    return saved ? Math.max(150, Math.min(480, parseInt(saved, 10))) : 190;
  });
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  // Split-screen drag & drop suggestion states
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [activeDropZone, setActiveDropZone] = useState<'bottom' | 'right' | null>(null);

  const handleWorkspaceDragOver = (e: React.DragEvent) => {
    if (!draggingTabId && !e.dataTransfer.types.includes('application/terminalsql-tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (!workspaceRef.current) return;
    const rect = workspaceRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;

    if (relY > 0.5) {
      setActiveDropZone('bottom');
    } else if (relX > 0.5) {
      setActiveDropZone('right');
    } else {
      setActiveDropZone(null);
    }
  };

  const handleWorkspaceDragLeave = (e: React.DragEvent) => {
    if (!workspaceRef.current?.contains(e.relatedTarget as Node)) {
      setActiveDropZone(null);
    }
  };

  const handleWorkspaceDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const tabId = e.dataTransfer.getData('application/terminalsql-tab') || e.dataTransfer.getData('text/plain') || draggingTabId;
    const zone = activeDropZone;
    setActiveDropZone(null);
    setDraggingTabId(null);

    if (tabId && zone) {
      if (zone === 'bottom') {
        setSplitMode('split-vertical', tabId);
        toast.success('Vertical split enabled');
      } else if (zone === 'right') {
        setSplitMode('split-horizontal', tabId);
        toast.success('Horizontal split enabled');
      }
    }
  };

  useEffect(() => {
    api.connections.list()
      .then(({ connections }) => setConnections(connections))
      .catch(() => {});

    // Native Desktop App Behavior: prevent browser context menu across all pages
    const handleGlobalContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable ||
        target?.closest('.monaco-editor')
      ) {
        return;
      }
      e.preventDefault();
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu);
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu);
  }, []);

  const handleMouseDownSidebar = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(150, Math.min(480, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setSidebarWidth((w: number) => {
        localStorage.setItem('terminalsql_sidebar_width', w.toString());
        return w;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  async function handleLogout() {
    await api.auth.logout().catch(() => {});
    localStorage.removeItem('terminalsql_token');
    setUser(null);
    navigate('/login');
    toast.success('Logged out');
  }

  const activeSessions = tabs.filter((t) => t.type === 'ssh').length;

  const renderTabContent = (tab: Tab) => {
    switch (tab.type) {
      case 'ssh':
        return <SSHTerminal tab={tab} />;
      case 'database':
        return <QueryEditor tab={tab} />;
      case 'sftp':
        return <SFTPManager tab={tab} />;
      default:
        return null;
    }
  };

  const handlePane2Select = (newTabId: string) => {
    if (newTabId === activeTabId && splitTabId) {
      // Swap panes so activeTab becomes previous splitTab
      setActiveTab(splitTabId);
    }
    setSplitTabId(newTabId);
  };

  const effectiveSplitTab = tabs.find((t) => t.id === splitTabId) || tabs.find((t) => t.id !== activeTabId);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden font-sans select-none">
        {/* Top Global Header */}
        <header className="h-10 border-b border-border bg-card/80 backdrop-blur px-2.5 sm:px-3.5 flex items-center justify-between shrink-0 select-none z-20">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mobile Hamburger Drawer Trigger */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
              className="h-7 w-7 md:hidden text-muted-foreground hover:text-foreground"
              aria-label="Toggle Navigation Drawer"
            >
              <Menu className="w-4 h-4" />
            </Button>

            <div className="w-6 h-6 rounded-md bg-primary text-primary-foreground flex items-center justify-center shadow-sm hover:scale-105 transition-transform">
              <Terminal className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold tracking-tight text-foreground flex items-center gap-1.5 sm:gap-2 text-xs">
              TerminalSQL
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border bg-muted text-muted-foreground font-mono font-normal">
                {APP_VERSION}
              </Badge>
            </span>

            {activeSessions > 0 && (
              <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-950/30 text-[10.5px] sm:text-[11px] flex items-center gap-1.5 ml-1 sm:ml-2 font-mono transition-all animate-in fade-in duration-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{activeSessions} SSH</span>
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono hidden sm:inline-block">{user?.email}</span>
            <Separator orientation="vertical" className="h-3.5 bg-border hidden sm:inline-block" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  aria-label={theme === 'dark' ? 'Light' : 'Dark'}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted h-7 w-7 transition-colors"
                >
                  {theme === 'dark' ? (
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <Moon className="w-3.5 h-3.5 text-sky-400" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{theme === 'dark' ? 'Light' : 'Dark'}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={handleLogout} className="text-muted-foreground hover:text-foreground hover:bg-muted h-7 w-7 transition-colors">
                  <LogOut className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Logout</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Center: Left Connection Sidebar + Main Workspace */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Desktop Left Sidebar */}
          <div className="hidden md:flex shrink-0">
            <ConnectionSidebar
              collapsed={sidebarCollapsed}
              width={sidebarWidth}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              onNewConnection={() => setShowNewModal(true)}
            />

            {!sidebarCollapsed && (
              <div
                onMouseDown={handleMouseDownSidebar}
                className={`w-1 cursor-col-resize hover:bg-zinc-600 transition-colors shrink-0 select-none relative group z-20 ${
                  isDraggingSidebar ? 'bg-zinc-500' : 'bg-transparent'
                }`}
                title="Drag to resize sidebar width"
              >
                <div className="absolute inset-y-0 -left-1 -right-1" />
              </div>
            )}
          </div>

          {/* Mobile Sliding Drawer Overlay */}
          {isMobile && mobileDrawerOpen && (
            <div className="fixed inset-0 z-50 flex md:hidden">
              <div
                className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
                onClick={() => setMobileDrawerOpen(false)}
              />
              <div className="relative w-72 max-w-[85vw] h-full bg-card border-r border-border shadow-2xl flex flex-col z-10 animate-in slide-in-from-left duration-200">
                <ConnectionSidebar
                  collapsed={false}
                  width={288}
                  onToggleCollapse={() => setMobileDrawerOpen(false)}
                  onNewConnection={() => {
                    setMobileDrawerOpen(false);
                    setShowNewModal(true);
                  }}
                />
              </div>
            </div>
          )}

          {/* Main workspace (Tabs + Active Terminal / Query / SFTP) */}
          <main className="flex-1 flex flex-col overflow-hidden bg-background">
            <TabBar />

            <div
              ref={workspaceRef}
              onDragOver={handleWorkspaceDragOver}
              onDragLeave={handleWorkspaceDragLeave}
              onDrop={handleWorkspaceDrop}
              className="flex-1 overflow-hidden relative"
            >
              {/* Drag & Drop Split Screen Suggestion Overlays */}
              {draggingTabId && (
                <>
                  {/* Bottom Half Suggestion Zone */}
                  <div
                    className={`absolute inset-x-3 bottom-3 h-[46%] z-40 rounded-xl transition-all duration-150 flex flex-col items-center justify-center gap-2 pointer-events-none ${
                      activeDropZone === 'bottom'
                        ? 'border-2 border-dashed border-purple-500 bg-purple-500/20 backdrop-blur-[2px] shadow-2xl scale-[1.01]'
                        : 'border border-dashed border-purple-500/30 bg-purple-500/5'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center transition-transform ${
                        activeDropZone === 'bottom'
                          ? 'bg-purple-500 text-white scale-110 shadow-lg'
                          : 'bg-purple-500/20 text-purple-400'
                      }`}
                    >
                      <Rows2 className="w-5 h-5" />
                    </div>
                    <div className="text-center select-none">
                      <p
                        className={`text-xs font-semibold ${
                          activeDropZone === 'bottom' ? 'text-purple-200' : 'text-purple-300/70'
                        }`}
                      >
                        Split Down
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        Drop tab here to split vertically
                      </p>
                    </div>
                  </div>

                  {/* Right Half Suggestion Zone */}
                  {activeDropZone === 'right' && (
                    <div className="absolute inset-y-3 right-3 w-[46%] z-40 rounded-xl transition-all duration-150 flex flex-col items-center justify-center gap-2 pointer-events-none border-2 border-dashed border-purple-500 bg-purple-500/20 backdrop-blur-[2px] shadow-2xl scale-[1.01]">
                      <div className="w-9 h-9 rounded-lg bg-purple-500 text-white scale-110 shadow-lg flex items-center justify-center">
                        <Columns2 className="w-5 h-5" />
                      </div>
                      <div className="text-center select-none">
                        <p className="text-xs font-semibold text-purple-200">
                          Split Right
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          Drop tab here to split horizontally
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
              {tabs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-8 bg-background text-center select-none space-y-4 animate-in fade-in duration-300">
                  <div className="w-14 h-14 rounded-2xl bg-card border border-border flex items-center justify-center text-muted-foreground shadow-xl hover:scale-105 transition-transform">
                    <Terminal className="w-7 h-7" />
                  </div>
                  <div className="space-y-1.5 max-w-md">
                    <h2 className="text-base font-semibold text-foreground">Welcome to TerminalSQL</h2>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Select a connection from the left panel to open a session, or create a new SSH, Database, or SFTP connection.
                    </p>
                  </div>
                  <Button
                    onClick={() => setShowNewModal(true)}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs h-8 px-4 gap-1.5 shadow-sm transition-all hover:shadow"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Connection
                  </Button>
                </div>
              ) : splitMode === 'single' || !effectiveSplitTab ? (
                /* Single View: keeps all tab sessions mounted */
                tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      style={{ display: isActive ? 'block' : 'none' }}
                      className="h-full w-full"
                    >
                      {renderTabContent(tab)}
                    </div>
                  );
                })
              ) : (
                /* Multi-screen Split View (Horizontal Kiri/Kanan or Vertical Atas/Bawah) */
                <ResizablePanelGroup
                  direction={splitMode === 'split-horizontal' ? 'horizontal' : 'vertical'}
                  className="h-full w-full"
                >
                  {/* Pane 1 (Primary: Active Tab) */}
                  <ResizablePanel defaultSize={50} minSize={20} className="relative flex flex-col h-full overflow-hidden">
                    <div className="flex-1 overflow-hidden relative">
                      {tabs
                        .filter((t) => t.id !== effectiveSplitTab.id)
                        .map((tab) => {
                          const isActive = tab.id === activeTabId;
                          return (
                            <div
                              key={tab.id}
                              style={{ display: isActive ? 'block' : 'none' }}
                              className="h-full w-full"
                            >
                              {renderTabContent(tab)}
                            </div>
                          );
                        })}
                    </div>
                  </ResizablePanel>

                  {/* Resizable Divider Handle */}
                  <ResizableHandle withHandle className="bg-zinc-800 hover:bg-zinc-600 transition-colors z-10" />

                  {/* Pane 2 (Secondary: Split Tab) */}
                  <ResizablePanel defaultSize={50} minSize={20} className="relative flex flex-col h-full overflow-hidden bg-zinc-950">
                    {/* Pane 2 Sub-header */}
                    <div className="h-7 border-b border-zinc-800 bg-zinc-950 px-2 flex items-center justify-between text-xs font-mono shrink-0 select-none z-10">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Pane 2</span>
                        <select
                          value={effectiveSplitTab.id}
                          onChange={(e) => handlePane2Select(e.target.value)}
                          className="bg-zinc-900 border border-zinc-700/80 text-zinc-200 text-[11px] rounded px-2 py-0.5 outline-none focus:border-zinc-500 font-mono"
                        >
                          {tabs.map((t) => (
                            <option key={t.id} value={t.id} className="bg-zinc-900 text-zinc-200">
                              {t.label} ({t.type.toUpperCase()})
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => {
                            const newId = duplicateTab(effectiveSplitTab.id);
                            if (newId) {
                              setSplitTabId(newId);
                              toast.success('Pane 2 session duplicated');
                            }
                          }}
                          className="h-5 px-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
                          title="Duplicate Pane 2 session"
                        >
                          <Copy className="w-2.5 h-2.5" />
                          <span>Duplicate</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSplitMode('single')}
                          className="h-5 px-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white text-[10px] flex items-center gap-1 transition-colors"
                          title="Close split pane and return to single view"
                        >
                          <X className="w-3 h-3" />
                          <span>Close Split</span>
                        </button>
                      </div>
                    </div>

                    {/* Pane 2 Content */}
                    <div className="flex-1 overflow-hidden relative">
                      {tabs
                        .filter((t) => t.id === effectiveSplitTab.id)
                        .map((tab) => (
                          <div key={tab.id} className="h-full w-full">
                            {renderTabContent(tab)}
                          </div>
                        ))}
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </div>
          </main>
        </div>

        {/* Bottom Status Bar */}
        <footer className="h-6 border-t border-zinc-800 bg-zinc-950 px-3 flex items-center justify-between text-[11px] text-zinc-400 shrink-0 select-none font-mono">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-emerald-400">
              <Lock className="w-2.5 h-2.5" />
              <span>TLS 1.3 · AES-256</span>
            </div>
            <Separator orientation="vertical" className="h-3 bg-zinc-800" />
            <span>{tabs.length} tab{tabs.length !== 1 ? 's' : ''} open</span>
            <Separator orientation="vertical" className="h-3 bg-zinc-800" />
            <span>{connections.length} saved</span>
            {splitMode !== 'single' && (
              <>
                <Separator orientation="vertical" className="h-3 bg-zinc-800" />
                <span className="text-emerald-400">
                  {splitMode === 'split-horizontal' ? 'Split: Left / Right' : 'Split: Top / Bottom'}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-500">TerminalSQL Web</span>
          </div>
        </footer>

        {showNewModal && <NewConnectionModal onClose={() => setShowNewModal(false)} />}
      </div>
    </TooltipProvider>
  );
}
