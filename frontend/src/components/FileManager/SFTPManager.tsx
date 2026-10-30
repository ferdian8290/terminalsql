import { useState, useEffect, useRef } from 'react';
import {
  Folder, File, Upload, Download, Trash2, FolderPlus,
  Edit2, RefreshCw, ChevronRight, ArrowUp, Home, Loader2, HardDrive,
  Terminal, Laptop, ArrowRight, ArrowLeft, Copy, Columns, Maximize2
} from 'lucide-react';
import { api } from '@/utils/api';
import { useAppStore, Tab } from '@/store/appStore';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

interface Props { tab: Tab; }

interface RemoteFileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  permissions?: any;
}

interface LocalFileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  fileObj?: File;
}

interface TransferItem {
  name: string;
  size: number;
  direction: 'upload' | 'download';
  status: 'success' | 'failed' | 'in_progress';
  time: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${hours}:${mins}`;
}

function getFileType(name: string, isDir: boolean): string {
  if (isDir) return 'File folder';
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'File';
  if (['txt', 'md', 'log'].includes(ext)) return 'Text Document';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'sh', 'json', 'yml', 'yaml'].includes(ext)) return `${ext.toUpperCase()} Source`;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) return 'Image File';
  if (['zip', 'tar', 'gz', 'bz2'].includes(ext)) return 'Archive';
  return `${ext.toUpperCase()} File`;
}

// Local site starts empty — user stages files via drag-drop or "Browse PC..." button
const INITIAL_LOCAL_FILES: LocalFileEntry[] = [];

export function SFTPManager({ tab }: Props) {
  const openTab = useAppStore((s) => s.openTab);

  // Remote site states (defaults to user home directory '.')
  const [remotePath, setRemotePath] = useState('.');
  const [remotePathInput, setRemotePathInput] = useState('');
  const [remoteFiles, setRemoteFiles] = useState<RemoteFileEntry[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
  const [remoteContextMenu, setRemoteContextMenu] = useState<{ x: number; y: number; item: RemoteFileEntry } | null>(null);
  const [renamingRemote, setRenamingRemote] = useState<string | null>(null);
  const [newRemoteName, setNewRemoteName] = useState('');

  // Local site states — path display only (browser sandboxing prevents real FS access)
  const [localPathInput, setLocalPathInput] = useState('Local / Staged Files');
  const [localFiles, setLocalFiles] = useState<LocalFileEntry[]>(INITIAL_LOCAL_FILES);
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const [localContextMenu, setLocalContextMenu] = useState<{ x: number; y: number; item: LocalFileEntry } | null>(null);

  // Logs & Transfers states
  const [logs, setLogs] = useState<string[]>([
    `Status: Connecting to sftp://${tab.connection?.username || 'user'}@${tab.connection?.host || 'remote'}:${tab.connection?.port || 22}...`,
    'Status: Connected. Resolving home directory...'
  ]);
  const [showLog, setShowLog] = useState(true);
  const [logHeight, setLogHeight] = useState(() => {
    const saved = localStorage.getItem('terminalsql_sftp_log_height');
    return saved ? parseInt(saved, 10) : 80;
  });
  const [isDraggingLog, setIsDraggingLog] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [showTransferDrawer, setShowTransferDrawer] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const directUploadRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState<'remote' | 'dual'>(() => {
    return (localStorage.getItem('terminalsql_sftp_view_mode') as 'remote' | 'dual') || 'remote';
  });
  const [isDraggingOverRemote, setIsDraggingOverRemote] = useState(false);

  const toggleViewMode = () => {
    setViewMode((prev) => {
      const next = prev === 'remote' ? 'dual' : 'remote';
      localStorage.setItem('terminalsql_sftp_view_mode', next);
      return next;
    });
  };

  const handleDragOverRemote = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverRemote(true);
  };

  const handleDragLeaveRemote = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverRemote(false);
  };

  const handleDropOnRemote = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOverRemote(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleDirectUploadFiles(e.dataTransfer.files);
    }
  };

  async function handleDirectUploadFiles(files: FileList | File[]) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    for (const file of fileArray) {
      addLog(`Command: put "${file.name}" to "${remotePath}"`);
      const toastId = toast.loading(`Uploading ${file.name}...`);
      try {
        await api.sftp.upload(
          tab.connectionId,
          remotePath + (remotePath.endsWith('/') ? '' : '/') + file.name,
          file
        );
        toast.success(`Uploaded ${file.name}`, { id: toastId });
        addLog(`Status: File transfer successful, transferred ${formatSize(file.size)}`);
        setTransfers((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            direction: 'upload',
            status: 'success',
            time: new Date().toLocaleTimeString(),
          },
        ]);
      } catch (err: any) {
        addLog(`Error: File transfer failed: ${err.message}`);
        toast.error(`Upload failed: ${err.message}`, { id: toastId });
        setTransfers((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            direction: 'upload',
            status: 'failed',
            time: new Date().toLocaleTimeString(),
          },
        ]);
      }
    }
    loadRemoteFiles(remotePath);
  }

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleMouseDownLog = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLog(true);
    const startY = e.clientY;
    const startHeight = logHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(36, Math.min(450, startHeight + (moveEvent.clientY - startY)));
      setLogHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingLog(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setLogHeight((h: number) => {
        localStorage.setItem('terminalsql_sftp_log_height', h.toString());
        return h;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  useEffect(() => {
    loadRemoteFiles(remotePath);
  }, [remotePath, tab.connectionId]);

  useEffect(() => {
    const handleGlobalClick = () => {
      setRemoteContextMenu(null);
      setLocalContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  function addLog(msg: string) {
    setLogs((prev) => [...prev.slice(-40), msg]);
  }

  // Load Remote Files
  async function loadRemoteFiles(p: string) {
    setLoadingRemote(true);
    addLog(`Command: ls "${p}"`);
    try {
      const res = await api.sftp.list(tab.connectionId, p);
      const resolvedPath = res.path || p;
      if (resolvedPath !== remotePath) {
        setRemotePath(resolvedPath);
      }
      setRemotePathInput(resolvedPath);
      const sorted = [...res.files].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setRemoteFiles(sorted);
      setSelectedRemote(null);
      addLog(`Status: Directory listing of "${resolvedPath}" successful (${sorted.length} items)`);
    } catch (err: any) {
      addLog(`Error: Failed to retrieve directory listing: ${err.message}`);
      toast.error(`Failed to list: ${err.message}`);
    } finally {
      setLoadingRemote(false);
    }
  }

  function navigateRemote(file: RemoteFileEntry) {
    if (file.type === 'directory') {
      const newPath = remotePath === '/' ? `/${file.name}` : `${remotePath}/${file.name}`;
      setRemotePath(newPath);
    } else {
      // If file double clicked on remote -> download it!
      handleDownloadFile(file.name);
    }
  }

  function goUpRemote() {
    if (remotePath === '/') return;
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    setRemotePath('/' + parts.join('/') || '/');
  }

  // Download Remote File
  function handleDownloadFile(fileName?: string) {
    const target = fileName || selectedRemote;
    if (!target) {
      toast.error('Select a remote file to download');
      return;
    }
    const file = remoteFiles.find((f) => f.name === target);
    if (file && file.type === 'directory') {
      navigateRemote(file);
      return;
    }

    const filePath = `${remotePath === '/' ? '' : remotePath}/${target}`;
    addLog(`Command: get "${filePath}"`);
    const url = api.sftp.download(tab.connectionId, filePath);

    const a = document.createElement('a');
    a.href = url;
    a.download = target;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast.success(`Downloading ${target}...`);
    addLog(`Status: File transfer started: get "${target}"`);

    setTransfers((prev) => [
      ...prev,
      {
        name: target,
        size: file?.size || 0,
        direction: 'download',
        status: 'success',
        time: new Date().toLocaleTimeString(),
      },
    ]);
  }

  // Upload Local File
  async function handleUploadLocalFile(item?: LocalFileEntry) {
    const target = item || localFiles.find((f) => f.name === selectedLocal);
    if (!target) {
      toast.error('Select a local file to upload');
      return;
    }

    if (target.type === 'directory') {
      toast('Folder upload is currently not supported', { icon: 'ℹ️' });
      return;
    }

    // Get actual File object or create fallback blob
    let fileToUpload: File;
    if (target.fileObj) {
      fileToUpload = target.fileObj;
    } else {
      // Sample local file fallback content
      const dummyContent = `# File: ${target.name}\n# Uploaded from TerminalSQL SFTP Client\n# Generated at: ${new Date().toISOString()}\n`;
      fileToUpload = new window.File([dummyContent], target.name, { type: 'text/plain' });
    }

    addLog(`Command: put "${target.name}" to "${remotePath}"`);
    const toastId = toast.loading(`Uploading ${target.name}...`);

    try {
      await api.sftp.upload(
        tab.connectionId,
        remotePath + (remotePath.endsWith('/') ? '' : '/') + target.name,
        fileToUpload
      );
      toast.success(`Uploaded ${target.name}`, { id: toastId });
      addLog(`Status: File transfer successful, transferred ${fileToUpload.size} bytes`);

      setTransfers((prev) => [
        ...prev,
        {
          name: target.name,
          size: fileToUpload.size,
          direction: 'upload',
          status: 'success',
          time: new Date().toLocaleTimeString(),
        },
      ]);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      addLog(`Error: File transfer failed: ${err.message}`);
      toast.error(`Upload failed: ${err.message}`, { id: toastId });
      setTransfers((prev) => [
        ...prev,
        {
          name: target.name,
          size: fileToUpload.size,
          direction: 'upload',
          status: 'failed',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    }
  }

  // Handle files picked from user's hard drive
  function handleLocalFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const newEntries: LocalFileEntry[] = Array.from(fileList).map((f) => ({
      name: f.name,
      type: 'file',
      size: f.size,
      modifiedAt: Math.floor(f.lastModified / 1000),
      fileObj: f,
    }));

    setLocalFiles((prev) => {
      const existingNames = new Set(prev.map((e) => e.name));
      const filtered = newEntries.filter((e) => !existingNames.has(e.name));
      return [...filtered, ...prev];
    });

    toast.success(`Added ${newEntries.length} file(s) to Local site`);
  }

  // Remote Delete
  async function handleDeleteRemote(fileName?: string) {
    const target = fileName || selectedRemote;
    if (!target) return;
    const file = remoteFiles.find((f) => f.name === target);
    if (!file) return;
    if (!confirm(`Delete "${target}" from server?`)) return;

    const filePath = `${remotePath === '/' ? '' : remotePath}/${target}`;
    addLog(`Command: rm "${filePath}"`);
    try {
      await api.sftp.delete(tab.connectionId, filePath, file.type);
      toast.success('Deleted from server');
      addLog(`Status: Deleted "${filePath}"`);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      toast.error(err.message);
    }
  }

  // Remote Make Directory
  async function handleMkdirRemote() {
    const name = prompt('Create Remote Directory - Folder Name:');
    if (!name) return;
    const newPath = `${remotePath === '/' ? '' : remotePath}/${name}`;
    addLog(`Command: mkdir "${newPath}"`);
    try {
      await api.sftp.mkdir(tab.connectionId, newPath);
      toast.success('Directory created');
      addLog(`Status: Directory "${newPath}" created successfully`);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      toast.error(err.message);
    }
  }

  // Remote Rename
  async function handleRenameRemote() {
    if (!renamingRemote || !newRemoteName || newRemoteName === renamingRemote) {
      setRenamingRemote(null);
      return;
    }
    const oldPath = `${remotePath === '/' ? '' : remotePath}/${renamingRemote}`;
    const newPath = `${remotePath === '/' ? '' : remotePath}/${newRemoteName}`;
    addLog(`Command: mv "${oldPath}" "${newPath}"`);
    try {
      await api.sftp.rename(tab.connectionId, oldPath, newPath);
      toast.success('Renamed on server');
      addLog(`Status: Renamed "${oldPath}" to "${newPath}"`);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      addLog(`Error: ${err.message}`);
      toast.error(err.message);
    } finally {
      setRenamingRemote(null);
    }
  }

  function handleOpenTerminal() {
    openTab({
      type: 'ssh',
      label: tab.connection?.name || 'SSH',
      connectionId: tab.connectionId,
      connection: tab.connection,
    });
    toast.success(`Opening SSH Terminal for ${tab.connection?.name || 'Session'}`);
  }

  const renderLocalPane = () => (
    <div className="flex-1 h-full w-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Local Path Toolbar */}
      <div className="h-8 px-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Laptop className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="text-[11px] font-mono text-zinc-400 font-semibold shrink-0">Local site:</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
            className="flex-1 min-w-0"
          >
            <Input
              value={localPathInput}
              onChange={(e) => setLocalPathInput(e.target.value)}
              className="h-6 text-[11px] font-mono bg-zinc-950 border-zinc-800 text-zinc-200 px-2 py-0 truncate"
            />
          </form>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setLocalPathInput('C:/Users/Local/')}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Local Root"
          >
            <Home className="w-3 h-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="h-6 px-2 text-[10px] border-zinc-800 text-zinc-300 hover:text-white gap-1"
            title="Browse files from your computer to stage here"
          >
            <HardDrive className="w-3 h-3 text-sky-400" />
            <span>Browse PC...</span>
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => handleLocalFilesPicked(e.target.files)}
          />
        </div>
      </div>

      {/* Local File Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {localFiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2 select-none">
            <Laptop className="w-8 h-8 opacity-25 text-zinc-400" />
            <h3 className="text-xs font-semibold text-zinc-300">No files staged</h3>
            <p className="text-[11px] text-zinc-500 leading-relaxed max-w-[200px]">
              Drag files from your PC onto this panel, or click <span className="text-sky-400 font-mono">Browse PC...</span> to stage files for upload.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-zinc-900/90 sticky top-0 border-b border-zinc-800 select-none">
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs">Filename</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-20 whitespace-nowrap">Filesize</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs w-28 whitespace-nowrap">Filetype</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-36 whitespace-nowrap">Last modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localFiles.map((file) => {
                  const isSelected = selectedLocal === file.name;
                  const isDir = file.type === 'directory';

                  return (
                    <TableRow
                      key={file.name}
                      onClick={() => setSelectedLocal(isSelected ? null : file.name)}
                      onDoubleClick={() => handleUploadLocalFile(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedLocal(file.name);
                        setLocalContextMenu({ x: e.clientX, y: e.clientY, item: file });
                      }}
                      className={`border-zinc-800/60 cursor-pointer font-mono text-xs transition-colors ${
                        isSelected
                          ? 'bg-zinc-800/90 text-white'
                          : 'hover:bg-zinc-900/40 text-zinc-300'
                      }`}
                    >
                      <TableCell className="py-1 flex items-center gap-2">
                        {isDir ? (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}
                        <span className={`truncate ${isDir ? 'font-medium text-zinc-100' : ''}`}>
                          {file.name}
                        </span>
                      </TableCell>
                      <TableCell className="py-1 text-right text-zinc-400 text-xs whitespace-nowrap font-mono">
                        {isDir ? '—' : formatSize(file.size)}
                      </TableCell>
                      <TableCell className="py-1 text-zinc-400 text-xs whitespace-nowrap truncate max-w-[100px]">
                        {getFileType(file.name, isDir)}
                      </TableCell>
                      <TableCell className="py-1 text-right text-zinc-400 text-xs whitespace-nowrap font-mono">
                        {file.modifiedAt ? formatDate(file.modifiedAt) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {/* Local Footer status */}
        <div className="h-6 border-t border-zinc-800/80 bg-zinc-950 px-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-500 shrink-0">
          <span>{localFiles.length} local items</span>
          {selectedLocal && (
            <span className="text-emerald-400 truncate max-w-[200px]">
              Selected: {selectedLocal} (Double-click to upload)
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const renderRemotePane = () => (
    <div className="flex-1 h-full w-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Remote Path Toolbar */}
      <div className="h-8 px-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] font-mono text-zinc-400 font-semibold shrink-0">Remote site:</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRemotePath(remotePathInput);
            }}
            className="flex-1 min-w-0"
          >
            <Input
              value={remotePathInput}
              onChange={(e) => setRemotePathInput(e.target.value)}
              className="h-6 text-[11px] font-mono bg-zinc-950 border-zinc-800 text-zinc-200 px-2 py-0 truncate"
            />
          </form>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goUpRemote}
            disabled={remotePath === '/'}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Go up one remote directory"
          >
            <ArrowUp className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRemotePath('.')}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Go to Home directory (~)"
          >
            <Home className="w-3 h-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <input
            ref={directUploadRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) {
                handleDirectUploadFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => directUploadRef.current?.click()}
            className="border-emerald-700/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-300 h-6 px-2 text-xs gap-1 font-sans"
            title="Upload files from your computer directly into this folder"
          >
            <Upload className="w-3 h-3" />
            <span>Upload</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleMkdirRemote}
            className="border-zinc-800 text-zinc-300 hover:text-white h-6 px-2 text-xs gap-1"
            title="Create Directory on Server"
          >
            <FolderPlus className="w-3 h-3" />
            <span>New Folder</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadRemoteFiles(remotePath)}
            className="text-zinc-400 hover:text-white h-6 px-1.5 text-xs gap-1"
            title="Refresh Remote Directory"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Remote File Table with Direct Drag & Drop */}
      <div
        onDragOver={handleDragOverRemote}
        onDragLeave={handleDragLeaveRemote}
        onDrop={handleDropOnRemote}
        className="relative flex-1 overflow-hidden flex flex-col"
      >
        {isDraggingOverRemote && (
          <div className="absolute inset-0 z-30 bg-emerald-950/80 border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center pointer-events-none backdrop-blur-xs animate-in fade-in">
            <Upload className="w-9 h-9 text-emerald-400 animate-bounce mb-2" />
            <p className="text-xs font-semibold text-emerald-100">Drop files to upload directly to server</p>
            <p className="text-[10px] text-emerald-300/80 font-mono">{remotePath}</p>
          </div>
        )}

        {loadingRemote ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 font-mono">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            <p className="text-xs">Reading remote directory listing...</p>
          </div>
        ) : remoteFiles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2">
            <HardDrive className="w-8 h-8 opacity-30 text-zinc-400" />
            <h3 className="text-xs font-semibold text-zinc-300">Empty directory</h3>
            <p className="text-[11px] text-zinc-500">Drag files from your PC or click Upload above to add files here.</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-zinc-900/90 sticky top-0 border-b border-zinc-800 select-none">
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs">Filename</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-20 whitespace-nowrap">Filesize</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs w-28 whitespace-nowrap">Filetype</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-36 whitespace-nowrap">Last modified</TableHead>
                  <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-20 whitespace-nowrap">Permissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remoteFiles.map((file) => {
                  const isSelected = selectedRemote === file.name;
                  const isDir = file.type === 'directory';

                  return (
                    <TableRow
                      key={file.name}
                      onClick={() => setSelectedRemote(isSelected ? null : file.name)}
                      onDoubleClick={() => navigateRemote(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedRemote(file.name);
                        setRemoteContextMenu({ x: e.clientX, y: e.clientY, item: file });
                      }}
                      className={`border-zinc-800/60 cursor-pointer font-mono text-xs transition-colors ${
                        isSelected
                          ? 'bg-zinc-800/90 text-white'
                          : 'hover:bg-zinc-900/40 text-zinc-300'
                      }`}
                    >
                      <TableCell className="py-1 flex items-center gap-2">
                        {isDir ? (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        )}

                        {renamingRemote === file.name ? (
                          <Input
                            value={newRemoteName}
                            onChange={(e) => setNewRemoteName(e.target.value)}
                            onBlur={handleRenameRemote}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameRemote();
                              if (e.key === 'Escape') setRenamingRemote(null);
                            }}
                            autoFocus
                            className="h-5 text-xs font-mono py-0 px-1 bg-zinc-900 border-zinc-700 text-white w-48"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className={`truncate ${isDir ? 'font-medium text-amber-300' : ''}`}>
                            {file.name}
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="py-1 text-right text-zinc-400 text-xs whitespace-nowrap font-mono">
                        {isDir ? '—' : formatSize(file.size)}
                      </TableCell>

                      <TableCell className="py-1 text-zinc-400 text-xs whitespace-nowrap truncate max-w-[100px]">
                        {getFileType(file.name, isDir)}
                      </TableCell>

                      <TableCell className="py-1 text-right text-zinc-400 text-xs whitespace-nowrap font-mono">
                        {file.modifiedAt ? formatDate(file.modifiedAt) : '—'}
                      </TableCell>

                      <TableCell className="py-1 text-right text-zinc-500 text-[11px] whitespace-nowrap font-mono">
                        {file.permissions
                          ? `${file.permissions.user?.read ? 'r' : '-'}${file.permissions.user?.write ? 'w' : '-'}${file.permissions.user?.exec ? 'x' : '-'}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}

        {/* Remote Footer status */}
        <div className="h-6 border-t border-zinc-800/80 bg-zinc-950 px-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-500 shrink-0">
          <span>
            {remoteFiles.length} objects ({remoteFiles.filter((f) => f.type === 'directory').length} dirs, {remoteFiles.filter((f) => f.type === 'file').length} files)
          </span>
          {selectedRemote && (
            <span className="text-sky-400 truncate max-w-[200px]">
              Selected: {selectedRemote} (Double-click to download)
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden bg-zinc-950 text-zinc-100 select-none relative font-sans"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (viewMode === 'remote') {
          handleDirectUploadFiles(e.dataTransfer.files);
        } else {
          handleLocalFilesPicked(e.dataTransfer.files);
        }
      }}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-zinc-950/90 border-2 border-dashed border-emerald-400 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className="text-center space-y-2">
            <Upload className="w-10 h-10 text-emerald-400 mx-auto animate-bounce" />
            <p className="text-sm font-semibold text-zinc-200">
              {viewMode === 'remote' ? `Drop files to upload directly to ${remotePath}` : 'Drop files to stage in Local site'}
            </p>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <div className="min-h-8 py-0.5 px-3 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between shrink-0 font-mono text-xs overflow-x-auto no-scrollbar gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 border-amber-500/30 text-amber-400 bg-amber-950/30 flex items-center gap-1 font-mono">
            <Folder className="w-2.5 h-2.5" />
            SFTP
          </Badge>
          <span className="text-zinc-300 font-medium">
            sftp://{tab.connection?.host || 'localhost'}:{tab.connection?.port || 22}
          </span>
        </div>

        {/* Transfer Action Controls in Header */}
        <div className="flex items-center gap-2">
          {viewMode === 'dual' && (
            <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleUploadLocalFile()}
                disabled={!selectedLocal}
                className={`h-5 px-2 text-[11px] gap-1 ${selectedLocal ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40' : 'text-zinc-600'}`}
                title="Upload selected staged file to server"
              >
                <ArrowRight className="w-3 h-3" />
                <span>Upload &rarr;</span>
              </Button>

              <Separator orientation="vertical" className="h-3 bg-zinc-800" />

              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDownloadFile()}
                disabled={!selectedRemote}
                className={`h-5 px-2 text-[11px] gap-1 ${selectedRemote ? 'text-sky-400 hover:text-sky-300 hover:bg-sky-950/40' : 'text-zinc-600'}`}
                title="Download selected remote file to local PC"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>&larr; Download</span>
              </Button>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={toggleViewMode}
            className="h-6 px-2 text-[11px] border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white gap-1 font-sans"
            title={viewMode === 'remote' ? 'Switch to Dual-Pane View (FileZilla style)' : 'Switch to Full Remote Explorer'}
          >
            {viewMode === 'remote' ? (
              <>
                <Columns className="w-3 h-3 text-amber-400" />
                <span>Dual-Pane</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3 h-3 text-amber-400" />
                <span>Full Remote</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenTerminal}
            className="h-6 px-2 text-[11px] border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 gap-1 font-mono"
            title="Open SSH Terminal for this host"
          >
            <Terminal className="w-3 h-3" />
            <span>Terminal</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLog(!showLog)}
            className="h-6 px-1.5 text-[10px] text-zinc-400 hover:text-white"
          >
            {showLog ? 'Hide Log' : 'Show Log'}
          </Button>
        </div>
      </div>

      {/* FileZilla Collapsible & Resizable Message Log Window */}
      {showLog && (
        <>
          <div
            ref={logContainerRef}
            style={{ height: `${logHeight}px` }}
            className="border-b border-zinc-800/80 bg-black p-2 font-mono text-[10px] overflow-y-auto shrink-0 select-text"
          >
            {logs.map((log, idx) => (
              <div
                key={idx}
                className={`leading-tight ${
                  log.startsWith('Command:')
                    ? 'text-cyan-400 font-semibold'
                    : log.startsWith('Status:')
                    ? 'text-zinc-400'
                    : 'text-rose-400'
                }`}
              >
                {log}
              </div>
            ))}
          </div>

          {/* Draggable Divider Handle for Message Log Height */}
          <div
            onMouseDown={handleMouseDownLog}
            className={`h-1.5 w-full cursor-row-resize hover:bg-zinc-600 transition-colors shrink-0 select-none flex items-center justify-center relative group z-10 ${
              isDraggingLog ? 'bg-zinc-500' : 'bg-zinc-900 border-b border-zinc-800/80'
            }`}
            title="Drag down or up to resize message log height"
          >
            <div className="w-8 h-0.5 rounded-full bg-zinc-700 group-hover:bg-zinc-400 transition-colors" />
          </div>
        </>
      )}

      {/* Main View: Full Remote Explorer (Default) or Resizable Dual-Pane */}
      <div className="flex-1 flex overflow-hidden">
        {viewMode === 'remote' ? (
          renderRemotePane()
        ) : (
          <ResizablePanelGroup direction="horizontal" className="flex-1 h-full w-full">
            <ResizablePanel defaultSize={48} minSize={25} className="flex flex-col bg-zinc-950 border-r border-zinc-800/60 overflow-hidden">
              {renderLocalPane()}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-zinc-800 hover:bg-zinc-600 transition-colors" />
            <ResizablePanel defaultSize={52} minSize={25} className="flex flex-col bg-zinc-950 overflow-hidden">
              {renderRemotePane()}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>


      {/* Local File Right-Click Context Menu */}
      {localContextMenu && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => setLocalContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setLocalContextMenu(null);
            }}
          />
          <div
            style={{ top: `${localContextMenu.y}px`, left: `${localContextMenu.x}px` }}
            className="fixed z-50 min-w-[180px] rounded-lg border border-zinc-800 bg-zinc-950/95 backdrop-blur-md p-1 shadow-2xl text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider truncate">
              {localContextMenu.item.name}
            </div>
            <button
              onClick={() => {
                const item = localContextMenu.item;
                setLocalContextMenu(null);
                handleUploadLocalFile(item);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload to Server
            </button>
            <div className="h-px bg-zinc-800/80 my-1" />
            <button
              onClick={() => {
                const target = localContextMenu.item.name;
                setLocalContextMenu(null);
                setLocalFiles((prev) => prev.filter((f) => f.name !== target));
                if (selectedLocal === target) setSelectedLocal(null);
                toast.success(`Removed ${target} from local list`);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-400 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove from list
            </button>
          </div>
        </>
      )}

      {/* Remote File Right-Click Context Menu */}
      {remoteContextMenu && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => setRemoteContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setRemoteContextMenu(null);
            }}
          />
          <div
            style={{ top: `${remoteContextMenu.y}px`, left: `${remoteContextMenu.x}px` }}
            className="fixed z-50 min-w-[190px] rounded-lg border border-zinc-800 bg-zinc-950/95 backdrop-blur-md p-1 shadow-2xl text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider truncate">
              {remoteContextMenu.item.name}
            </div>

            {remoteContextMenu.item.type === 'file' && (
              <button
                onClick={() => {
                  const name = remoteContextMenu.item.name;
                  setRemoteContextMenu(null);
                  handleDownloadFile(name);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-sky-400 hover:bg-sky-950/40 hover:text-sky-300 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download to PC
              </button>
            )}

            <button
              onClick={() => {
                const name = remoteContextMenu.item.name;
                setRemoteContextMenu(null);
                setRenamingRemote(name);
                setNewRemoteName(name);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Rename
            </button>

            <button
              onClick={() => {
                const name = remoteContextMenu.item.name;
                setRemoteContextMenu(null);
                const fullPath = `${remotePath === '/' ? '' : remotePath}/${name}`;
                navigator.clipboard.writeText(fullPath);
                toast.success('Path copied to clipboard');
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Remote Path
            </button>

            <div className="h-px bg-zinc-800/80 my-1" />

            <button
              onClick={() => {
                const name = remoteContextMenu.item.name;
                setRemoteContextMenu(null);
                handleDeleteRemote(name);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete from Server
            </button>
          </div>
        </>
      )}

      {/* FileZilla Bottom Transfer Queue / Status Strip */}
      <div className="h-6 border-t border-zinc-800 bg-zinc-950 px-3 flex items-center justify-between text-[11px] font-mono text-zinc-500 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span className="hover:text-zinc-300 cursor-pointer">Queued files (0)</span>
          <Separator orientation="vertical" className="h-3 bg-zinc-800" />
          <span
            onClick={() => setShowTransferDrawer(!showTransferDrawer)}
            className="hover:text-emerald-300 cursor-pointer text-emerald-400 flex items-center gap-1"
            title="Click to view transfer history"
          >
            Successful transfers ({transfers.filter((t) => t.status === 'success').length})
          </span>
          <Separator orientation="vertical" className="h-3 bg-zinc-800" />
          <span
            onClick={() => setShowTransferDrawer(!showTransferDrawer)}
            className="hover:text-rose-300 cursor-pointer text-rose-400"
            title="Click to view transfer history"
          >
            Failed transfers ({transfers.filter((t) => t.status === 'failed').length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span>FileZilla Dual-Pane Mode</span>
        </div>
      </div>

      {/* Transfer History Drawer */}
      {showTransferDrawer && (
        <div className="h-32 border-t border-zinc-800 bg-zinc-950 p-2 font-mono text-xs overflow-y-auto shrink-0 select-text">
          <div className="flex items-center justify-between pb-1 mb-1 border-b border-zinc-800 text-[10px] text-zinc-400">
            <span>Transfer History</span>
            <button onClick={() => setShowTransferDrawer(false)} className="hover:text-white">Close &times;</button>
          </div>
          {transfers.length === 0 ? (
            <div className="text-zinc-600 text-center py-4">No recent transfers.</div>
          ) : (
            <div className="space-y-1">
              {transfers.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] h-4 px-1 ${t.direction === 'upload' ? 'text-emerald-400 border-emerald-500/30' : 'text-sky-400 border-sky-500/30'}`}>
                      {t.direction === 'upload' ? 'Upload &rarr;' : '&larr; Download'}
                    </Badge>
                    <span className="font-semibold">{t.name}</span>
                    <span className="text-zinc-500">({formatSize(t.size)})</span>
                  </div>
                  <div className="flex items-center gap-3 text-zinc-500 text-[10px]">
                    <span className={t.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}>{t.status}</span>
                    <span>{t.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
