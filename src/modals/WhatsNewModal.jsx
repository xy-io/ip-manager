import { useState } from 'react';
import { X } from 'lucide-react';

// Render **bold** and `code` as React elements rather than HTML.
//
// The obvious implementation is dangerouslySetInnerHTML with a couple of
// regex replacements, which would turn the release notes into an injection
// point. Producing elements means the text can never be interpreted as markup,
// whatever ends up in the file.
function inline(text, keyPrefix) {
  const parts = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-slate-800">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      parts.push(
        <code key={`${keyPrefix}-c${i}`} className="font-mono text-[0.9em] bg-slate-100 text-slate-700 rounded px-1 py-0.5">
          {token.slice(1, -1)}
        </code>
      );
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Shown once after an update. Deliberately modest: a summary and a way out,
 * not a changelog. The checkbox is honoured permanently, and can be undone
 * from Settings → Updates so it is not a one-way door.
 */
export default function WhatsNewModal({ releases = [], onClose }) {
  const [suppress, setSuppress] = useState(false);

  const dismiss = () => onClose(suppress);

  return (
    <div role="dialog" aria-modal="true" aria-label="What's new" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 outline-none"
         onClick={dismiss}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
           onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">What&rsquo;s new</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {releases.length === 1
                ? `Updated to v${releases[0].version}`
                : `${releases.length} updates since you were last here`}
            </p>
          </div>
          <button onClick={dismiss} aria-label="Close"
                  className="p-2 -mr-2 -mt-1 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
          {releases.map((release) => (
            <div key={release.version}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                  v{release.version}
                </span>
                <h3 className="text-sm font-semibold text-slate-800">{release.title}</h3>
              </div>
              {release.paragraphs.map((paragraph, i) => (
                <p key={i} className="text-sm text-slate-600 leading-relaxed mb-2">
                  {inline(paragraph, `${release.version}-${i}`)}
                </p>
              ))}
            </div>
          ))}

          {releases.length === 0 && (
            <p className="text-sm text-slate-400 italic">No release notes to show.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={suppress} onChange={e => setSuppress(e.target.checked)}
                   className="rounded border-slate-300" />
            Don&rsquo;t show this again
          </label>
          <button onClick={dismiss}
                  className="px-4 py-1.5 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-900 transition-colors">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
