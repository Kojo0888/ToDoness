import { t } from '../../app/strings';

/** The search box of the note pages (docs/notes/PRD.md FR-103 – FR-105). */
export function NoteSearch({
  value,
  onChange,
  shown,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  shown: number;
  total: number;
}) {
  const active = value.trim() !== '';
  return (
    <div className="note-search">
      <input
        type="search"
        aria-label={t.notes.search}
        placeholder={t.notes.searchPlaceholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onChange('');
          }
        }}
      />
      {active && (
        <p className="hint" role="status">
          {shown === 0 ? t.notes.noMatches : t.notes.matches(shown, total)}{' '}
          <button type="button" className="link" onClick={() => onChange('')}>
            {t.notes.clearSearch}
          </button>
        </p>
      )}
    </div>
  );
}
