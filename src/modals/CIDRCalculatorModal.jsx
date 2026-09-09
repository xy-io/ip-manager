import { useState, useEffect, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useModalA11y, parseCIDR } from '../shared/common';

function CIDRCalculatorModal({ onClose }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [input, setInput]   = useState('');
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState('');
  const [copied, setCopied] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const calculate = (val = input) => {
    if (!val.trim()) { setResult(null); setError(''); return; }
    const r = parseCIDR(val);
    if (r) { setResult(r); setError(''); }
    else    { setResult(null); setError('Enter a valid CIDR block — e.g. 192.168.1.0/24'); }
  };

  const handleKey = e => { if (e.key === 'Enter') calculate(); if (e.key === 'Escape') onClose(); };

  const preset = cidr => { setInput(cidr); calculate(cidr); };

  const copyVal = (val, key) => {
    navigator.clipboard.writeText(val).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  const Row = ({ label, value, k }) => (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 group">
      <span className="text-xs text-slate-500 w-36 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-sm text-slate-800 truncate">{value}</span>
        <button onClick={() => copyVal(value, k)}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-slate-600 transition-all flex-shrink-0">
          {copied === k ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );

  const PRESETS = ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','192.168.1.0/24','192.168.1.0/28','10.0.0.0/30'];

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="CIDR calculator" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800">CIDR Calculator</h2>
            <p className="text-sm text-slate-500 mt-0.5">Subnet maths — no need to leave the app</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">CIDR Block</label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => { setInput(e.target.value); if (result || error) calculate(e.target.value); }}
                onKeyDown={handleKey}
                placeholder="192.168.1.0/24"
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm font-mono"
              />
              <button onClick={() => calculate()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                Calculate
              </button>
            </div>
            {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
          </div>

          {/* Quick presets */}
          <div>
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-2">Common blocks</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p} onClick={() => preset(p)}
                  className="px-2.5 py-1 text-xs font-mono bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 rounded-md border border-slate-200 hover:border-indigo-300 transition-colors">
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              {/* Summary bar */}
              <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-mono font-bold text-indigo-700 text-lg">{result.cidr}</p>
                  <p className="text-xs text-indigo-500 mt-0.5">
                    {result.usableHosts.toLocaleString()} usable hosts · Class {result.ipClass}
                  </p>
                </div>
                <button onClick={() => copyVal(result.cidr, 'cidr')}
                  className="p-2 hover:bg-indigo-100 rounded-lg transition-colors text-indigo-400 hover:text-indigo-600">
                  {copied === 'cidr' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <div className="px-4 divide-y divide-slate-100">
                <Row label="Network address"   value={result.network}     k="network" />
                <Row label="Broadcast address" value={result.broadcast}   k="bcast" />
                <Row label="First usable"      value={result.firstUsable} k="first" />
                <Row label="Last usable"       value={result.lastUsable}  k="last" />
                <Row label="Subnet mask"       value={result.subnetMask}  k="mask" />
                <Row label="Wildcard mask"     value={result.wildcardMask} k="wild" />
                <Row label="Total addresses"   value={result.totalHosts.toLocaleString()} k="total" />
                <Row label="Usable hosts"      value={result.usableHosts.toLocaleString()} k="usable" />
                <Row label="Next network"      value={result.nextNetwork} k="next" />
                <Row label="Binary"            value={result.binary}      k="bin" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── QR Code Modal ─────────────────────────────────────────────────────────────

export default CIDRCalculatorModal;
