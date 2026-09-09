import { useState, useEffect } from 'react';
import { Globe, X, Plus, Trash2, AlertCircle, AlertTriangle, RotateCw } from 'lucide-react';
import { useModalA11y } from '../shared/common';

function DomainsView({ onClose }) {
  const modalRef = useModalA11y(typeof onClose === 'function' ? onClose : null);
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addInput, setAddInput] = useState('');
  const [addError, setAddError] = useState('');
  const [refreshing, setRefreshing] = useState(new Set());

  // Fetch domains on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet('/api/domains');
        if (res && res.data) setDomains(res.data);
      } catch (err) {
        console.error('Failed to fetch domains:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleAddDomain = async () => {
    const domain = addInput.trim();
    if (!domain) { setAddError('Domain cannot be empty'); return; }
    setAddError('');
    try {
      const res = await fetch('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || 'Failed to add domain'); return; }
      setDomains(prev => [...prev, data]);
      setAddInput('');
      setAdding(false);
    } catch (err) {
      setAddError(err.message || 'Failed to add domain');
    }
  };

  const handleDeleteDomain = async (id) => {
    if (!confirm('Delete this domain?')) return;
    try {
      await fetch(`/api/domains/${id}`, { method: 'DELETE' });
      setDomains(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      console.error('Failed to delete domain:', err);
    }
  };

  const handleRefreshDomain = async (id) => {
    setRefreshing(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/domains/${id}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) setDomains(prev => prev.map(d => d.id === id ? data : d));
    } catch (err) {
      console.error('Failed to refresh domain:', err);
    } finally {
      setRefreshing(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const getDaysUntilExpiry = (expiryDate) => {
    if (!expiryDate) return null;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const days = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return days;
  };

  const getExpiryBadgeColor = (days) => {
    if (days === null) return 'bg-slate-100 text-slate-500';
    if (days < 0) return 'bg-red-100 text-red-700';
    if (days < 30) return 'bg-red-100 text-red-700';
    if (days < 60) return 'bg-amber-100 text-amber-700';
    return 'bg-emerald-100 text-emerald-700';
  };

  const getCardBorderColor = (days, hasError) => {
    if (hasError) return 'border-l-amber-400';
    if (days === null) return 'border-l-slate-300';
    if (days < 0) return 'border-l-red-500';
    if (days < 30) return 'border-l-red-400';
    if (days < 60) return 'border-l-amber-400';
    return 'border-l-emerald-400';
  };

  const getExpiryText = (days) => {
    if (days === null) return 'Unknown';
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return 'Expires today';
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  const formatExpiryDate = (isoDate) => {
    if (!isoDate) return null;
    return new Date(isoDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getRelativeTime = (isoDate) => {
    if (!isoDate) return 'Never';
    const date = new Date(isoDate);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const domainsWithExpiry = domains.map(d => ({
    ...d,
    daysUntilExpiry: getDaysUntilExpiry(d.expiry),
  })).sort((a, b) => {
    // Sort by expiry: expired/soon first, then by days remaining
    if (a.daysUntilExpiry === null && b.daysUntilExpiry === null) return 0;
    if (a.daysUntilExpiry === null) return 1;
    if (b.daysUntilExpiry === null) return -1;
    return a.daysUntilExpiry - b.daysUntilExpiry;
  });

  const expiringSoonCount = domainsWithExpiry.filter(
    d => d.daysUntilExpiry !== null && d.daysUntilExpiry <= 30
  ).length;

  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Domain tracker" tabIndex={-1}
         className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 outline-none">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-slate-500" />
            <div>
              <h2 className="text-xl font-bold text-slate-900">Domain Tracker</h2>
              {!loading && domains.length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {domains.length} domain{domains.length !== 1 ? 's' : ''}
                  {expiringSoonCount > 0 && (
                    <span className="ml-2 text-red-600 font-medium">
                      · {expiringSoonCount} expiring within 30 days
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            title="Close (Esc)" aria-label="Close (Esc)">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* Add Domain Form */}
          {adding ? (
            <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="e.g. example.com"
                  value={addInput}
                  onChange={e => setAddInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddDomain()}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  autoFocus
                />
                <button
                  onClick={handleAddDomain}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                >
                  Add
                </button>
                <button
                  onClick={() => { setAdding(false); setAddError(''); setAddInput(''); }}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
              {addError && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 p-2 rounded">
                  <AlertCircle className="w-4 h-4" />
                  {addError}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="mb-6 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Domain
            </button>
          )}

          {/* Loading State */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-slate-500">Loading domains...</div>
            </div>
          ) : domainsWithExpiry.length === 0 ? (
            <div className="text-center py-12">
              <Globe className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No domains tracked yet</p>
              <p className="text-sm text-slate-400 mt-1">Add one to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {domainsWithExpiry.map(domain => (
                <div
                  key={domain.id}
                  className={`bg-white border border-slate-200 border-l-4 rounded-xl overflow-hidden hover:shadow-md transition-shadow ${
                    getCardBorderColor(domain.daysUntilExpiry, !!domain.error)
                  }`}
                >
                  {/* Card header: domain name + expiry badge */}
                  <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 truncate">{domain.domain}</h3>
                      {domain.registrar && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          {domain.registrarUrl ? (
                            <a
                              href={domain.registrarUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-emerald-600 hover:underline"
                            >
                              {domain.registrar}
                            </a>
                          ) : (
                            domain.registrar
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        getExpiryBadgeColor(domain.daysUntilExpiry)
                      }`}>
                        {domain.daysUntilExpiry !== null && domain.daysUntilExpiry < 0 && (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        {getExpiryText(domain.daysUntilExpiry)}
                      </span>
                      {domain.expiry && (
                        <p className="text-xs text-slate-400 mt-1">{formatExpiryDate(domain.expiry)}</p>
                      )}
                    </div>
                  </div>

                  {/* Error state */}
                  {domain.error ? (
                    <div className="mx-4 mb-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-xs text-amber-700 font-medium">Could not fetch RDAP data</span>
                    </div>
                  ) : (
                    /* Nameservers */
                    domain.nameservers && domain.nameservers.length > 0 && (
                      <div className="px-4 pb-3">
                        <div className="flex flex-wrap gap-1">
                          {domain.nameservers.slice(0, 2).map((ns, idx) => (
                            <span
                              key={idx}
                              className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono"
                              title={ns}
                            >
                              {ns.length > 22 ? ns.substring(0, 19) + '…' : ns}
                            </span>
                          ))}
                          {domain.nameservers.length > 2 && (
                            <span className="text-xs text-slate-400 px-1 py-0.5">
                              +{domain.nameservers.length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  )}

                  {/* Footer: last checked + actions */}
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
                    <span>Checked {getRelativeTime(domain.lastChecked)}</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => handleRefreshDomain(domain.id)}
                        disabled={refreshing.has(domain.id)}
                        className={`p-1.5 rounded-lg transition-colors ${
                          refreshing.has(domain.id)
                            ? 'text-slate-300 cursor-not-allowed'
                            : 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                        }`}
                        title="Refresh" aria-label="Refresh">
                        <RotateCw className={`w-3.5 h-3.5 ${refreshing.has(domain.id) ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleDeleteDomain(domain.id)}
                        className="p-1.5 hover:bg-red-100 hover:text-red-500 text-slate-400 rounded-lg transition-colors"
                        title="Delete" aria-label="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Main Component

export default DomainsView;
