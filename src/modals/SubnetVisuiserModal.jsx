import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '../shared/common';

function SubnetVisuiserModal({ network, ipData, onClose }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [blocks, setBlocks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: '', color: '#6366f1', start: '', end: '' });

  useEffect(() => {
    fetch(`/api/subnet-blocks?network=${encodeURIComponent(network.id)}`)
      .then(r => r.json())
      .then(d => setBlocks(Array.isArray(d.blocks) ? d.blocks : []))
      .catch(() => setBlocks([]));
  }, [network.id]);

  const saveBlocks = async (updated) => {
    setSaving(true);
    try {
      await fetch(`/api/subnet-blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkId: network.id, blocks: updated }),
      });
      setBlocks(updated);
    } catch {}
    setSaving(false);
  };

  const addBlock = () => {
    const s = parseInt(draft.start, 10);
    const e = parseInt(draft.end, 10);
    if (!draft.name || isNaN(s) || isNaN(e) || s > e || s < 0 || e > 255) return;
    saveBlocks([...blocks, { name: draft.name, color: draft.color, start: s, end: e }]);
    setDraft({ name: '', color: '#6366f1', start: '', end: '' });
  };

  const removeBlock = (idx) => saveBlocks(blocks.filter((_, i) => i !== idx));

  // Build lookup: last octet → status
  const subnet = network.subnet;
  const usedMap = {};
  (ipData || []).forEach(item => {
    const last = parseInt(item.ip.split('.')[3], 10);
    if (!isNaN(last)) {
      if (item.assetName === 'Free') usedMap[last] = 'free';
      else if (item.assetName === 'Reserved') usedMap[last] = 'reserved';
      else usedMap[last] = 'assigned';
    }
  });

  const dhcpStart  = network.dhcpStart  || 1;
  const dhcpEnd    = network.dhcpEnd    || 100;
  const staticStart = network.staticStart || 101;
  const staticEnd   = network.staticEnd   || 254;

  // Usage counts
  const staticTotal    = Math.max(0, staticEnd - staticStart + 1);
  const staticAssigned = Object.entries(usedMap).filter(([k, v]) => {
    const n = parseInt(k, 10); return v === 'assigned' && n >= staticStart && n <= staticEnd;
  }).length;
  const staticFree = staticTotal - staticAssigned;
  const dhcpTotal  = Math.max(0, dhcpEnd - dhcpStart + 1);

  const getCellColor = (i) => {
    let blockColor = null;
    for (const b of blocks) { if (i >= b.start && i <= b.end) blockColor = b.color; }
    if (blockColor) return blockColor;
    const status = usedMap[i];
    if (status === 'assigned') return '#10b981';
    if (status === 'reserved') return '#f59e0b';
    if (i >= dhcpStart && i <= dhcpEnd) return '#e2e8f0';
    if (i >= staticStart && i <= staticEnd) return status === 'free' ? '#d1fae5' : '#10b981';
    return '#f1f5f9';
  };

  const getCellTitle = (i) => {
    const ip = `${subnet}.${i}`;
    const block = [...blocks].reverse().find(b => i >= b.start && i <= b.end);
    const status = usedMap[i];
    const entry = (ipData || []).find(d => d.ip === ip);
    const parts = [];
    if (entry && entry.assetName && entry.assetName !== 'Free') parts.push(entry.assetName);
    parts.push(ip);
    if (block) parts.push(`[${block.name}]`);
    if (i >= dhcpStart && i <= dhcpEnd) parts.push('DHCP pool');
    else if (i >= staticStart && i <= staticEnd) parts.push(status === 'free' ? 'Free static' : 'Static');
    return parts.join(' · ');
  };

  // Detect rows that straddle the DHCP→static boundary for the divider line
  const boundaryRow = Math.floor(staticStart / 16); // first row that contains a static address

  const BLOCK_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Subnet visualiser" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Subnet Visualiser</h2>
            <p className="text-sm text-slate-500 mt-0.5">{network.networkName} · {network.subnet}.0/{network.prefixLen || 24}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5">
          {/* Usage summary */}
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 flex-shrink-0" />
              <span className="text-xs font-medium text-emerald-700">
                {staticAssigned} / {staticTotal} static assigned
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-300 flex-shrink-0" />
              <span className="text-xs font-medium text-slate-600">
                {dhcpTotal} DHCP pool (.{dhcpStart}–.{dhcpEnd})
              </span>
            </div>
            {staticFree > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-100 rounded-lg">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-200 flex-shrink-0" />
                <span className="text-xs font-medium text-emerald-600">{staticFree} free</span>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> Assigned</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-200" /> Free static</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-slate-200" /> DHCP pool</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-amber-400" /> Reserved</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-slate-100 border border-slate-200" /> Outside range</span>
            {blocks.map((b, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{background: b.color}} />
                {b.name}
              </span>
            ))}
          </div>

          {/* Grid with row labels — single CSS grid so labels share exact row height with cells */}
          <div className="mb-5">
            {(() => {
              const cells = [];
              for (let row = 0; row < 16; row++) {
                const isBoundary = row === boundaryRow;
                // Full-width boundary divider inserted as a spanning row
                if (isBoundary) {
                  cells.push(
                    <div
                      key="boundary-line"
                      style={{gridColumn: '1 / -1', position: 'relative', height: '10px'}}
                      className="flex items-center"
                    >
                      <div className="flex-1 border-t-2 border-dashed border-indigo-300" />
                      <span className="text-xs text-indigo-400 font-medium bg-white pl-1 flex-shrink-0">
                        static .{staticStart}
                      </span>
                    </div>
                  );
                }
                // Row label
                cells.push(
                  <div
                    key={`lbl-${row}`}
                    className="flex items-center justify-end text-xs text-slate-400 font-mono pr-1.5 flex-shrink-0"
                  >
                    .{row * 16}
                  </div>
                );
                // 16 cells
                for (let col = 0; col < 16; col++) {
                  const i = row * 16 + col;
                  cells.push(
                    <div
                      key={i}
                      title={getCellTitle(i)}
                      style={{background: getCellColor(i)}}
                      className="aspect-square rounded-sm cursor-default"
                    />
                  );
                }
              }
              return (
                <div style={{display: 'grid', gridTemplateColumns: 'auto repeat(16, minmax(0, 1fr))', gap: '2px'}}>
                  {cells}
                </div>
              );
            })()}
          </div>

          {/* Planned Blocks */}
          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Planned Blocks</h3>

            {blocks.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {blocks.map((b, idx) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="inline-block w-4 h-4 rounded-sm flex-shrink-0" style={{background: b.color}} />
                    <span className="text-sm font-medium text-slate-700 flex-1">{b.name}</span>
                    <span className="text-xs text-slate-400 font-mono">.{b.start}–.{b.end} ({b.end - b.start + 1} IPs)</span>
                    <button onClick={() => removeBlock(idx)} className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-500 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add block form */}
            <div className="flex gap-2 flex-wrap items-end">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Name</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={e => setDraft({...draft, name: e.target.value})}
                  onKeyDown={e => e.key === 'Enter' && addBlock()}
                  placeholder="e.g., IoT devices"
                  className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-36 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Start (.x)</label>
                <input
                  type="number" min="0" max="255"
                  value={draft.start}
                  onChange={e => setDraft({...draft, start: e.target.value})}
                  placeholder="200"
                  className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-20 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">End (.x)</label>
                <input
                  type="number" min="0" max="255"
                  value={draft.end}
                  onChange={e => setDraft({...draft, end: e.target.value})}
                  placeholder="220"
                  className="px-2 py-1.5 border border-slate-300 rounded-lg text-sm w-20 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Colour</label>
                <div className="flex gap-1">
                  {BLOCK_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setDraft({...draft, color: c})}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${draft.color === c ? 'border-slate-700 scale-110' : 'border-transparent'}`}
                      style={{background: c}} />
                  ))}
                </div>
              </div>
              <button
                onClick={addBlock}
                disabled={saving}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Add block
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Help Modal ────────────────────────────────────────────────────────────────

export default SubnetVisuiserModal;
