import { useState, useEffect, useRef } from 'react';
import {
  X, Terminal, Database, FolderOpen, Copy, Edit2, Plus,
  Columns2, Rows2, Square, Trash2
} from 'lucide-react';
import { useAppStore, Tab } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import toast from 'react-hot-toast';
import { getDatabaseBrandIcon } from '@/components/common/DatabaseBrandIcons';

const TAB_ICONS = {
  ssh: Terminal,
  database: Database,
  sftp: FolderOpen,
};

const TAB_ACCENTS = {
  ssh: { text: 'text-emerald-400', border: 'border-b-emerald-500', icon: 'text-emerald-400', glow: 'bg-emerald-500/10' },
  database: { text: 'text-purple-400', border: 'border-b-purple-500', icon: 'text-purple-400', glow: 'bg-purple-500/10' },
  sftp: { text: 'text-amber-400', border: 'border-b-amber-500', icon: 'text-amber-400', glow: 'bg-amber-500/10' },
};

interface ContextMenuState {
  x: number;
  y: number;
  tab: Tab;
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    duplicateTab,
    renameTab,
    closeOtherTabs,
    closeAllTabs,
    splitMode,
    setSplitMode,
    draggingTabId,
    setDraggingTabId,
  } = useAppStore();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        setEditingTabId(null);
      }
    };
    window.addEventListener('click', handleCloseMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleCloseMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  if (tabs.length === 0) return null;

  const handleTabContextMenu = (e: React.MouseEvent, tab: Tab) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 220;
    const menuHeight = 280;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight);
    setContextMenu({ x, y, tab });
  };

  const handleSaveRename = () => {
    if (editingTabId && editingLabel.trim()) {
      renameTab(editingTabId, editingLabel.trim());
    }
    setEditingTabId(null);
  };

  const handleDuplicate = (tabId: string) => {
    const newId = duplicateTab(tabId);
    if (newId) {
      toast.success('Session duplicated in new tab');
    }
    setContextMenu(null);
  };

  return (
    <div className="h-8 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between px-1.5 shrink-0 select-none no-scrollbar">
      {/* Left: Tab list with instant native desktop responsiveness */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 py-1 touch-pan-x">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab.type];
          const accent = TAB_ACCENTS[tab.type];
          const isActive = tab.id === activeTabId;
          const isEditing = editingTabId === tab.id;

          return (
            <div
              key={tab.id}
              draggable={!isEditing}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/terminalsql-tab', tab.id);
                e.dataTransfer.setData('text/plain', tab.id);
                e.dataTransfer.effectAllowed = 'move';
                setDraggingTabId(tab.id);
              }}
              onDragEnd={() => {
                setDraggingTabId(null);
              }}
              onClick={() => setActiveTab(tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingTabId(tab.id);
                setEditingLabel(tab.label);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              title={tab.label}
              className={`relative group h-6 px-2.5 rounded-t-md text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors max-w-[240px] shrink-0 select-none ${
                draggingTabId === tab.id ? 'opacity-40 scale-95 border-dashed border-purple-500' : ''
              } ${
                isActive
                  ? `bg-background text-foreground border-t border-x border-border shadow-sm`
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              }`}
            >
              {tab.type === 'database' ? (
                getDatabaseBrandIcon(tab.connection, tab.connection?.dbType, 'w-3 h-3 shrink-0')
              ) : (
                <Icon className={`w-3 h-3 shrink-0 ${isActive ? accent.icon : 'text-muted-foreground'}`} />
              )}

              {isEditing ? (
                <input
                  ref={editInputRef}
                  value={editingLabel}
                  onChange={(e) => setEditingLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') setEditingTabId(null);
                  }}
                  onBlur={handleSaveRename}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-28 bg-zinc-950 border border-zinc-600 rounded px-1 text-[11px] font-mono text-zinc-100 outline-none focus:border-white"
                />
              ) : (
                <span className="truncate flex-1 font-mono text-[11px]">{tab.label}</span>
              )}

              {/* Close Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="w-3.5 h-3.5 rounded flex items-center justify-center opacity-40 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-rose-500 transition-colors shrink-0"
                title="Close"
              >
                <X className="w-2.5 h-2.5" />
              </button>

              {/* Active Tab Accent Line */}
              {isActive && (
                <div
                  className={`absolute bottom-[-1px] left-0 right-0 h-[2px] ${accent.border.replace('border-b-', 'bg-')}`}
                />
              )}
            </div>
          );
        })}

        {/* Quick Duplicate / Add Tab button */}
        {activeTabId && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleDuplicate(activeTabId)}
                  className="h-5 w-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-0.5 shrink-0"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Duplicate</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Right: Multi-screen / Split layout controls */}
      <div className="flex items-center gap-1 pl-2 border-l border-border shrink-0">
        <TooltipProvider delayDuration={200}>
          {/* Single Screen */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSplitMode('single')}
                className={`h-6 w-6 rounded ${
                  splitMode === 'single'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Square className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Single</p>
            </TooltipContent>
          </Tooltip>

          {/* Split Horizontal (Columns) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSplitMode(splitMode === 'split-horizontal' ? 'single' : 'split-horizontal')}
                className={`h-6 w-6 rounded ${
                  splitMode === 'split-horizontal'
                    ? 'bg-muted text-emerald-500 font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Columns2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Columns</p>
            </TooltipContent>
          </Tooltip>

          {/* Split Vertical (Rows) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSplitMode(splitMode === 'split-vertical' ? 'single' : 'split-vertical')}
                className={`h-6 w-6 rounded ${
                  splitMode === 'split-vertical'
                    ? 'bg-muted text-emerald-500 font-semibold'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Rows2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Rows</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Native Desktop Context Menu for Tabs */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 min-w-[210px] rounded-lg border border-border bg-popover/95 backdrop-blur-md p-1 shadow-2xl text-xs font-sans text-popover-foreground animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] font-mono text-muted-foreground uppercase tracking-wider select-none truncate">
            {contextMenu.tab.label}
          </div>

          <button
            onClick={() => handleDuplicate(contextMenu.tab.id)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-foreground hover:bg-muted transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-emerald-400" />
              Duplicate Tab
            </span>
            <span className="text-[10px] font-mono text-zinc-500">Ctrl+D</span>
          </button>

          <button
            onClick={() => {
              setSplitMode('split-horizontal', contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <Columns2 className="w-3.5 h-3.5 text-sky-400" />
              Split Right (Kiri / Kanan)
            </span>
          </button>

          <button
            onClick={() => {
              setSplitMode('split-vertical', contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <Rows2 className="w-3.5 h-3.5 text-sky-400" />
              Split Down (Atas / Bawah)
            </span>
          </button>

          <div className="h-px bg-zinc-800 my-1" />

          <button
            onClick={() => {
              setEditingTabId(contextMenu.tab.id);
              setEditingLabel(contextMenu.tab.label);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <Edit2 className="w-3.5 h-3.5 text-zinc-400" />
              Rename Tab
            </span>
            <span className="text-[10px] font-mono text-zinc-500">F2</span>
          </button>

          <div className="h-px bg-zinc-800 my-1" />

          <button
            onClick={() => {
              closeTab(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-rose-300 hover:bg-rose-950/40 hover:text-rose-200 transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <X className="w-3.5 h-3.5" />
              Close Tab
            </span>
            <span className="text-[10px] font-mono text-zinc-500">Ctrl+W</span>
          </button>

          <button
            onClick={() => {
              closeOtherTabs(contextMenu.tab.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200 transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5 text-zinc-500" />
              Close Other Tabs
            </span>
          </button>

          <button
            onClick={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200 transition-colors select-none"
          >
            <span className="flex items-center gap-2">
              <X className="w-3.5 h-3.5 text-zinc-500" />
              Close All Tabs
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
