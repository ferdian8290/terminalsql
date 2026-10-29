import { useState, useEffect, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Play, Download, RefreshCw, Loader2, CheckCircle2, AlertCircle, Search,
  Lock, Unlock, Code2, ArrowUpDown, ChevronDown, Check, Copy, Square,
  Bookmark, Trash2, Plus, X
} from 'lucide-react';
import { getDatabaseBrandIcon } from '@/components/common/DatabaseBrandIcons';
import { api } from '@/utils/api';
import { useAppStore, type Tab } from '@/store/appStore';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

interface Props {
  tab: Tab;
}

interface QueryResult {
  rows: Record<string, any>[];
  fields: string[];
  rowCount: number;
  totalRows?: number;
  durationMs: number;
  truncated: boolean;
}

interface ExportOptions {
  delimiter?: string;
  quoteChar?: string;
  includeHeaders?: boolean;
  onlyFiltered?: boolean;
  customFileName?: string;
  splitSize?: number;
}

function generateExportString(
  fields: string[],
  rows: Record<string, any>[],
  options: ExportOptions = {}
) {
  const delimiter = options.delimiter ?? ';';
  const quote = options.quoteChar ?? '"';
  const includeHeaders = options.includeHeaders ?? true;

  const escapeVal = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (!quote) return s;
    if (s.includes(delimiter) || s.includes(quote) || s.includes('\n') || s.includes('\r')) {
      return `${quote}${s.split(quote).join(quote + quote)}${quote}`;
    }
    return s;
  };

  const lines: string[] = [];
  if (includeHeaders) {
    lines.push(fields.map(escapeVal).join(delimiter));
  }
  for (const r of rows) {
    lines.push(fields.map((f) => escapeVal(r[f])).join(delimiter));
  }
  return lines.join('\r\n');
}

export interface StatementRange {
  text: string;
  start: number;
  end: number;
}

export function splitSqlStatements(sql: string): StatementRange[] {
  const statements: StatementRange[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let currentStart = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1] || '';

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && sql[i - 1] !== '\\') {
        if (next === "'") {
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && sql[i - 1] !== '\\') {
        inDoubleQuote = false;
      }
      continue;
    }
    if (inBacktick) {
      if (char === '`' && sql[i - 1] !== '\\') {
        inBacktick = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === "'") { inSingleQuote = true; continue; }
    if (char === '"') { inDoubleQuote = true; continue; }
    if (char === '`') { inBacktick = true; continue; }

    // Semicolon delimiter
    if (char === ';') {
      const raw = sql.substring(currentStart, i + 1);
      if (raw.trim()) {
        statements.push({
          text: raw.trim(),
          start: currentStart,
          end: i + 1,
        });
      }
      currentStart = i + 1;
      continue;
    }

    // Blank line delimiter (2 or more consecutive newlines with only whitespace)
    if (char === '\n') {
      let j = i + 1;
      while (j < sql.length && (sql[j] === ' ' || sql[j] === '\t' || sql[j] === '\r')) j++;
      if (j < sql.length && sql[j] === '\n') {
        const raw = sql.substring(currentStart, i);
        if (raw.trim()) {
          statements.push({
            text: raw.trim(),
            start: currentStart,
            end: i,
          });
        }
        currentStart = j + 1;
        i = j;
      }
    }
  }

  if (currentStart < sql.length) {
    const raw = sql.substring(currentStart);
    if (raw.trim()) {
      statements.push({
        text: raw.trim(),
        start: currentStart,
        end: sql.length,
      });
    }
  }

  return statements;
}

export function isExecutableSql(sql: string): boolean {
  if (!sql || !sql.trim()) return false;
  const stripped = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .replace(/^\(+/, '');
  return /^(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|SHOW|DESCRIBE|DESC|EXPLAIN|SET|USE|OPTIMIZE|TRUNCATE|CALL|EXEC|MERGE|GRANT|REVOKE|SYSTEM|KILL|CHECK|ATTACH|DETACH|PRAGMA)\b/i.test(stripped);
}

export function extractStatementAtCursor(sql: string, cursorOffset: number): string {
  if (!sql.trim()) return '';

  const statements = splitSqlStatements(sql);
  if (statements.length === 0) return sql.trim();

  const clean = (t: string) => t.replace(/;+\s*$/, '').trim();

  // 1. Find statement directly enclosing the cursor
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    if (cursorOffset >= s.start && cursorOffset <= s.end) {
      if (isExecutableSql(s.text)) {
        return clean(s.text);
      }
      // If cursor is on a non-SQL statement (e.g. table name or stray text),
      // look forward for the nearest executable statement
      for (let j = i + 1; j < statements.length; j++) {
        if (isExecutableSql(statements[j].text)) return clean(statements[j].text);
      }
      // Or look backward
      for (let j = i - 1; j >= 0; j--) {
        if (isExecutableSql(statements[j].text)) return clean(statements[j].text);
      }
      return clean(s.text);
    }
  }

  // 2. If cursor is on empty lines between statements, find nearest executable statement
  let nearest: StatementRange | null = null;
  let minDistance = Infinity;
  for (const s of statements) {
    if (!isExecutableSql(s.text)) continue;
    const dist = Math.min(Math.abs(cursorOffset - s.start), Math.abs(cursorOffset - s.end));
    if (dist < minDistance) {
      minDistance = dist;
      nearest = s;
    }
  }

  if (nearest) return clean(nearest.text);

  // 3. Fallback to first valid executable statement
  const firstValid = statements.find((s) => isExecutableSql(s.text));
  return clean(firstValid ? firstValid.text : statements[0].text);
}

export function detectSqlParameters(sql: string): string[] {
  // Strip comments and string literals
  const stripped = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const params = new Set<string>();

  // Match ${param}
  for (const m of stripped.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)) {
    if (m[1]) params.add(m[1]);
  }

  // Match :param (ignore PostgreSQL ::type cast by ensuring no preceding or trailing colon)
  for (const m of stripped.matchAll(/(?<![:\w]):([a-zA-Z_][a-zA-Z0-9_]*)(?!:)/g)) {
    if (m[1]) params.add(m[1]);
  }

  return Array.from(params);
}

export function substituteParameters(sql: string, params: Record<string, string>): string {
  let result = sql;
  for (const [key, rawVal] of Object.entries(params)) {
    const trimmed = (rawVal ?? '').trim();
    const isNum = /^-?\d+(\.\d+)?$/.test(trimmed);
    const isBoolOrNull = /^(true|false|null)$/i.test(trimmed);
    const isQuoted = /^(['"]).*\1$/.test(trimmed);
    const valReplacement = isNum || isBoolOrNull || isQuoted ? trimmed : `'${trimmed.replace(/'/g, "''")}'`;

    result = result.split(`\${${key}}`).join(trimmed);
    const colonRegex = new RegExp(`(?<![:\\w]):${key}(?![a-zA-Z0-9_:])`, 'g');
    result = result.replace(colonRegex, valReplacement);
  }
  return result;
}

export function QueryEditor({ tab }: Props) {
  const { theme, activeTabId } = useAppStore();
  const [query, setQuery] = useState(() => {
    try {
      const draft = localStorage.getItem(`terminalsql_sqldraft_${tab.connectionId}`);
      if (draft !== null && draft.length > 0) return draft;
    } catch {}
    return tab.initialQuery || '';
  });
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [readOnly, setReadOnly] = useState(true);

  // Auto-save draft to localStorage per connection
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (query && query.trim()) {
          localStorage.setItem(`terminalsql_sqldraft_${tab.connectionId}`, query);
        } else {
          localStorage.removeItem(`terminalsql_sqldraft_${tab.connectionId}`);
        }
      } catch {}
    }, 400);
    return () => clearTimeout(timer);
  }, [query, tab.connectionId]);

  // SQL Templates states
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [showSaveTemplateForm, setShowSaveTemplateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [newTemplateSql, setNewTemplateSql] = useState('');
  const [newTemplateDbType, setNewTemplateDbType] = useState('all');
  const [savingTemplate, setSavingTemplate] = useState(false);

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await api.database.templates.list();
      setTemplates(res.templates || []);
    } catch (err: any) {
      toast.error('Failed to load templates: ' + err.message);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleOpenTemplatesModal = () => {
    setIsTemplatesOpen(true);
    setShowSaveTemplateForm(false);
    fetchTemplates();
  };

  const handleOpenSaveTemplate = () => {
    let targetSql = query;
    if (editorRef.current) {
      const sel = editorRef.current.getModel()?.getValueInRange(editorRef.current.getSelection());
      if (sel && sel.trim()) targetSql = sel;
    }
    setNewTemplateSql(targetSql || '');
    setNewTemplateName('');
    setNewTemplateDesc('');
    setNewTemplateDbType((tab.connection as any).dbType || 'all');
    setShowSaveTemplateForm(true);
    setIsTemplatesOpen(true);
  };

  const handleSaveTemplateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim() || !newTemplateSql.trim()) {
      toast.error('Template name and SQL query are required');
      return;
    }
    setSavingTemplate(true);
    try {
      await api.database.templates.create({
        name: newTemplateName.trim(),
        description: newTemplateDesc.trim() || undefined,
        query: newTemplateSql.trim(),
        dbType: newTemplateDbType || 'all',
      });
      toast.success('Template saved successfully');
      setShowSaveTemplateForm(false);
      fetchTemplates();
    } catch (err: any) {
      toast.error('Failed to save template: ' + err.message);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    if (!confirm(`Delete template "${templateName}"?`)) return;
    try {
      await api.database.templates.delete(templateId);
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
    } catch (err: any) {
      toast.error('Failed to delete template: ' + err.message);
    }
  };

  const handleInsertTemplate = (templateQuery: string) => {
    if (editorRef.current) {
      const editor = editorRef.current;
      const position = editor.getPosition() || { lineNumber: 1, column: 1 };
      editor.executeEdits('insert-template', [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text: templateQuery,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus();
    } else {
      setQuery((prev) => (prev ? `${prev}\n\n${templateQuery}` : templateQuery));
    }
    setIsTemplatesOpen(false);
    toast.success('Template inserted');
  };

  const handleRunTemplate = (templateQuery: string) => {
    setQuery(templateQuery);
    if (editorRef.current) {
      editorRef.current.setValue(templateQuery);
    }
    setIsTemplatesOpen(false);
    setTimeout(() => {
      runQueryRef.current();
    }, 100);
  };

  // Cluster & Database selector states
  const [availableDbs, setAvailableDbs] = useState<string[]>([]);
  const [activeDb, setActiveDb] = useState<string>(tab.initialDatabase || (tab.connection as any).database || '');
  const [dbFilterText, setDbFilterText] = useState('');
  const [loadingDbs, setLoadingDbs] = useState(false);

  // Connection & Limit states
  const [connStatus, setConnStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connected');
  const [reconnecting, setReconnecting] = useState(false);
  const [selectedLimit, setSelectedLimit] = useState<number | 'unlimited'>(100);

  // Result table filter & sorting
  const [resultFilter, setResultFilter] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  // Full CSV Export & Chunk Streaming states
  const [isExporting, setIsExporting] = useState(false);
  const exportAbortControllerRef = useRef<AbortController | null>(null);

  // Lazy chunk loading & auto-fetch states
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoFetchOnScroll, setAutoFetchOnScroll] = useState(true);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const editorRef = useRef<any>(null);
  const runQueryRef = useRef<() => void>(() => {});
  const lastExecutedQueryRef = useRef<string>('');

  // Query parameter binding states
  const [isParamModalOpen, setIsParamModalOpen] = useState(false);
  const [pendingQuerySql, setPendingQuerySql] = useState('');
  const [pendingQueryParams, setPendingQueryParams] = useState<Record<string, string>>({});
  const [cachedParamValues, setCachedParamValues] = useState<Record<string, string>>({});

  // Fetch available databases / schemas on mount for this connection
  useEffect(() => {
    let mounted = true;
    setLoadingDbs(true);
    api.database.schema(tab.connectionId)
      .then((res: any) => {
        if (!mounted) return;
        if (res.databases && res.databases.length > 0) {
          const names = res.databases.map((d: any) => d.name || d);
          setAvailableDbs(names);
          if (!activeDb) {
            const preferred = tab.initialDatabase || (names.includes('base') ? 'base' : names[0]);
            setActiveDb(preferred);
          } else if (!names.includes(activeDb)) {
            setActiveDb(names[0]);
          }
        } else if (res.tables && res.tables.length > 0) {
          const defaultDb = tab.initialDatabase || (tab.connection as any).database || 'public';
          setAvailableDbs([defaultDb]);
          if (!activeDb) setActiveDb(defaultDb);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoadingDbs(false);
      });
    return () => {
      mounted = false;
    };
  }, [tab.connectionId, tab.initialDatabase]);

  const filteredDbs = useMemo(() => {
    if (!dbFilterText.trim()) return availableDbs;
    const q = dbFilterText.toLowerCase();
    return availableDbs.filter((d) => d.toLowerCase().includes(q));
  }, [availableDbs, dbFilterText]);

  async function handleSwitchDatabase(newDb: string) {
    setActiveDb(newDb);
    toast.success(`Active Database: ${newDb}`);

    const dbType =
      (tab.connection as any).dbType?.toLowerCase() ||
      (tab.connection.port === 8123 || tab.connection.port === 9443 || tab.connection.port === 21426
        ? 'clickhouse'
        : tab.connection.port === 3306
        ? 'mysql'
        : tab.connection.port === 5432 || tab.connection.port === 6432 || tab.connection.port === 8000
        ? 'postgres'
        : '');

    try {
      if (dbType === 'clickhouse' || dbType === 'mysql') {
        await api.database.query(tab.connectionId, `USE \`${newDb}\`;`, false, 1, 0, undefined, newDb);
      } else if (dbType === 'postgres') {
        await api.database.query(tab.connectionId, `SET search_path TO "${newDb}", public;`, false, 1, 0, undefined, newDb);
      }
    } catch {}
  }

  // Load initial query text into editor without auto-executing
  useEffect(() => {
    if (tab.initialQuery !== undefined) {
      setQuery(tab.initialQuery);
    }
  }, [tab.connectionId, tab.initialQuery]);

  // Handle appended queries into the existing active tab without clearing existing editor text
  useEffect(() => {
    const handleAppendQuery = (e: any) => {
      if (e.detail?.tabId !== tab.id) return;
      const { newQuery, dbName, runImmediately } = e.detail;
      if (dbName && dbName !== activeDb) {
        setActiveDb(dbName);
      }
      if (!newQuery) return;

      const editor = editorRef.current;
      const currentVal = editor ? editor.getValue() : query;
      const trimmed = (currentVal || '').trim();
      const isBlankOrDefault =
        !trimmed ||
        trimmed === 'SELECT 1;' ||
        trimmed === 'SELECT 1';

      let nextVal = '';
      if (isBlankOrDefault) {
        nextVal = newQuery;
      } else {
        nextVal = currentVal.trimEnd() + '\n\n' + newQuery;
      }

      setQuery(nextVal);
      if (editor) {
        editor.setValue(nextVal);
        const model = editor.getModel();
        const lineCount = model ? model.getLineCount() : 1;
        editor.revealLine(lineCount);
        editor.setPosition({ lineNumber: lineCount, column: 1 });
        editor.focus();
      }

      if (runImmediately === true) {
        runQuery(newQuery);
      }
    };

    window.addEventListener('terminalsql:append-query', handleAppendQuery as EventListener);
    return () => {
      window.removeEventListener('terminalsql:append-query', handleAppendQuery as EventListener);
    };
  }, [tab.id, query, readOnly, selectedLimit]);

  async function handleReconnect() {
    setReconnecting(true);
    setConnStatus('connecting');
    try {
      const res = await api.connections.test(tab.connectionId);
      if (res.success) {
        setConnStatus('connected');
        toast.success(`Connected! ${res.message || ''}`);
      } else {
        setConnStatus('disconnected');
        toast.error(`Connection error: ${res.message}`);
      }
    } catch (err: any) {
      setConnStatus('disconnected');
      toast.error('Reconnect failed: ' + err.message);
    } finally {
      setReconnecting(false);
    }
  }

  // Live query execution tracking & cancel support
  const [executingQueryText, setExecutingQueryText] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let timer: any = null;
    if (running) {
      const start = Date.now();
      timer = setInterval(() => {
        setElapsedMs(Date.now() - start);
      }, 100);
    } else {
      setElapsedMs(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [running]);

  function handleCancelQuery() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setRunning(false);
    toast('Query execution cancelled', { icon: '⏹' });
  }

  async function runQuery(customQuery?: string) {
    const q = (customQuery ?? query).trim();
    if (!q) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setRunning(true);
    setExecutingQueryText(q);
    lastExecutedQueryRef.current = q;
    setError(null);
    setResult(null);

    try {
      const limitNum = selectedLimit === 'unlimited' ? undefined : selectedLimit;
      const res = await api.database.query(tab.connectionId, q, readOnly, limitNum, 0, controller.signal, activeDb);
      setResult(res);
      setConnStatus('connected');
      toast.success(`${res.rowCount} rows · ${res.durationMs}ms`);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      setError(err.message || 'Query execution failed');
      const isConnErr = /connect|refused|timeout|closed|terminated|broken|reset|econn/i.test(err.message || '');
      if (isConnErr) {
        setConnStatus('disconnected');
      }
      toast.error('Query execution failed');
    } finally {
      setRunning(false);
      abortControllerRef.current = null;
    }
  }

  async function loadNextChunk() {
    if (!result || loadingMore || running) return;
    const queryToRun = lastExecutedQueryRef.current || executingQueryText || query;
    if (/\bLIMIT\s+\d+/i.test(queryToRun)) return;

    const currentCount = result.rows.length;
    if (result.totalRows && currentCount >= result.totalRows) return;

    if (currentCount >= 10000) {
      toast('Memory Safety Cap reached (10,000 rows). Please export to CSV to view more.', { icon: '⚠️' });
      return;
    }

    setLoadingMore(true);
    try {
      const chunkSize = typeof selectedLimit === 'number' ? selectedLimit : 100;
      const res = await api.database.query(tab.connectionId, queryToRun, readOnly, chunkSize, currentCount, undefined, activeDb);

      if (res.rows && res.rows.length > 0) {
        setResult((prev) => {
          if (!prev) return res;
          const mergedRows = [...prev.rows, ...res.rows];
          return {
            ...prev,
            rows: mergedRows,
            rowCount: mergedRows.length,
            durationMs: prev.durationMs + res.durationMs,
            truncated: prev.totalRows ? mergedRows.length < prev.totalRows : res.rows.length >= chunkSize,
          };
        });
      } else {
        setResult((prev) => prev ? { ...prev, truncated: false } : null);
      }
    } catch (err: any) {
      // Disable truncated so infinite scroll stops attempting on error
      setResult((prev) => prev ? { ...prev, truncated: false } : null);
      const rawMsg = err.message || 'Failed to load next rows';
      const cleanMsg = rawMsg.replace(/\(line \d+, col \d+\).*/s, '').replace(/failed at position.*/s, '').trim();
      toast.error(`Failed to load rows: ${cleanMsg || rawMsg}`);
    } finally {
      setLoadingMore(false);
    }
  }

  const handleTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const activeQ = lastExecutedQueryRef.current || executingQueryText || query;
    if (/\bLIMIT\s+\d+/i.test(activeQ)) return;
    if (!autoFetchOnScroll || loadingMore || !result?.truncated) return;
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
    if (nearBottom && result.rows.length < (result.totalRows ?? Infinity)) {
      loadNextChunk();
    }
  };

  function handleExecuteWithParams(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setIsParamModalOpen(false);
    setCachedParamValues((prev) => ({ ...prev, ...pendingQueryParams }));
    const finalSql = substituteParameters(pendingQuerySql, pendingQueryParams);
    runQuery(finalSql);
  }

  runQueryRef.current = () => {
    if (running) return;
    const editor = editorRef.current;
    let q = '';
    if (editor) {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && !selection.isEmpty() && model) {
        // Priority 1: User highlighted/selected a specific SQL query
        const selected = model.getValueInRange(selection).trim();
        if (selected) {
          q = selected.replace(/;+\s*$/, '').trim();
        }
      } else if (model) {
        // Priority 2: Execute the SQL statement at current cursor position
        const fullText = model.getValue();
        const position = editor.getPosition() || { lineNumber: 1, column: 1 };
        const cursorOffset = model.getOffsetAt(position);
        q = extractStatementAtCursor(fullText, cursorOffset);
      }
    } else {
      q = query.trim().replace(/;+\s*$/, '');
    }

    if (!q || !isExecutableSql(q)) {
      toast('No valid SQL statement found at cursor position. Place cursor inside a SQL query or highlight text.', { icon: '⚠️' });
      return;
    }

    // Check for query parameters (:param or ${param})
    const params = detectSqlParameters(q);
    if (params.length > 0) {
      setPendingQuerySql(q);
      const initialMap: Record<string, string> = {};
      params.forEach((p) => {
        initialMap[p] = cachedParamValues[p] || '';
      });
      setPendingQueryParams(initialMap);
      setIsParamModalOpen(true);
      return;
    }

    runQuery(q);
  };

  const isActive = activeTabId === tab.id;

  useEffect(() => {
    if (!isActive) return;
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Support Ctrl+Enter, Cmd+Enter, Alt+Ctrl+Enter, and Alt+Enter
      if (e.key === 'Enter' && ((e.ctrlKey || e.metaKey) || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        runQueryRef.current();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
    };
  }, [isActive]);

  function handleEditorMount(editor: any, monaco: any) {
    editorRef.current = editor;

    // Register Ctrl+Enter / Cmd+Enter keybinding in Monaco Editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runQueryRef.current();
    });

    // Register Alt+Ctrl+Enter / Cmd+Alt+Enter keybinding in Monaco Editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => {
      runQueryRef.current();
    });

    // Register Alt+Enter keybinding in Monaco Editor
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.Enter, () => {
      runQueryRef.current();
    });

    editor.addAction({
      id: 'execute-sql-query',
      label: 'Execute SQL Statement at Cursor',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.Enter,
        monaco.KeyMod.Alt | monaco.KeyCode.Enter,
      ],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1,
      run: () => {
        runQueryRef.current();
      },
    });

    if (document.fonts) {
      document.fonts.ready.then(() => {
        monaco?.editor?.remeasureFonts?.();
        editor.layout();
      });
    }
    setTimeout(() => {
      monaco?.editor?.remeasureFonts?.();
      editor.layout();
    }, 150);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQueryRef.current();
    }
  }

  // Filtered & sorted result rows
  const displayedRows = useMemo(() => {
    if (!result) return [];
    let rows = [...result.rows];
    if (resultFilter.trim()) {
      const q = resultFilter.toLowerCase();
      rows = rows.filter((r) =>
        result.fields.some((f) => String(r[f] ?? '').toLowerCase().includes(q))
      );
    }
    if (sortCol) {
      rows.sort((a, b) => {
        const valA = a[sortCol];
        const valB = b[sortCol];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortAsc ? valA - valB : valB - valA;
        }
        return sortAsc
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA));
      });
    }
    return rows;
  }, [result, resultFilter, sortCol, sortAsc]);

  // Export all query results directly to CSV with semicolon (;) delimiter.
  // Fetches full dataset from server and splits into 10,000 rows/file for large datasets to avoid memory cap.
  async function handleExportCsv() {
    if (isExporting) return;
    const q = (lastExecutedQueryRef.current || executingQueryText || query).trim();
    if (!q) {
      toast('No query executed to export', { icon: 'ℹ️' });
      return;
    }

    const hasUserLimit = /\bLIMIT\s+\d+/i.test(q);
    const currentRows = resultFilter.trim() ? displayedRows : result?.rows || [];
    const CHUNK_SIZE = 10000;
    const baseName = `${tab.connection.name}_${activeDb || 'export'}_${Date.now()}`.replace(/\s+/g, '_');

    // If result has explicit query LIMIT, or is already completely loaded:
    if (hasUserLimit || (result && !result.truncated && currentRows.length > 0 && currentRows.length < CHUNK_SIZE)) {
      const exportFields = result?.fields || (currentRows[0] ? Object.keys(currentRows[0]) : []);
      const csv = generateExportString(exportFields, currentRows, {
        delimiter: ';',
        quoteChar: '"',
        includeHeaders: true,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${currentRows.length.toLocaleString()} rows to CSV (;)`);
      return;
    }

    // Full dataset server streaming in chunks of 10,000 rows
    const abortCtrl = new AbortController();
    exportAbortControllerRef.current = abortCtrl;
    setIsExporting(true);

    const toastId = toast.loading('Exporting full query dataset from cluster...', { duration: Infinity });
    let offset = 0;
    let part = 1;
    let totalExported = 0;
    let fields: string[] = result?.fields || [];

    try {
      while (!abortCtrl.signal.aborted) {
        toast.loading(
          `Exporting: Fetching rows ${(offset + 1).toLocaleString()} - ${(offset + CHUNK_SIZE).toLocaleString()}...`,
          { id: toastId }
        );

        const res = await api.database.query(
          tab.connectionId,
          q,
          readOnly,
          CHUNK_SIZE,
          offset,
          abortCtrl.signal,
          activeDb
        );

        if (!res.rows || res.rows.length === 0) {
          break;
        }

        if (fields.length === 0 && res.fields && res.fields.length > 0) {
          fields = res.fields;
        }

        const chunkRows = res.rows;
        totalExported += chunkRows.length;

        // Convert batch of rows to CSV with semicolon (;) delimiter
        const csv = generateExportString(fields, chunkRows, {
          delimiter: ';',
          quoteChar: '"',
          includeHeaders: true,
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // If dataset fits in 1 single chunk and is finished
        if (offset === 0 && (!res.truncated || chunkRows.length < CHUNK_SIZE)) {
          a.download = `${baseName}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          break;
        } else {
          // Automatic partial files for massive datasets (10,000 rows per file)
          a.download = `${baseName}_part${part}_(rows_${(offset + 1).toLocaleString()}-${(offset + chunkRows.length).toLocaleString()}).csv`;
          a.click();
          URL.revokeObjectURL(url);
          part++;
        }

        // If fewer rows returned than chunkSize, or server explicitly says no more rows:
        if (chunkRows.length < CHUNK_SIZE || !res.truncated) {
          break;
        }

        offset += chunkRows.length;
        // Small delay to allow browser to handle disk save without dropping connections
        await new Promise((r) => setTimeout(r, 450));
      }

      toast.success(
        part > 1
          ? `Export complete! ${totalExported.toLocaleString()} rows saved in ${part - 1} files (10,000 rows/file).`
          : `Export complete! ${totalExported.toLocaleString()} rows exported to CSV (;).`,
        { id: toastId, duration: 6000 }
      );
    } catch (err: any) {
      if (err.name === 'AbortError' || abortCtrl.signal.aborted) {
        toast(`Export stopped. Saved ${totalExported.toLocaleString()} rows so far.`, { id: toastId, icon: '⏹' });
      } else {
        toast.error(`Export error at row ${offset.toLocaleString()}: ${err.message}`, { id: toastId, duration: 5000 });
      }
    } finally {
      setIsExporting(false);
      exportAbortControllerRef.current = null;
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  }

  return (
    <div className="h-full w-full flex flex-col bg-background text-foreground overflow-hidden" onKeyDown={handleKeyDown}>
      <ResizablePanelGroup direction="vertical" className="h-full w-full">
        {/* Top: SQL Toolbar & Monaco Editor */}
        <ResizablePanel defaultSize={42} minSize={20} className="flex flex-col border-b border-border bg-background">
          {/* SQL Toolbar */}
          <div className="min-h-9 py-1 px-3 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between gap-3 shrink-0 select-none overflow-x-auto no-scrollbar flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Cluster Info Pill */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground font-medium text-[11px]">Cluster:</span>
                <div
                  className="h-7 px-2.5 rounded border border-border bg-card text-foreground flex items-center gap-1.5 font-mono shadow-sm select-none"
                  title={`Target Cluster: ${tab.connection.name} (${tab.connection.host}:${tab.connection.port})`}
                >
                  <span className="shrink-0">
                    {getDatabaseBrandIcon(tab.connection, (tab.connection as any).dbType, 'w-3.5 h-3.5')}
                  </span>
                  <span className="font-semibold text-foreground text-[11px] truncate max-w-[150px]">
                    {tab.connection.name}
                  </span>
                </div>
              </div>

              {/* Database / Schema Dropdown Selector */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground font-medium text-[11px]">DB:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs border-purple-500/40 hover:border-purple-500/70 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 gap-1.5 font-mono shadow-sm transition-colors cursor-pointer"
                      title="Active Database / Schema (Click to switch)"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                      <span className="font-semibold text-purple-200 text-[11.5px] truncate max-w-[120px]">
                        {activeDb || 'default'}
                      </span>
                      <ChevronDown className="w-3 h-3 text-purple-400/80 ml-0.5 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64 bg-popover border-border text-xs text-popover-foreground shadow-2xl p-1.5 z-50">
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1 border-b border-border/80">
                      <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        placeholder="Filter databases..."
                        value={dbFilterText}
                        onChange={(e) => setDbFilterText(e.target.value)}
                        className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none w-full font-mono"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        autoFocus
                      />
                      {dbFilterText && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDbFilterText('');
                          }}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {loadingDbs && availableDbs.length === 0 ? (
                        <div className="px-2 py-2 text-center text-muted-foreground text-[11px] flex items-center justify-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                          <span>Loading databases...</span>
                        </div>
                      ) : filteredDbs.length === 0 ? (
                        <div className="px-2 py-2 text-center text-muted-foreground text-[11px]">
                          No database found
                        </div>
                      ) : (
                        filteredDbs.map((dName) => {
                          const isCurrent = (activeDb || 'default') === dName;
                          return (
                            <DropdownMenuItem
                              key={dName}
                              onClick={() => handleSwitchDatabase(dName)}
                              className={cn(
                                "flex items-center justify-between cursor-pointer h-7 px-2 py-1 text-xs rounded font-mono transition-colors",
                                isCurrent
                                  ? "bg-purple-500/20 text-purple-200 font-semibold border border-purple-500/30"
                                  : "hover:bg-muted text-foreground"
                              )}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", isCurrent ? "bg-purple-400" : "bg-muted-foreground/40")} />
                                <span className="truncate">{dName}</span>
                              </div>
                              {isCurrent && (
                                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-1" />
                              )}
                            </DropdownMenuItem>
                          );
                        })
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Limit Selector */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground font-medium text-[11px]">Limit:</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs border-border bg-card hover:bg-muted text-foreground gap-1 font-mono shadow-sm"
                    >
                      <span className="font-semibold text-foreground">
                        {selectedLimit === 'unlimited' ? 'Unlimited' : selectedLimit}
                      </span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-32 bg-popover border-border text-xs text-popover-foreground shadow-xl p-1">
                    {[100, 200, 500, 1000, 2000, 'unlimited'].map((lim) => (
                      <DropdownMenuItem
                        key={String(lim)}
                        onClick={() => setSelectedLimit(lim as any)}
                        className={`flex items-center justify-between cursor-pointer h-6 px-2 py-0.5 text-xs ${
                          selectedLimit === lim ? 'bg-accent text-accent-foreground font-semibold' : ''
                        }`}
                      >
                        <span>{lim === 'unlimited' ? 'Unlimited' : `${lim}`}</span>
                        {selectedLimit === lim && <Check className="w-3 h-3 text-emerald-500" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Connection Status Indicator & Reconnect */}
              {connStatus === 'disconnected' ? (
                <button
                  type="button"
                  onClick={handleReconnect}
                  disabled={reconnecting}
                  className="flex items-center gap-1.5 px-2 h-7 rounded border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-xs font-mono transition-colors cursor-pointer shadow-sm"
                  title="Connection failed. Click to Reconnect."
                >
                  <RefreshCw className={`w-3 h-3 ${reconnecting ? 'animate-spin' : ''}`} />
                  <span className="text-[11px] font-medium">Reconnect</span>
                </button>
              ) : connStatus === 'connecting' || reconnecting ? (
                <div className="flex items-center gap-1.5 px-2 h-7 rounded border border-border bg-card text-muted-foreground text-xs font-mono">
                  <Loader2 className="w-3 h-3 animate-spin text-purple-500" />
                  <span className="text-[11px]">Connecting...</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 h-7 rounded border border-border bg-card text-muted-foreground text-xs font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Connected</span>
                </div>
              )}

              {/* Safe Mode */}
              <button
                type="button"
                onClick={() => {
                  const next = !readOnly;
                  setReadOnly(next);
                  if (next) toast.success('Safe Mode: ON (Read-Only)');
                  else toast('Safe Mode: OFF (Write Enabled)', { icon: '⚠️' });
                }}
                className={`h-7 px-2 rounded border text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer select-none ${
                  readOnly
                    ? 'border-amber-500/50 bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 dark:text-amber-400 font-semibold ring-1 ring-amber-500/20'
                    : 'border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground font-medium'
                }`}
                title="Toggle Safe Mode (Read-Only transactions)"
              >
                {readOnly ? (
                  <Lock className="w-3 h-3 text-amber-500 shrink-0" />
                ) : (
                  <Unlock className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
                <span>Safe Mode</span>
              </button>
            </div>

            {/* Right Action Buttons: Templates, Clear, Copy SQL, Run */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenTemplatesModal}
                className="h-6.5 px-2.5 text-[11px] font-medium text-purple-400 hover:text-purple-300 border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 gap-1.5 shadow-sm transition-colors cursor-pointer"
                title="Open Saved SQL Templates & Snippets"
              >
                <Bookmark className="w-3 h-3 text-purple-400" />
                <span>Templates</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('');
                  try {
                    localStorage.removeItem(`terminalsql_sqldraft_${tab.connectionId}`);
                  } catch {}
                  if (editorRef.current) {
                    editorRef.current.setValue('');
                    editorRef.current.focus();
                  }
                }}
                className="h-6.5 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground border-border bg-card hover:bg-muted gap-1 shadow-sm transition-colors cursor-pointer"
                title="Clear SQL Editor"
              >
                Clear
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const val = editorRef.current ? editorRef.current.getValue() : query;
                  if (val) {
                    navigator.clipboard.writeText(val);
                    toast.success('SQL copied to clipboard');
                  }
                }}
                className="h-6.5 px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground border-border bg-card hover:bg-muted gap-1 shadow-sm transition-colors cursor-pointer"
                title="Copy current SQL to clipboard"
              >
                <Copy className="w-3 h-3 text-muted-foreground" />
                <span>Copy SQL</span>
              </Button>

              {running ? (
                <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
                  <div className="flex items-center gap-1.5 px-2.5 h-6.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[11px] font-mono shadow-sm">
                    <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                    <span className="font-medium">Running</span>
                    <span className="text-[10.5px] text-purple-300 font-mono">{(elapsedMs / 1000).toFixed(1)}s</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancelQuery}
                    className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border-rose-500/30 h-6.5 px-2 text-[11px] gap-1 shadow-sm font-medium transition-colors cursor-pointer"
                    title="Cancel Running Query"
                  >
                    <Square className="w-2.5 h-2.5 fill-rose-400" />
                    <span>Cancel</span>
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() => runQueryRef.current()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold h-6.5 px-2.5 text-[11px] gap-1 shadow-sm transition-all cursor-pointer"
                  title="Execute Query (Ctrl+Enter)"
                >
                  <Play className="w-3 h-3 fill-current text-white" />
                  <span>Run</span>
                  <span className="text-[9.5px] bg-black/25 text-white/90 px-1 py-0.2 rounded font-mono ml-0.5">
                    Ctrl+↵
                  </span>
                </Button>
              )}
            </div>
          </div>

          {/* Monaco Editor Container with Drag & Drop Insertion */}
          <div
            className="flex-1 overflow-hidden relative select-text"
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              const text = e.dataTransfer.getData('text/plain');
              if (text) {
                e.preventDefault();
                if (editorRef.current) {
                  const editor = editorRef.current;
                  const position = editor.getPosition() || { lineNumber: 1, column: 1 };
                  editor.executeEdits('dnd-table', [
                    {
                      range: {
                        startLineNumber: position.lineNumber,
                        startColumn: position.column,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                      },
                      text: text,
                      forceMoveMarkers: true,
                    },
                  ]);
                  editor.focus();
                } else {
                  setQuery((prev) => prev ? `${prev} ${text}` : text);
                }
                toast.success(`Inserted "${text}"`, { duration: 1500 });
              }
            }}
          >
            <Editor
              value={query}
              onChange={(v) => setQuery(v ?? '')}
              onMount={handleEditorMount}
              language="sql"
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              options={{
                readOnly: false,
                domReadOnly: false,
                minimap: { enabled: false },
                fontSize: 12,
                lineHeight: 18,
                fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
                fontLigatures: false,
                letterSpacing: 0,
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: false,
                scrollBeyondLastLine: false,
                padding: { top: 6, bottom: 6 },
                wordWrap: 'on',
                automaticLayout: true,
                suggestOnTriggerCharacters: true,
                renderLineHighlight: 'all',
                dragAndDrop: true,
              }}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="bg-border hover:bg-purple-500/60 transition-colors" />

        {/* Bottom: Query Results Canvas */}
        <ResizablePanel defaultSize={58} minSize={20} className="flex flex-col bg-card overflow-hidden relative">
          {running && (
            <div className="h-0.5 w-full bg-muted overflow-hidden relative shrink-0 z-20">
              <div className="absolute inset-y-0 w-1/3 bg-primary animate-indeterminate" />
            </div>
          )}

          {running ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in duration-150">
              <div className="flex flex-col items-center gap-2.5 max-w-sm">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                <div className="space-y-0.5">
                  <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-foreground">
                    <span>Executing query...</span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      ({(elapsedMs / 1000).toFixed(1)}s)
                    </span>
                  </div>
                  <p className="text-[10.5px] text-muted-foreground font-mono">
                    {tab.connection.name} {activeDb ? `· ${activeDb}` : ''}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelQuery}
                  className="h-6.5 text-[11px] text-rose-500 hover:text-rose-600 border-border hover:bg-rose-500/10 gap-1.5 mt-1 cursor-pointer shadow-sm"
                >
                  <Square className="w-2.5 h-2.5 fill-current" />
                  <span>Cancel</span>
                </Button>
              </div>
            </div>
          ) : error ? (
            <div className="p-4 flex items-start gap-3 text-rose-500 font-mono text-xs bg-rose-500/10 border-b border-rose-500/20 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div>
                <p className="font-semibold text-rose-500">Execution Error</p>
                <p className="mt-1 text-rose-600 dark:text-rose-400 whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          ) : result ? (
            <div className="flex-1 flex flex-col overflow-hidden animate-in fade-in duration-150">
              {/* Results Toolbar */}
              <div className="h-9 px-3 border-b border-border bg-card/90 flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{result.rowCount} rows</span>
                    <span className="text-border">·</span>
                    <span className="text-muted-foreground">{result.fields.length} cols</span>
                    <span className="text-border">·</span>
                    <span className="text-muted-foreground">{result.durationMs}ms</span>
                  </div>

                  {/* Smart Auto-fetch on scroll toggle or explicit query LIMIT indicator */}
                  {result.truncated ? (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !autoFetchOnScroll;
                        setAutoFetchOnScroll(next);
                        if (next) {
                          toast.success('Auto-fetch enabled on scroll');
                        } else {
                          toast('Auto-fetch disabled');
                        }
                      }}
                      className={cn(
                        "flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer font-mono font-medium shadow-sm select-none",
                        autoFetchOnScroll
                          ? "bg-purple-500/15 text-purple-400 border-purple-500/30 hover:bg-purple-500/25"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                      )}
                      title="Automatically fetch next 100 rows when scrolling near bottom"
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", autoFetchOnScroll ? "bg-purple-400 animate-pulse" : "bg-muted-foreground/40")} />
                      <span>Scroll-load: {autoFetchOnScroll ? 'ON' : 'OFF'}</span>
                    </button>
                  ) : /\bLIMIT\s+\d+/i.test(lastExecutedQueryRef.current || executingQueryText || query) ? (
                    <div
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-mono font-medium shadow-sm select-none"
                      title="Query contains an explicit LIMIT clause. All rows satisfying your query have been loaded."
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>LIMIT Satisfied</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  {/* Search Text in Results */}
                  <div className="flex items-center gap-1.5">
                    <div className="relative">
                      <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        placeholder="Search text..."
                        value={resultFilter}
                        onChange={(e) => setResultFilter(e.target.value)}
                        className="h-6.5 w-36 pl-6 pr-6 text-[11px] bg-muted/60 border-border font-mono placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      {resultFilter && (
                        <button
                          type="button"
                          onClick={() => setResultFilter('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                          title="Clear search"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                    {resultFilter.trim() && (
                      <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted border border-border select-none">
                        {displayedRows.length} matches
                      </span>
                    )}
                  </div>

                  {/* Single High-Density Export CSV Button */}
                  {isExporting ? (
                    <div className="flex items-center gap-1">
                      <div className="h-6.5 text-[11px] font-medium border border-purple-500/40 bg-purple-500/15 text-purple-300 flex items-center gap-1.5 px-2 rounded shadow-sm font-mono">
                        <Loader2 className="w-3 h-3 animate-spin text-purple-400" />
                        <span>Exporting CSV...</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => exportAbortControllerRef.current?.abort()}
                        className="h-6.5 px-2 text-[10.5px] font-mono text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded cursor-pointer transition-colors"
                        title="Stop Export"
                      >
                        Stop
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportCsv}
                      className="h-6.5 text-[11px] font-medium border-border bg-card hover:bg-muted text-foreground gap-1.5 px-2.5 shadow-sm transition-colors cursor-pointer"
                      title="Download all query result rows to CSV (Semicolon ; delimited)"
                    >
                      <Download className="w-3 h-3 text-purple-400" />
                      <span>Export CSV</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Results Table (Smooth Horizontal & Vertical Scrolling with Sticky Header and Row Index) */}
              <div
                ref={tableContainerRef}
                onScroll={handleTableScroll}
                className="flex-1 overflow-auto bg-card select-text relative"
              >
                <table className="w-max min-w-full font-mono text-xs border-collapse">
                  <thead className="bg-muted/95 backdrop-blur sticky top-0 border-b border-border z-20 shadow-[0_1px_0_0_hsl(var(--border))]">
                    <tr className="border-border">
                      <th className="w-12 min-w-[44px] max-w-[48px] text-muted-foreground font-mono text-[11px] font-medium h-7 text-center select-none sticky left-0 top-0 bg-muted z-30 border-r border-b border-border">
                        No
                      </th>
                      {result.fields.map((f) => (
                        <th
                          key={f}
                          onClick={() => {
                            if (sortCol === f) setSortAsc(!sortAsc);
                            else {
                              setSortCol(f);
                              setSortAsc(true);
                            }
                          }}
                          className="text-foreground font-semibold h-7 text-xs cursor-pointer hover:bg-accent/80 select-none px-3 whitespace-nowrap border-b border-border text-left transition-colors min-w-[120px]"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>{f}</span>
                            <ArrowUpDown className="w-2.5 h-2.5 opacity-0 hover:opacity-100 text-muted-foreground transition-opacity" />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.length === 0 ? (
                      <tr>
                        <td colSpan={result.fields.length + 1} className="h-24 text-center text-muted-foreground">
                          No rows matching filter
                        </td>
                      </tr>
                    ) : (
                      displayedRows.map((row, i) => (
                        <tr key={i} className="border-b border-border/40 hover:bg-muted/40 transition-colors">
                          <td className="w-12 min-w-[48px] max-w-[48px] py-1 text-muted-foreground font-mono text-[11px] text-center bg-card sticky left-0 z-10 border-r border-border/40 select-none whitespace-nowrap">
                            {i + 1}
                          </td>
                          {result.fields.map((f) => {
                            const val = row[f];
                            return (
                              <td
                                key={f}
                                onClick={() => copyToClipboard(val === null ? 'NULL' : String(val))}
                                className="py-1 px-3 text-foreground font-mono text-xs max-w-sm truncate cursor-pointer hover:bg-accent/40 whitespace-nowrap border-r border-border/10"
                                title="Click to copy cell value"
                              >
                                {val === null || val === undefined ? (
                                  <span className="text-muted-foreground/60 italic">NULL</span>
                                ) : (
                                  String(val)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}

                    {/* Infinite / Lazy Load Status Rows */}
                    {loadingMore && (
                      <tr className="bg-muted/40 border-b border-border/50">
                        <td
                          colSpan={result.fields.length + 1}
                          className="py-2.5 px-4 text-center text-xs font-mono text-purple-400 select-none sticky left-0"
                        >
                          <div className="inline-flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Loading next batch (Offset: {result.rows.length.toLocaleString()})...</span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {!loadingMore && result.truncated && (
                      <tr className="bg-muted/20 border-b border-border hover:bg-muted/30 transition-colors">
                        <td
                          colSpan={result.fields.length + 1}
                          className="py-2 px-4 text-center select-none sticky left-0"
                        >
                          <div className="flex items-center justify-center gap-3 text-xs">
                            <span className="text-muted-foreground font-mono text-[11px]">
                              Showing {result.rows.length.toLocaleString()} of {result.totalRows ? result.totalRows.toLocaleString() : 'more'} rows
                            </span>

                            {result.rows.length >= 10000 ? (
                              <span className="text-amber-500 text-[11px] font-mono bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
                                Memory Cap (10k rows loaded). Export dataset to view all.
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={loadNextChunk}
                                className="h-6 text-xs px-2.5 py-0 font-mono gap-1.5 bg-background border-border hover:bg-accent text-foreground shadow-sm"
                              >
                                <RefreshCw className="w-3 h-3 text-purple-400" />
                                <span>Load Next {typeof selectedLimit === 'number' ? selectedLimit : 100} Rows</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}

                    {!loadingMore && !result.truncated && result.totalRows && result.rows.length >= result.totalRows && result.totalRows > (typeof selectedLimit === 'number' ? selectedLimit : 100) && (
                      <tr className="bg-muted/10 border-b border-border/20">
                        <td
                          colSpan={result.fields.length + 1}
                          className="py-1.5 px-4 text-center text-[11px] text-muted-foreground/80 font-mono select-none sticky left-0"
                        >
                          <div className="inline-flex items-center gap-1.5 text-emerald-400/90">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>All {result.totalRows.toLocaleString()} rows loaded</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground space-y-3 select-none">
              <div className="w-12 h-12 rounded-xl bg-muted/80 border border-border flex items-center justify-center text-purple-400">
                <Code2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Ready to execute query</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Press <kbd className="px-1.5 py-0.5 bg-muted border border-border rounded font-mono text-foreground">Ctrl + Enter</kbd> or double-click any table on the left
                </p>
              </div>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Query Parameters Modal */}
      <Dialog open={isParamModalOpen} onOpenChange={setIsParamModalOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-[440px] p-4 shadow-2xl">
          <DialogHeader className="space-y-1 pb-2 border-b border-zinc-800/80">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4 text-purple-400" />
              <DialogTitle className="text-xs font-semibold text-zinc-100">
                Bind Query Parameters
              </DialogTitle>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30 ml-auto">
                Statement Mode
              </span>
            </div>
            <DialogDescription className="text-[11px] text-zinc-400">
              Provide values for query parameter variables before execution:
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleExecuteWithParams} className="space-y-3 pt-2">
            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {Object.keys(pendingQueryParams).map((pKey, idx) => (
                <div key={pKey} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-purple-400 bg-purple-950/40 border border-purple-800/50 px-2 py-1 rounded w-32 truncate shrink-0 text-right">
                    :{pKey}
                  </span>
                  <Input
                    autoFocus={idx === 0}
                    value={pendingQueryParams[pKey]}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPendingQueryParams((prev) => ({ ...prev, [pKey]: v }));
                    }}
                    placeholder={`value for :${pKey}`}
                    className="h-7 text-xs bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 font-mono flex-1"
                  />
                </div>
              ))}
            </div>

            <DialogFooter className="pt-2 border-t border-zinc-800/80 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsParamModalOpen(false)}
                className="h-6.5 text-[11px] px-2.5 bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-6.5 text-[11px] px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium gap-1"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Execute</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* SQL Script Templates & Snippets Modal */}
      <Dialog open={isTemplatesOpen} onOpenChange={setIsTemplatesOpen}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-[620px] max-h-[85vh] flex flex-col p-4 shadow-2xl">
          <DialogHeader className="space-y-1 pb-2 border-b border-zinc-800/80 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-purple-400" />
                <DialogTitle className="text-xs font-semibold text-zinc-100">
                  SQL Script Templates & Snippets
                </DialogTitle>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => (showSaveTemplateForm ? setShowSaveTemplateForm(false) : handleOpenSaveTemplate())}
                className="h-6.5 text-[11px] px-2.5 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 text-purple-300 gap-1"
              >
                <Plus className="w-3 h-3" />
                <span>{showSaveTemplateForm ? 'Browse Templates' : 'Save Current Query'}</span>
              </Button>
            </div>
            <DialogDescription className="text-[11px] text-zinc-400">
              {showSaveTemplateForm
                ? 'Save your SQL query as a reusable template stored persistently in SQLite backend.'
                : 'Reusable SQL snippets accessible across browser tabs and devices.'}
            </DialogDescription>
          </DialogHeader>

          {showSaveTemplateForm ? (
            <form onSubmit={handleSaveTemplateSubmit} className="space-y-3 pt-3 overflow-y-auto">
              <div className="space-y-1.5">
                <label className="text-[11px] text-zinc-300 font-medium">Template Name *</label>
                <Input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g. Check Active Queries, Daily Sales Summary..."
                  className="h-7 text-xs bg-zinc-900 border-zinc-700 text-zinc-100"
                  autoFocus
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-300 font-medium">Database Engine</label>
                  <select
                    value={newTemplateDbType}
                    onChange={(e) => setNewTemplateDbType(e.target.value)}
                    className="h-7 w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 text-zinc-200 outline-none"
                  >
                    <option value="all">All Engines</option>
                    <option value="mysql">MySQL</option>
                    <option value="postgres">PostgreSQL</option>
                    <option value="clickhouse">ClickHouse</option>
                    <option value="sqlite">SQLite</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-zinc-300 font-medium">Description (Optional)</label>
                  <Input
                    value={newTemplateDesc}
                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                    placeholder="Brief description of this query..."
                    className="h-7 text-xs bg-zinc-900 border-zinc-700 text-zinc-100"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-zinc-300 font-medium">SQL Script *</label>
                <textarea
                  value={newTemplateSql}
                  onChange={(e) => setNewTemplateSql(e.target.value)}
                  placeholder="SELECT * FROM table..."
                  rows={6}
                  className="w-full text-xs font-mono bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 outline-none leading-relaxed"
                  required
                />
              </div>

              <DialogFooter className="pt-2 border-t border-zinc-800/80 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSaveTemplateForm(false)}
                  className="h-6.5 text-[11px] px-2.5 bg-zinc-900 border-zinc-700 text-zinc-300"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={savingTemplate}
                  className="h-6.5 text-[11px] px-3 bg-purple-600 hover:bg-purple-500 text-white font-medium gap-1"
                >
                  {savingTemplate && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Save Template</span>
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 pt-2 space-y-2">
              <div className="relative shrink-0">
                <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  placeholder="Filter templates by name or query..."
                  className="h-7 pl-8 text-xs bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[200px] max-h-[360px]">
                {loadingTemplates ? (
                  <div className="py-12 flex flex-col items-center justify-center text-zinc-500 gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                    <span className="text-xs">Loading saved templates...</span>
                  </div>
                ) : templates.length === 0 ? (
                  <div className="py-12 flex flex-col items-center justify-center text-center text-zinc-500 space-y-1.5">
                    <Bookmark className="w-8 h-8 opacity-25 text-purple-400" />
                    <p className="text-xs font-semibold text-zinc-300">No SQL templates saved yet</p>
                    <p className="text-[11px] text-zinc-500 max-w-xs">
                      Click <span className="text-purple-400 font-medium">Save Current Query</span> above to save recurring queries for quick access.
                    </p>
                  </div>
                ) : (
                  templates
                    .filter(
                      (t) =>
                        t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
                        t.query.toLowerCase().includes(templateSearch.toLowerCase()) ||
                        (t.description && t.description.toLowerCase().includes(templateSearch.toLowerCase()))
                    )
                    .map((tpl) => (
                      <div
                        key={tpl.id}
                        className="p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-zinc-700 transition-all space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-zinc-100">{tpl.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
                              {tpl.dbType || 'all'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleInsertTemplate(tpl.query)}
                              className="px-2 py-0.5 text-[10.5px] rounded border border-zinc-700 hover:bg-zinc-800 text-zinc-300 transition-colors"
                              title="Insert query into current editor at cursor"
                            >
                              Insert
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRunTemplate(tpl.query)}
                              className="px-2 py-0.5 text-[10.5px] rounded bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-400 transition-colors flex items-center gap-1"
                              title="Set editor to this template and execute immediately"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                              <span>Run</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 transition-colors ml-1"
                              title="Delete template"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {tpl.description && (
                          <p className="text-[11px] text-zinc-400">{tpl.description}</p>
                        )}

                        <div className="bg-black/60 border border-zinc-800/80 rounded p-1.5 font-mono text-[11px] text-emerald-400 max-h-16 overflow-y-auto whitespace-pre-wrap select-text">
                          {tpl.query}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
