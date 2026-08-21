import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLogs } from '../hooks/useLogs';
import { Button } from './common/Button';
import { STAGES } from '../lib/stages';

const ERROR_RE = /OutOfMemoryError|CUDA error|Error|Traceback|FATAL|PANIC/i;
const WARN_RE = /warning|Warning|WARN/i;

interface Props {
  initialLines?: string[];
}

interface LogChunk {
  stageId: string;
  label: string;
  lines: string[];
}

/** Try to detect which stage a log line belongs to. */
function detectStage(line: string): string {
  const lower = line.toLowerCase();
  if (/loading model|loading weights|load.*weight/.test(lower)) return 'weights';
  if (/profiling|memory profiling/.test(lower)) return 'profile';
  if (/kv cache|kvcache|allocating/.test(lower)) return 'kvcache';
  if (/cuda graph|cuda.*capture|capturing/.test(lower)) return 'cudagraph';
  if (/compil|kernel|triton/.test(lower)) return 'compile';
  if (/server.*start|listen|bind|serving/.test(lower)) return 'server';
  if (/init|boot|start/.test(lower)) return 'init';
  return 'init';
}

function groupByStage(lines: string[]): LogChunk[] {
  const chunks: LogChunk[] = [];
  let current: LogChunk = { stageId: 'init', label: 'Initializing', lines: [] };

  for (const line of lines) {
    const stageId = detectStage(line);
    if (stageId !== current.stageId) {
      if (current.lines.length > 0) {
        chunks.push(current);
      }
      const stage = STAGES.find(s => s.id === stageId) ?? STAGES[0];
      current = { stageId: stage.id, label: stage.label, lines: [] };
    }
    current.lines.push(line);
  }
  if (current.lines.length > 0) chunks.push(current);
  return chunks;
}

export function LogViewer({ initialLines = [] }: Props) {
  const lines = useLogs(initialLines);

  // --- search state ---
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- filter ---
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // --- folding ---
  const [folded, setFolded] = useState<Set<string>>(new Set());

  // Filtered lines
  const filtered = useMemo(() => {
    if (!filter) return lines;
    const q = filter.toLowerCase();
    return lines.filter(l => l.toLowerCase().includes(q));
  }, [lines, filter]);

  // Group by stage for folding view
  const chunks = useMemo(() => groupByStage(filtered), [filtered]);

  // All matches indices (on full filtered list)
  const matchIndices = useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    filtered.forEach((l, i) => {
      if (l.toLowerCase().includes(q)) indices.push(i);
    });
    return indices;
  }, [filtered, searchQuery]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Ctrl+F handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchIndex(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  // Keep search index in sync with query changes
  useEffect(() => {
    setSearchIndex(matchIndices.length > 0 ? 0 : -1);
  }, [searchQuery]);

  const navigateSearch = useCallback(
    (dir: 1 | -1) => {
      if (matchIndices.length === 0) return;
      setSearchIndex(prev => {
        const next = prev + dir;
        if (next < 0) return matchIndices.length - 1;
        if (next >= matchIndices.length) return 0;
        return next;
      });
    },
    [matchIndices.length],
  );

  // Scroll to matched line
  useEffect(() => {
    if (searchIndex < 0 || !containerRef.current) return;
    const lineEls = containerRef.current.querySelectorAll('[data-log-line]');
    const target = lineEls[matchIndices[searchIndex]] as HTMLElement | undefined;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [searchIndex, matchIndices]);

  // Jump to first error
  const jumpToError = useCallback(() => {
    if (!containerRef.current) return;
    const lineEls = containerRef.current.querySelectorAll('[data-log-line]');
    for (let i = 0; i < filtered.length; i++) {
      if (ERROR_RE.test(filtered[i])) {
        (lineEls[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        break;
      }
    }
  }, [filtered]);

  // Download log
  const downloadLog = useCallback(() => {
    const blob = new Blob([filtered.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    // L10: defer revocation for Safari compatibility
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [filtered]);

  const toggleChunk = useCallback((stageId: string) => {
    setFolded(prev => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  const foldAll = useCallback(() => {
    setFolded(new Set(chunks.map(c => c.stageId)));
  }, [chunks]);

  const expandAll = useCallback(() => {
    setFolded(new Set());
  }, []);

  // Track a running line counter across chunks for data-log-line indices
  let globalLineIdx = -1;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <input
          type="text"
          placeholder="Filter..."
          className="flex-1 min-w-[160px] bg-bg-tertiary border border-border rounded px-3 py-1.5 text-sm"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
        <Button variant="secondary" size="sm" onClick={() => { setSearchOpen(v => !v); setTimeout(() => searchInputRef.current?.focus(), 0); }}>
          Search
        </Button>
        <Button variant="secondary" size="sm" onClick={jumpToError}>
          Jump to Error
        </Button>
        <Button variant="secondary" size="sm" onClick={downloadLog}>
          Download
        </Button>
        <Button variant="ghost" size="sm" onClick={foldAll}>
          Fold All
        </Button>
        <Button variant="ghost" size="sm" onClick={expandAll}>
          Expand All
        </Button>
      </div>

      {/* Search bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 mb-2 bg-bg-tertiary border border-border rounded px-3 py-1.5">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search logs..."
            className="flex-1 bg-transparent text-sm outline-none"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') navigateSearch(e.shiftKey ? -1 : 1);
              if (e.key === 'Escape') {
                setSearchOpen(false);
                setSearchQuery('');
                setSearchIndex(-1);
              }
            }}
          />
          <span className="text-xs text-text-secondary whitespace-nowrap">
            {matchIndices.length > 0 ? `${searchIndex + 1}/${matchIndices.length}` : 'No matches'}
          </span>
          <button className="text-text-secondary hover:text-text-primary text-xs px-1" onClick={() => navigateSearch(-1)}>&#9650;</button>
          <button className="text-text-secondary hover:text-text-primary text-xs px-1" onClick={() => navigateSearch(1)}>&#9660;</button>
        </div>
      )}

      {/* Log container */}
      <div
        ref={containerRef}
        className="flex-1 bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-3 overflow-auto font-mono text-xs leading-relaxed"
      >
        {chunks.length === 0 && (
          <div className="text-text-secondary italic">No log lines.</div>
        )}
        {chunks.map(chunk => {
          const isFolded = folded.has(chunk.stageId);
          const errorInChunk = chunk.lines.some(l => ERROR_RE.test(l));
          const warnInChunk = !errorInChunk && chunk.lines.some(l => WARN_RE.test(l));

          return (
            <div key={chunk.stageId} className="mb-2">
              {/* Stage header */}
              <button
                className={`w-full text-left px-2 py-1 rounded text-[11px] font-semibold uppercase tracking-wider flex items-center gap-2 select-none
                  ${errorInChunk ? 'bg-red-900/20 text-red-400 hover:bg-red-900/30' :
                    warnInChunk ? 'bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/30' :
                    'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'}`}
                onClick={() => toggleChunk(chunk.stageId)}
              >
                <span className="inline-block w-3 text-center">{isFolded ? '▶' : '▼'}</span>
                <span>{chunk.label}</span>
                <span className="text-[10px] opacity-60">({chunk.lines.length})</span>
              </button>

              {/* Lines */}
              {!isFolded && chunk.lines.map((line, i) => {
                globalLineIdx++;
                const idx = globalLineIdx;
                const isError = ERROR_RE.test(line);
                const isWarn = !isError && WARN_RE.test(line);
                const isMatch = searchQuery && line.toLowerCase().includes(searchQuery.toLowerCase());
                return (
                  <div
                    key={`${chunk.stageId}-${i}`}
                    data-log-line={idx}
                    className={
                      `${isError ? 'text-red-400' : isWarn ? 'text-yellow-400' : 'text-text-secondary'}`
                      + (isMatch ? ' bg-yellow-900/20 rounded' : '')
                    }
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
