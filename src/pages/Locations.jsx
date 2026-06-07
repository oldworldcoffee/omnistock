import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Plus, Pencil, Trash2, MapPin, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';

const EMPTY = { name: '', type: 'location', business_name: '', address: '', phone: '', email: '', is_active: true, preferred_stock_weeks: 2 };

export default function Locations() {
  const { user, canAccessLocation, companyId } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [locations, setLocations] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => base44.entities.Location.filter({ company_id: companyId }).then(l => { setLocations(l); setLoading(false); });
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(EMPTY); setDialog(true); };
  const openEdit = (l) => { setEditing(l); setForm({ ...l }); setDialog(true); };

  const save = async () => {
    setSaving(true);
    if (editing) await base44.entities.Location.update(editing.id, form);
    else await base44.entities.Location.create({ ...form, company_id: companyId });
    await load();
    setDialog(false);
    setSaving(false);
  };

  const remove = async (id) => {
    if (!confirm('Delete this location?')) return;
    await base44.entities.Location.delete(id);
    setLocations(prev => prev.filter(l => l.id !== id));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Locations"
        subtitle="Manage your stores, restaurants, and commissary"
        actions={isAdmin && <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add Location</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : locations.length === 0 ? (
          <div className="col-span-3 text-center text-muted-foreground py-8">No locations yet. Add your first location to get started.</div>
        ) : locations.map(loc => (
          <div key={loc.id} className={`bg-card border rounded-xl p-5 ${loc.type === 'commissary' ? 'border-purple-200' : 'border-border'}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${loc.type === 'commissary' ? 'bg-purple-100' : 'bg-primary/10'}`}>
                  {loc.type === 'commissary' ? <Store className="w-4 h-4 text-purple-600" /> : <MapPin className="w-4 h-4 text-primary" />}
                </div>
                <div>
                  <p className="font-semibold text-sm">{loc.business_name ? loc.business_name + ' - ' : ''}{loc.name}</p>
                  <StatusBadge status={loc.type} />
                </div>
              </div>
              {isAdmin && canAccessLocation(loc.id) && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(loc)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(loc.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              )}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {loc.address && <p>📍 {loc.address}</p>}
              {loc.phone && <p>📞 {loc.phone}</p>}
              {loc.email && <p>📧 {loc.email}</p>}
              <p className="pt-1 border-t border-border">{loc.is_active ? '✅ Active' : '⏸ Inactive'}</p>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Edit Location' : 'Add Location'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Location Name *</Label><Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Business Name</Label><Input className="mt-1" value={form.business_name} onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))} placeholder="e.g., Old World Coffee Roasters" /></div>
            <div>
              <Label>Type</Label>
              <div className="mt-1 flex gap-2">
                {['location', 'commissary'].map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${form.type === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
                    {t === 'location' ? 'Location/Store' : 'Commissary'}
                  </button>
                ))}
              </div>
            </div>
            <div><Label>Address</Label><Input className="mt-1" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input className="mt-1" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>Email</Label><Input className="mt-1" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
            <div>
              <Label>Preferred Stock Buffer (weeks)</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={form.preferred_stock_weeks || 2}
                onChange={e => setForm(f => ({ ...f, preferred_stock_weeks: parseInt(e.target.value) }))}
              >
                <option value={1}>1 week</option>
                <option value={2}>2 weeks</option>
                <option value={3}>3 weeks</option>
                <option value={4}>4 weeks</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">AI will calculate par levels to maintain this many weeks of stock</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving...' : 'Save Location'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}