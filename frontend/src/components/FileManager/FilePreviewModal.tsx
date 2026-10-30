import { useState, useEffect, useMemo } from 'react';
import {
  X, Eye, Download, Copy, Check, Table as TableIcon, Code,
  FileText, Search, Loader2, AlertCircle, ArrowLeft,
  FolderArchive, File, Folder
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/utils/api';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string;
  filePath: string;
  fileName: string;
  isLocal?: boolean;
}

interface ArchiveEntry {
  name: string;
  size: number;
  mtime: number;
  type: 'file' | 'directory';
  previewSnippet?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function parseDelimitedText(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const firstLine = lines[0];
  const delim = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  function parseRow(line: string): string[] {
    const result: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === delim && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
}

function getLanguageForFile(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'json': return 'json';
    case 'sql': return 'sql';
    case 'sh': case 'bash': case 'zsh': return 'shell';
    case 'yaml': case 'yml': return 'yaml';
    case 'xml': case 'html': return 'html';
    case 'js': case 'jsx': case 'mjs': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'py': return 'python';
    case 'css': return 'css';
    case 'md': return 'markdown';
    case 'csv': case 'tsv': return 'plaintext';
    default: return 'plaintext';
  }
}

export function FilePreviewModal({ isOpen, onClose, connectionId, filePath, fileName, isLocal }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Content states
  const [content, setContent] = useState<string>('');
  const [fileDetails, setFileDetails] = useState<{
    size: number;
    totalSize: number;
    isTruncated: boolean;
    isCompressed?: boolean;
    isArchiveEntry?: boolean;
  } | null>(null);

  // Archive inspection states
  const isArchive = fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz') || fileName.endsWith('.tar');
  const [archiveEntries, setArchiveEntries] = useState<ArchiveEntry[]>([]);
  const [viewingArchiveEntry, setViewingArchiveEntry] = useState<string | null>(null);

  // View Mode: 'table' (CSV grid) vs 'code' (Monaco / Raw text)
  const isCsv = fileName.toLowerCase().endsWith('.csv') || fileName.toLowerCase().endsWith('.tsv') ||
    (viewingArchiveEntry && (viewingArchiveEntry.endsWith('.csv') || viewingArchiveEntry.endsWith('.tsv')));
  const [viewMode, setViewMode] = useState<'table' | 'code'>(isCsv ? 'table' : 'code');

  // Filter / Search inside table or archive
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setViewingArchiveEntry(null);
      setContent('');
      setArchiveEntries([]);
      setError(null);
      return;
    }

    if (isArchive && !viewingArchiveEntry) {
      loadArchiveList();
    } else {
      loadFilePreview(viewingArchiveEntry || undefined);
    }
  }, [isOpen, filePath, viewingArchiveEntry]);

  async function loadArchiveList() {
    setLoading(true);
    setError(null);
    try {
      if (!connectionId) throw new Error('Remote archive inspection requires active connection');
      const res = await api.sftp.archiveList(connectionId, filePath);
      setArchiveEntries(res.entries || []);
      setFileDetails({
        size: res.totalSize,
        totalSize: res.totalSize,
        isTruncated: false,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to inspect archive');
      toast.error(`Archive error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadFilePreview(entry?: string) {
    setLoading(true);
    setError(null);
    try {
      if (isLocal) {
        const res = await api.sftp.localPreview(filePath);
        setContent(res.content);
        setFileDetails({
          size: res.size,
          totalSize: res.totalSize,
          isTruncated: res.isTruncated,
          isCompressed: res.isCompressed,
          isArchiveEntry: false,
        });
      } else {
        const res = await api.sftp.preview(connectionId!, filePath, entry);
        setContent(res.content);
        setFileDetails({
          size: res.size,
          totalSize: res.totalSize,
          isTruncated: res.isTruncated,
          isCompressed: res.isCompressed,
          isArchiveEntry: res.isArchiveEntry,
        });
      }
      if (entry && (entry.endsWith('.csv') || entry.endsWith('.tsv'))) {
        setViewMode('table');
      } else if (!isCsv) {
        setViewMode('code');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load preview');
      toast.error(`Preview error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Parsed CSV table
  const parsedData = useMemo(() => {
    if (!isCsv || !content) return null;
    return parseDelimitedText(content);
  }, [isCsv, content]);

  // Filtered CSV rows
  const filteredRows = useMemo(() => {
    if (!parsedData) return [];
    if (!search.trim()) return parsedData.rows;
    const q = search.toLowerCase();
    return parsedData.rows.filter((row) =>
      row.some((cell) => cell.toLowerCase().includes(q))
    );
  }, [parsedData, search]);

  // Filtered Archive Entries
  const filteredArchiveEntries = useMemo(() => {
    if (!archiveEntries) return [];
    if (!search.trim()) return archiveEntries;
    const q = search.toLowerCase();
    return archiveEntries.filter((e) => e.name.toLowerCase().includes(q));
  }, [archiveEntries, search]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    toast.success('Content copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (isLocal) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Saved ${fileName}`);
      return;
    }
    const downloadUrl = api.sftp.download(connectionId!, filePath);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Downloading ${fileName}...`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-5xl h-[85vh] bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl flex flex-col overflow-hidden font-sans text-xs">
        {/* Header Bar */}
        <div className="h-10 px-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {viewingArchiveEntry ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewingArchiveEntry(null)}
                className="h-6 px-1.5 text-zinc-400 hover:text-white gap-1 text-[11px]"
                title="Back to archive file list"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Archive</span>
              </Button>
            ) : isArchive ? (
              <FolderArchive className="w-4 h-4 text-amber-400 shrink-0" />
            ) : isCsv ? (
              <TableIcon className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <FileText className="w-4 h-4 text-sky-400 shrink-0" />
            )}

            <span className="font-semibold text-zinc-100 truncate max-w-sm">
              {viewingArchiveEntry || fileName}
            </span>

            {fileDetails && (
              <Badge
                variant="outline"
                className="text-[10px] py-0 px-1.5 h-4 border-zinc-700 bg-zinc-900 text-zinc-400 font-mono"
              >
                {formatBytes(fileDetails.size)}
                {fileDetails.totalSize > fileDetails.size && ` / ${formatBytes(fileDetails.totalSize)}`}
              </Badge>
            )}

            {fileDetails?.isTruncated && (
              <Badge
                variant="outline"
                className="text-[9.5px] py-0 px-1.5 h-4 border-amber-500/40 bg-amber-950/40 text-amber-400 font-sans"
              >
                Preview limit reached (first {formatBytes(fileDetails.size)})
              </Badge>
            )}

            {fileDetails?.isCompressed && (
              <Badge
                variant="outline"
                className="text-[9.5px] py-0 px-1.5 h-4 border-sky-500/40 bg-sky-950/40 text-sky-400 font-sans"
              >
                Decompressed live (gzip)
              </Badge>
            )}
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* CSV View Switcher */}
            {isCsv && !viewingArchiveEntry && !isArchive && (
              <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setViewMode('table')}
                  className={`h-5 px-2 text-[10px] gap-1 ${
                    viewMode === 'table'
                      ? 'bg-zinc-800 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <TableIcon className="w-3 h-3 text-emerald-400" />
                  <span>Grid</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setViewMode('code')}
                  className={`h-5 px-2 text-[10px] gap-1 ${
                    viewMode === 'code'
                      ? 'bg-zinc-800 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Code className="w-3 h-3 text-sky-400" />
                  <span>Raw</span>
                </Button>
              </div>
            )}

            {content && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-6 px-2 text-[10px] border-zinc-800 text-zinc-300 hover:text-white gap-1"
                title="Copy content to clipboard"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="h-6 px-2 text-[10px] border-zinc-800 text-zinc-300 hover:text-white gap-1"
              title="Download full file to PC"
            >
              <Download className="w-3 h-3 text-emerald-400" />
              <span>Download</span>
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="h-6 w-6 text-zinc-400 hover:text-white"
              title="Close Preview (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Search / Filter Subheader */}
        {(parsedData || (isArchive && !viewingArchiveEntry)) && (
          <div className="h-8 px-3 bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <div className="relative w-64">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isArchive && !viewingArchiveEntry
                    ? 'Search archive entries...'
                    : 'Search table rows...'
                }
                className="h-6 text-[11px] pl-6 bg-zinc-950 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500"
              />
            </div>

            <div className="text-[10px] font-mono text-zinc-500">
              {isArchive && !viewingArchiveEntry ? (
                <span>
                  {filteredArchiveEntries.length} of {archiveEntries.length} archive entries
                </span>
              ) : parsedData ? (
                <span>
                  Showing {filteredRows.length} of {parsedData.rows.length} rows &middot;{' '}
                  {parsedData.headers.length} columns
                </span>
              ) : null}
            </div>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-hidden relative flex flex-col bg-zinc-950">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 font-mono">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
              <p className="text-xs">Reading remote file stream...</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-rose-400 space-y-2">
              <AlertCircle className="w-8 h-8 opacity-80" />
              <h3 className="text-xs font-semibold text-rose-300">Unable to preview file</h3>
              <p className="text-[11px] text-zinc-400 max-w-md">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="border-zinc-800 text-zinc-300 hover:text-white mt-2 gap-1 text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download file instead</span>
              </Button>
            </div>
          ) : isArchive && !viewingArchiveEntry ? (
            /* Archive Entry List View */
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader className="bg-zinc-900/90 sticky top-0 border-b border-zinc-800 select-none">
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-400 font-semibold h-7 text-xs">File in Archive</TableHead>
                    <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-24 whitespace-nowrap">Size</TableHead>
                    <TableHead className="text-zinc-400 font-semibold h-7 text-xs text-right w-32 whitespace-nowrap">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredArchiveEntries.map((entry) => {
                    const isDir = entry.type === 'directory';
                    const canPreview =
                      !isDir &&
                      (entry.name.endsWith('.csv') ||
                        entry.name.endsWith('.tsv') ||
                        entry.name.endsWith('.txt') ||
                        entry.name.endsWith('.log') ||
                        entry.name.endsWith('.json') ||
                        entry.name.endsWith('.sql') ||
                        entry.name.endsWith('.sh') ||
                        entry.name.endsWith('.yaml') ||
                        entry.name.endsWith('.yml') ||
                        entry.name.endsWith('.conf') ||
                        entry.name.endsWith('.env'));

                    return (
                      <TableRow
                        key={entry.name}
                        className="border-zinc-800/60 font-mono text-xs hover:bg-zinc-900/40 transition-colors"
                      >
                        <TableCell className="py-1.5 flex items-center gap-2">
                          {isDir ? (
                            <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          )}
                          <span className={`truncate ${isDir ? 'font-medium text-amber-300' : 'text-zinc-200'}`}>
                            {entry.name}
                          </span>
                        </TableCell>

                        <TableCell className="py-1.5 text-right text-zinc-400 text-xs whitespace-nowrap font-mono">
                          {isDir ? '—' : formatBytes(entry.size)}
                        </TableCell>

                        <TableCell className="py-1.5 text-right">
                          {canPreview && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setViewingArchiveEntry(entry.name)}
                              className="h-5 px-2 text-[10.5px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 gap-1 font-sans"
                            >
                              <Eye className="w-3 h-3" />
                              <span>View Live</span>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : isCsv && viewMode === 'table' && parsedData ? (
            /* CSV Grid View */
            <ScrollArea className="flex-1">
              <Table>
                <TableHeader className="bg-zinc-900/90 sticky top-0 border-b border-zinc-800 select-none z-10">
                  <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-500 font-mono h-7 text-[10px] w-12 text-center">#</TableHead>
                    {parsedData.headers.map((h, idx) => (
                      <TableHead key={idx} className="text-zinc-300 font-semibold h-7 text-xs whitespace-nowrap">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row, rowIdx) => (
                    <TableRow
                      key={rowIdx}
                      className="border-zinc-800/50 hover:bg-zinc-900/40 font-mono text-xs transition-colors"
                    >
                      <TableCell className="py-1 text-center text-zinc-600 text-[10px] font-mono select-none">
                        {rowIdx + 1}
                      </TableCell>
                      {row.map((cell, colIdx) => (
                        <TableCell key={colIdx} className="py-1 text-zinc-300 whitespace-nowrap max-w-xs truncate">
                          {cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            /* Monaco Code / Raw Text View */
            <Editor
              height="100%"
              theme="vs-dark"
              language={getLanguageForFile(viewingArchiveEntry || fileName)}
              value={content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 11.5,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                renderWhitespace: 'selection',
                automaticLayout: true,
              }}
            />
          )}
        </div>

        {/* Footer Status Bar */}
        <div className="h-6 px-3 bg-zinc-900/90 border-t border-zinc-800 flex items-center justify-between font-mono text-[10.5px] text-zinc-500 shrink-0 select-none">
          <div className="truncate max-w-xl">
            {filePath} {viewingArchiveEntry ? `> ${viewingArchiveEntry}` : ''}
          </div>
          <div>
            {fileDetails?.isTruncated
              ? 'Preview truncated to preserve performance'
              : 'Complete content loaded'}
          </div>
        </div>
      </div>
    </div>
  );
}
