export function DbCylinderIcon({ className = 'w-3.5 h-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M2.5 4.5v7c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5v-7"
        fill="#0284c7"
        fillOpacity="0.25"
        stroke="#38bdf8"
        strokeWidth="1.2"
      />
      <path
        d="M2.5 8c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5"
        stroke="#38bdf8"
        strokeWidth="1.2"
      />
      <ellipse
        cx="8"
        cy="4.5"
        rx="5.5"
        ry="2.2"
        fill="#0369a1"
        fillOpacity="0.35"
        stroke="#38bdf8"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function DBeaverFolderIcon({
  className = 'w-3.5 h-3.5 shrink-0',
  open = false,
}: {
  className?: string;
  open?: boolean;
}) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3l1.5 1.5H13c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7z"
        fill="#f59e0b"
        fillOpacity="0.95"
      />
      {open ? (
        <path
          d="M1.5 6.5h13l-1.5 6h-10l-1.5-6z"
          fill="#fbbf24"
          stroke="#d97706"
          strokeWidth="0.8"
        />
      ) : (
        <path
          d="M2.5 6h11v5.5a1 1 0 01-1 1h-9a1 1 0 01-1-1V6z"
          fill="#d97706"
          fillOpacity="0.6"
        />
      )}
    </svg>
  );
}

export function DBeaverTableIcon({ className = 'w-3.5 h-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        stroke="#38bdf8"
        strokeWidth="1.2"
        fill="#0284c7"
        fillOpacity="0.18"
      />
      <path d="M1.5 5.5h13" stroke="#38bdf8" strokeWidth="1.2" />
      <path d="M6 5.5v8.5" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.85" />
      <path d="M10.5 5.5v8.5" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.85" />
      <path d="M1.5 9.5h13" stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.5" />
    </svg>
  );
}

export function DBeaverForeignTableIcon({ className = 'w-3.5 h-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        stroke="#38bdf8"
        strokeWidth="1.2"
        fill="#0284c7"
        fillOpacity="0.15"
      />
      <path d="M1.5 5.5h13" stroke="#38bdf8" strokeWidth="1.2" />
      {/* Foreign link chain badge */}
      <circle cx="11.5" cy="11.5" r="3.5" fill="#0284c7" stroke="#38bdf8" strokeWidth="1" />
      <path d="M10 11.5h3" stroke="#ffffff" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function DBeaverViewIcon({ className = 'w-3.5 h-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        stroke="#38bdf8"
        strokeWidth="1.2"
        fill="#0284c7"
        fillOpacity="0.15"
      />
      <path d="M1.5 5.5h13" stroke="#38bdf8" strokeWidth="1.2" />
      {/* Eye badge */}
      <ellipse cx="8" cy="9.5" rx="3.5" ry="2" stroke="#38bdf8" strokeWidth="1" fill="#0284c7" fillOpacity="0.4" />
      <circle cx="8" cy="9.5" r="1.1" fill="#38bdf8" />
    </svg>
  );
}

export function DBeaverMatViewIcon({ className = 'w-3.5 h-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        stroke="#f59e0b"
        strokeWidth="1.2"
        fill="#b45309"
        fillOpacity="0.2"
      />
      <path d="M1.5 5.5h13" stroke="#f59e0b" strokeWidth="1.2" />
      {/* Eye badge with solid status */}
      <ellipse cx="7" cy="9.5" rx="3" ry="1.8" stroke="#f59e0b" strokeWidth="1" fill="#b45309" fillOpacity="0.4" />
      <circle cx="7" cy="9.5" r="1" fill="#fbbf24" />
      <circle cx="12" cy="11.5" r="2.5" fill="#10b981" stroke="#ffffff" strokeWidth="0.8" />
    </svg>
  );
}

export function DBeaverFolderBranchIcon({
  kind,
  open = false,
  className = 'w-3.5 h-3.5 shrink-0',
}: {
  kind: 'tables' | 'foreignTables' | 'views' | 'materializedViews';
  open?: boolean;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M1.5 3.5C1.5 2.67 2.17 2 3 2h3l1.5 1.5H13c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5v-7z"
        fill="#f59e0b"
        fillOpacity="0.95"
      />
      {open ? (
        <path d="M1.5 6.5h13l-1.5 6h-10l-1.5-6z" fill="#fbbf24" stroke="#d97706" strokeWidth="0.8" />
      ) : (
        <path d="M2.5 6h11v5.5a1 1 0 01-1 1h-9a1 1 0 01-1-1V6z" fill="#d97706" fillOpacity="0.75" />
      )}

      {kind === 'tables' && (
        <g stroke="#ffffff" strokeWidth="0.9" opacity="0.95">
          <rect x="4.5" y="7" width="7" height="4.5" rx="0.5" fill="#f59e0b" fillOpacity="0.3" />
          <line x1="4.5" y1="8.5" x2="11.5" y2="8.5" />
          <line x1="8" y1="7" x2="8" y2="11.5" />
        </g>
      )}

      {kind === 'foreignTables' && (
        <g stroke="#ffffff" strokeWidth="1" strokeLinecap="round" opacity="0.95">
          <path d="M5 9.5a1.2 1.2 0 010-1.7l1-1a1.2 1.2 0 011.7 0" />
          <path d="M11 8.5a1.2 1.2 0 010 1.7l-1 1a1.2 1.2 0 01-1.7 0" />
          <line x1="6.5" y1="9" x2="9.5" y2="9" />
        </g>
      )}

      {kind === 'views' && (
        <g stroke="#ffffff" strokeWidth="0.9" fill="none" opacity="0.95">
          <ellipse cx="8" cy="9.2" rx="3.5" ry="2" />
          <circle cx="8" cy="9.2" r="1.1" fill="#ffffff" />
        </g>
      )}

      {kind === 'materializedViews' && (
        <g stroke="#ffffff" strokeWidth="0.9" fill="none" opacity="0.95">
          <ellipse cx="7.2" cy="8.8" rx="3.2" ry="1.8" />
          <circle cx="7.2" cy="8.8" r="1" fill="#ffffff" />
          <circle cx="11.5" cy="11.5" r="1.5" fill="#10b981" stroke="#ffffff" strokeWidth="0.7" />
        </g>
      )}
    </svg>
  );
}
