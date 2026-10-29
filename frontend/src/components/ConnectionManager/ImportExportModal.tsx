import { useState, useRef, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Upload, Download, FileCode, CheckCircle2,
  FileSpreadsheet, Database, Terminal, FolderOpen, Loader2, AlertTriangle
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { api } from '@/utils/api';
import toast from 'react-hot-toast';
import { parseConnectionFile, ParsedConnection } from '@/utils/importer';
import {
  exportToTerminalSqlJson,
  exportToDBeaverJson,
  exportToMobaXtermSessions,
  exportToCsv,
} from '@/utils/exporter';
import { getDatabaseBrandIcon } from '@/components/common/DatabaseBrandIcons';

interface Props {
  onClose: () => void;
  defaultTab?: 'import' | 'export';
}

export function ImportExportModal({ onClose, defaultTab = 'import' }: Props) {
  const { connections, setConnections } = useAppStore();
  const [activeTab, setActiveTab] = useState<'import' | 'export'>(defaultTab);
  const [parsed, setParsed] = useState<ParsedConnection[]>([]);
  const [detectedTool, setDetectedTool] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [duplicateAction, setDuplicateAction] = useState<'replace' | 'keep_both' | 'skip'>('replace');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect duplicate connections against current user connections
  const duplicateIndices = useMemo(() => {
    const set = new Set<number>();
    parsed.forEach((item, idx) => {
      const match = connections.some(
        (c) => c.type === item.type && c.name.trim().toLowerCase() === item.name.trim().toLowerCase()
      );
      if (match) set.add(idx);
    });
    return set;
  }, [parsed, connections]);

  const duplicateCount = duplicateIndices.size;

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = parseConnectionFile(content, file.name);

      if (result.errors.length > 0 && result.connections.length === 0) {
        toast.error(result.errors[0]);
        return;
      }

      setDetectedTool(result.detectedTool);
      setParsed(result.connections);
      // Select all by default
      setSelectedIndices(new Set(result.connections.map((_, i) => i)));
      toast.success(`Detected ${result.connections.length} connections from ${result.detectedTool}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function toggleSelectAll() {
    if (selectedIndices.size === parsed.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(parsed.map((_, i) => i)));
    }
  }

  function toggleIndex(idx: number) {
    const next = new Set(selectedIndices);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelectedIndices(next);
  }

  async function handleConfirmImport() {
    const toImport = parsed.filter((_, i) => selectedIndices.has(i));
    if (toImport.length === 0) {
      toast.error('Select at least one connection to import');
      return;
    }

    setImporting(true);
    try {
      const res = await api.connections.importBulk(toImport, duplicateAction);
      let msg = `Successfully imported ${res.count} connection(s)`;
      if (res.updatedCount > 0 && res.insertedCount > 0) {
        msg = `Imported ${res.insertedCount} new, updated ${res.updatedCount} existing`;
      } else if (res.updatedCount > 0) {
        msg = `Replaced ${res.updatedCount} existing connection(s)`;
      } else if (res.skippedCount > 0) {
        msg = `Imported ${res.insertedCount} connection(s) (${res.skippedCount} duplicates skipped)`;
      }
      toast.success(msg);

      // Refresh connection list in store
      const { connections: updated } = await api.connections.list();
      setConnections(updated);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to import connections');
    } finally {
      setImporting(false);
    }
  }

  async function handleExportTerminalSql(includeCreds: boolean) {
    setExporting(true);
    try {
      const res = await api.connections.export(includeCreds);
      exportToTerminalSqlJson(res.connections);
      toast.success(`Exported ${res.connections.length} connections`);
    } catch (err: any) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportDBeaver() {
    setExporting(true);
    try {
      const res = await api.connections.export(true);
      const dbs = res.connections.filter((c) => c.type === 'database');
      if (dbs.length === 0) {
        toast.error('No database connections found to export');
        return;
      }
      exportToDBeaverJson(res.connections);
      toast.success(`Exported ${dbs.length} database connections for DBeaver`);
    } catch (err: any) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportMobaXterm() {
    setExporting(true);
    try {
      const res = await api.connections.export(false);
      const sshConns = res.connections.filter((c) => c.type === 'ssh' || c.type === 'sftp');
      if (sshConns.length === 0) {
        toast.error('No SSH/SFTP connections found to export');
        return;
      }
      exportToMobaXtermSessions(res.connections);
      toast.success(`Exported ${sshConns.length} sessions for MobaXterm`);
    } catch (err: any) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  }

  async function handleExportCsv() {
    setExporting(true);
    try {
      const res = await api.connections.export(false);
      exportToCsv(res.connections);
      toast.success(`Exported ${res.connections.length} connections to CSV`);
    } catch (err: any) {
      toast.error('Export failed: ' + err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] bg-zinc-900 border-zinc-800 text-zinc-100 max-h-[92vh] overflow-hidden flex flex-col rounded-xl p-4">
        <DialogHeader className="pb-1 space-y-1 shrink-0 pr-8">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-sm font-semibold">
              Import / Export Connections
            </DialogTitle>
            <Badge variant="outline" className="text-[10px] font-mono font-normal border-zinc-800 bg-zinc-950 text-zinc-400 h-4 px-1.5">
              {connections.length} saved
            </Badge>
          </div>
          <DialogDescription className="text-zinc-400 text-[11px]">
            Migrate sessions seamlessly with DBeaver, MobaXterm, FileZilla, SecureCRT, and Termius.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid grid-cols-2 bg-zinc-950 border border-zinc-800 h-8 p-0.5 shrink-0 mb-3">
            <TabsTrigger value="import" className="text-xs h-7 data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              Import Connections
            </TabsTrigger>
            <TabsTrigger value="export" className="text-xs h-7 data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-sky-400" />
              Export Connections
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: IMPORT */}
          <TabsContent value="import" className="flex-1 flex flex-col overflow-hidden m-0 space-y-3">
            {parsed.length === 0 ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-zinc-800 hover:border-zinc-700 bg-zinc-950/60 hover:bg-zinc-950 rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 select-none group"
              >
                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-emerald-400 transition-colors mb-2">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-xs font-semibold text-zinc-200">
                  Drop your connection file or click to browse
                </p>
                <p className="text-[11px] text-zinc-500 mt-1 max-w-sm">
                  Supports <strong className="text-zinc-300">DBeaver</strong> (data-sources.json), <strong className="text-zinc-300">MobaXterm</strong> (.mxtsessions), <strong className="text-zinc-300">FileZilla</strong> (sitemanager.xml), <strong className="text-zinc-300">SecureCRT</strong>, <strong className="text-zinc-300">Termius</strong>, and TerminalSQL backup.
                </p>
                <Button size="sm" variant="outline" className="mt-3.5 h-7 px-3 text-xs border-zinc-800 text-zinc-300 hover:text-white">
                  Browse File
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.xml,.mxtsessions,.ini,.csv,.txt"
                  hidden
                  onChange={handleFileSelected}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden space-y-2">
                <div className="flex items-center justify-between text-xs shrink-0 bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-5 border-emerald-500/40 text-emerald-400 bg-emerald-950/40 font-mono">
                      {detectedTool}
                    </Badge>
                    <span className="text-[11px] text-zinc-400">
                      {selectedIndices.size} of {parsed.length} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleSelectAll}
                      className="h-6 px-2 text-[11px] text-zinc-400 hover:text-white"
                    >
                      {selectedIndices.size === parsed.length ? 'Deselect All' : 'Select All'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setParsed([]);
                        setDetectedTool(null);
                      }}
                      className="h-6 px-2 text-[11px] text-zinc-500 hover:text-rose-400"
                    >
                      Reset
                    </Button>
                  </div>
                </div>

                {/* Preview Table */}
                <ScrollArea className="flex-1 border border-zinc-800 rounded-lg bg-zinc-950">
                  <div className="divide-y divide-zinc-800/80 font-mono text-xs">
                    {parsed.map((item, idx) => {
                      const isChecked = selectedIndices.has(idx);
                      const isDuplicate = duplicateIndices.has(idx);
                      const Icon = item.type === 'ssh' ? Terminal : item.type === 'database' ? Database : FolderOpen;
                      const iconColor = item.type === 'ssh' ? 'text-emerald-400' : item.type === 'database' ? 'text-purple-400' : 'text-amber-400';

                      return (
                        <div
                          key={idx}
                          onClick={() => toggleIndex(idx)}
                          className={`px-3 py-2 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                            isChecked ? 'bg-zinc-900/60 text-zinc-100' : 'opacity-50 text-zinc-400 hover:opacity-80'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleIndex(idx)}
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              className="h-3.5 w-3.5 rounded border border-zinc-700 bg-zinc-950 accent-white cursor-pointer"
                            />
                            {item.type === 'database' ? (
                              getDatabaseBrandIcon(item, item.credentials?.dbType, 'w-3.5 h-3.5 shrink-0')
                            ) : (
                              <Icon className={`w-3.5 h-3.5 ${iconColor} shrink-0`} />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="font-semibold text-xs truncate">{item.name}</span>
                                {item.folder && (
                                  <span className="text-[10px] text-zinc-400 bg-zinc-900 px-1.5 py-0.2 rounded border border-zinc-800 font-normal shrink-0">
                                    📁 {item.folder}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-zinc-500 truncate font-mono">
                                {item.username ? `${item.username}@` : ''}{item.host}:{item.port}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isDuplicate && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] h-4 px-1 uppercase tracking-wider font-mono ${
                                  duplicateAction === 'replace'
                                    ? 'border-amber-500/40 text-amber-400 bg-amber-950/30'
                                    : duplicateAction === 'skip'
                                    ? 'border-zinc-700 text-zinc-500 bg-zinc-900/50 line-through'
                                    : 'border-sky-500/40 text-sky-400 bg-sky-950/30'
                                }`}
                              >
                                {duplicateAction === 'replace' ? 'Will Replace' : duplicateAction === 'skip' ? 'Skip' : 'Duplicate'}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-[9px] h-4 px-1 uppercase tracking-wider shrink-0 border-zinc-800 text-zinc-400">
                              {item.type}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Duplicate Action Bar if duplicates exist */}
                {duplicateCount > 0 && (
                  <div className="bg-zinc-900/90 border border-zinc-800 rounded-md px-3 py-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0 text-xs">
                    <div className="flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-[11px] font-medium">{duplicateCount} connection(s) already exist on server</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-zinc-400 mr-1 uppercase tracking-wider font-mono">Action:</span>
                      <button
                        type="button"
                        onClick={() => setDuplicateAction('replace')}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                          duplicateAction === 'replace'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                            : 'text-zinc-400 hover:text-white bg-zinc-950/50 border border-transparent'
                        }`}
                        title="Update host, port, credentials, and folder of existing connection"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuplicateAction('keep_both')}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                          duplicateAction === 'keep_both'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/50'
                            : 'text-zinc-400 hover:text-white bg-zinc-950/50 border border-transparent'
                        }`}
                        title="Create a duplicate connection alongside the existing one"
                      >
                        Keep Both
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuplicateAction('skip')}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                          duplicateAction === 'skip'
                            ? 'bg-zinc-800 text-zinc-200 border border-zinc-700'
                            : 'text-zinc-400 hover:text-white bg-zinc-950/50 border border-transparent'
                        }`}
                        title="Do not import connections that already exist"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 text-xs border-zinc-800 text-zinc-400 hover:text-white"
                  >
                    Upload Another File
                  </Button>
                  <Button
                    size="sm"
                    disabled={importing || selectedIndices.size === 0}
                    onClick={handleConfirmImport}
                    className="h-8 text-xs bg-white text-zinc-950 hover:bg-zinc-200 font-medium px-4 shadow-sm"
                  >
                    {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />}
                    Import {selectedIndices.size} Connections
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.xml,.mxtsessions,.ini,.csv,.txt"
                    hidden
                    onChange={handleFileSelected}
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* TAB 2: EXPORT */}
          <TabsContent value="export" className="flex-1 flex flex-col overflow-y-auto m-0 space-y-2.5">
            <div className="text-xs text-zinc-400 pb-1">
              Export your connections in various compatible formats for your preferred tools:
            </div>

            <div className="grid grid-cols-1 gap-2">
              {/* Option 1: TerminalSQL Backup */}
              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 shrink-0">
                    <FileCode className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-200">TerminalSQL Backup (JSON)</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      Complete backup of all SSH, Database, and SFTP connections.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={exporting}
                    onClick={() => handleExportTerminalSql(true)}
                    className="h-7 px-2.5 text-xs border-zinc-800 text-zinc-300 hover:text-white"
                    title="Export including passwords"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Full (.json)
                  </Button>
                </div>
              </div>

              {/* Option 2: DBeaver data-sources.json */}
              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-purple-400 shrink-0">
                    <Database className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-200">DBeaver (data-sources.json)</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      Export all databases into DBeaver data-sources format for direct import.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={handleExportDBeaver}
                  className="h-7 px-2.5 text-xs border-zinc-800 text-zinc-300 hover:text-white shrink-0"
                >
                  <Download className="w-3 h-3 mr-1 text-purple-400" />
                  Export DBeaver
                </Button>
              </div>

              {/* Option 3: MobaXterm .mxtsessions */}
              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 shrink-0">
                    <Terminal className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-200">MobaXterm Sessions (.mxtsessions)</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      Export SSH & SFTP sessions compatible with MobaXterm Bookmarks.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={handleExportMobaXterm}
                  className="h-7 px-2.5 text-xs border-zinc-800 text-zinc-300 hover:text-white shrink-0"
                >
                  <Download className="w-3 h-3 mr-1 text-amber-400" />
                  Export MobaXterm
                </Button>
              </div>

              {/* Option 4: Universal CSV */}
              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/80 hover:border-zinc-700 transition-colors flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-sky-400 shrink-0">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-zinc-200">Universal CSV Spreadsheet</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      Table format compatible with Termius, SecureCRT, and Excel.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={exporting}
                  onClick={handleExportCsv}
                  className="h-7 px-2.5 text-xs border-zinc-800 text-zinc-300 hover:text-white shrink-0"
                >
                  <Download className="w-3 h-3 mr-1 text-sky-400" />
                  Export CSV
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
