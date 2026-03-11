"use client";

import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { apiClient } from "@/lib/api-client";
import { showToast } from "@/components/toast";

interface IntegrationItem {
  id: string;
  name: string;
  type: string;
  modifiedTime?: string;
}

interface IntegrationPickerProps {
  integrationId: string;
  integrationType: 'google_drive' | 'notion';
  onClose: () => void;
  onSaved: () => void;
}

const MODAL_OVERLAY = "fixed inset-0 bg-black/40 dark:bg-background/60 backdrop-blur-sm z-50 flex items-center justify-center p-4";

export function IntegrationPicker({ integrationId, integrationType, onClose, onSaved }: IntegrationPickerProps) {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const { getToken } = useAuth();

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const data = await apiClient.getIntegrationItems(token, integrationId);
        setItems(data.items || []);
        setSelected(new Set(data.selectedItems || []));
      } catch (e: any) {
        showToast(e.message || 'Failed to load items', 'error');
      } finally { setLoading(false); }
    })();
  }, [integrationId, getToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const filtered = filteredItems;
    const allSelected = filtered.every(i => selected.has(i.id));
    setSelected(prev => {
      const next = new Set(prev);
      filtered.forEach(i => allSelected ? next.delete(i.id) : next.add(i.id));
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.saveIntegrationItems(token, integrationId, Array.from(selected));
      showToast(`${selected.size} item(s, 'success') selected for sync`);
      onSaved();
    } catch (e: any) {
      showToast(e.message || 'Failed to save', 'error');
    } finally { setSaving(false); }
  };

  const handleSaveAndSync = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      await apiClient.saveIntegrationItems(token, integrationId, Array.from(selected));
      await apiClient.syncIntegration(token, integrationId);
      showToast('Sync started', 'success');
      onSaved();
    } catch (e: any) {
      showToast(e.message || 'Failed', 'error');
    } finally { setSaving(false); }
  };

  const filteredItems = search
    ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const label = integrationType === 'google_drive' ? 'Google Drive' : 'Notion';
  const itemLabel = integrationType === 'google_drive' ? 'files' : 'pages';

  return (
    <div className={MODAL_OVERLAY} onClick={onClose}>
      <div className="box-modal w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-border/60 shrink-0">
          <h2 className="text-base font-medium">{label} — Select {itemLabel}</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which {itemLabel} to import as knowledge sources.
          </p>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Filter ${itemLabel}…`}
            className="w-full px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:ring-2 focus:ring-gray-300 dark:focus:ring-gray-600 placeholder:text-muted-foreground"
          />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground animate-pulse">Loading {itemLabel}…</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? 'No matches' : `No ${itemLabel} found`}
            </div>
          ) : (
            <div className="space-y-1">
              {/* Select all */}
              <button onClick={toggleAll}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:bg-muted/40 transition-colors">
                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  filteredItems.every(i => selected.has(i.id))
                    ? 'bg-foreground border-foreground'
                    : 'border-border'
                }`}>
                  {filteredItems.every(i => selected.has(i.id)) && (
                    <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />
                  )}
                </div>
                Select all ({filteredItems.length})
              </button>

              {filteredItems.map(item => (
                <button key={item.id} onClick={() => toggle(item.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/40 transition-colors text-left group">
                  <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    selected.has(item.id)
                      ? 'bg-foreground border-foreground'
                      : 'border-border group-hover:border-foreground/40'
                  }`}>
                    {selected.has(item.id) && (
                      <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm truncate block">{item.name}</span>
                    {item.modifiedTime && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(item.modifiedTime).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border/60 shrink-0 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost-sm px-4">Cancel</button>
            <button onClick={handleSaveAndSync} disabled={saving || selected.size === 0}
              className="text-xs px-4 py-2 rounded-xl bg-foreground text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity">
              {saving ? 'Syncing…' : `Sync ${selected.size} ${itemLabel}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
