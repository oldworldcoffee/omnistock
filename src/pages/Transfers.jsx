import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Plus, ArrowLeftRight, CheckCircle, Eye, Search, ShoppingCart, Package, Trash2, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';

export default function Transfers() {
  const { canAccessLocation } = useAuth();
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [newDialog, setNewDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState(null);
  const [form, setForm] = useState({ from_location_id: '', to_location_id: '', items: [], notes: '' });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const isMobile = useIsMobile();

  const [allLocations, setAllLocations] = useState([]);

  const [companyId, setCompanyId] = useState('');

  const load = () => Promise.all([
    base44.entities.Location.list(),
    base44.entities.InventoryItem.filter({ is_active: true }),
    base44.entities.LocationInventory.list(),
    base44.entities.Transfer.list('-created_date', 50),
  ]).then(([locs, itms, linv, trans]) => {
    const accessibleLocs = locs.filter(l => canAccessLocation(l.id));
    const accessibleLocIds = new Set(accessibleLocs.map(l => l.id));
    setAllLocations(locs); // all locations for form dropdowns
    setLocations(accessibleLocs); // only accessible for display/names
    setCompanyId(locs[0]?.company_id || ''); // Get company ID from first location
    setItems(itms);
    setLocInv(linv);
    // Filter history to only show transfers involving the user's locations
    setTransfers(trans.filter(t => accessibleLocIds.has(t.from_location_id) || accessibleLocIds.has(t.to_location_id)));
    setLoading(false);
  });

  useEffect(() => { load(); }, []);

  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))];
  const cartItemIds = new Set(form.items.map(c => c.item_id));

  const filteredItems = items.filter(item => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !(item.category || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    return true;
  });

  const addToCart = (item) => {
    const existing = form.items.find(i => i.item_id === item.id);
    if (existing) {
      updateItemQty(form.items.indexOf(existing), existing.quantity + 1);
    } else {
      setForm(f => ({
        ...f,
        items: [...f.items, {
          item_id: item.id,
          item_name: item.name,
          unit_of_measure: item.unit_of_measure,
          quantity: 1
        }]
      }));
    }
  };

  const updateItemQty = (idx, val) => {
    setForm(prev => {
      const its = [...prev.items];
      its[idx] = { ...its[idx], quantity: Math.max(0, parseFloat(val) || 0) };
      return { ...prev, items: its };
    });
  };

  const updateItemQtyInput = (idx, val) => {
    const num = Math.max(0, parseFloat(val) || 0);
    setForm(prev => {
      const its = [...prev.items];
      its[idx] = { ...its[idx], quantity: num };
      return { ...prev, items: its };
    });
  };

  const removeItem = (idx) => {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const submitTransfer = async (immediate = false) => {
    // Validate no negative quantities
    if (form.items.some(i => i.quantity < 0 || isNaN(i.quantity))) {
      alert('Quantities cannot be negative');
      return;
    }
    const transfer = await base44.entities.Transfer.create({
      company_id: companyId,
      ...form,
      status: immediate ? 'received' : 'in_transit',
      transfer_number: `TR-${Date.now().toString().slice(-6)}`,
      dispatched_at: new Date().toISOString(),
      received_at: immediate ? new Date().toISOString() : null,
    });
    // Deduct from source
    for (const item of form.items) {
      const li = locInv.find(l => l.location_id === form.from_location_id && l.item_id === item.item_id);
      if (li) {
        const newQty = Math.max(0, (li.on_hand_quantity || 0) - item.quantity);
        await base44.entities.LocationInventory.update(li.id, { ...li, on_hand_quantity: newQty });
      }
    }
    // If immediate, add to destination
    if (immediate) {
      for (const item of form.items) {
        const li = locInv.find(l => l.location_id === form.to_location_id && l.item_id === item.item_id);
        const newQty = (li?.on_hand_quantity || 0) + item.quantity;
        if (li) await base44.entities.LocationInventory.update(li.id, { ...li, on_hand_quantity: newQty });
        else await base44.entities.LocationInventory.create({ company_id: companyId, location_id: form.to_location_id, item_id: item.item_id, on_hand_quantity: newQty, par_level: 0, reorder_point: 0 });
      }
    }
    await load();
    setNewDialog(false);
    setForm({ from_location_id: '', to_location_id: '', items: [], notes: '' });
  };

  const receiveTransfer = async (transfer) => {
    await base44.entities.Transfer.update(transfer.id, { status: 'received', received_at: new Date().toISOString() });
    // Add to destination
    for (const item of (transfer.items || [])) {
      const li = locInv.find(l => l.location_id === transfer.to_location_id && l.item_id === item.item_id);
      const newQty = (li?.on_hand_quantity || 0) + item.quantity;
      if (li) await base44.entities.LocationInventory.update(li.id, { ...li, on_hand_quantity: newQty });
      else await base44.entities.LocationInventory.create({ company_id: companyId, location_id: transfer.to_location_id, item_id: item.item_id, on_hand_quantity: newQty, par_level: 0, reorder_point: 0 });
    }
    await load();
    setViewDialog(null);
  };

  const locName = (id) => allLocations.find(l => l.id === id)?.name || locations.find(l => l.id === id)?.name || '—';

  return (
    <div className={isMobile ? "p-3 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Transfers"
        subtitle="Move inventory between locations"
        actions={<Button onClick={() => setNewDialog(true)} className={isMobile ? "text-xs px-2 py-1 h-8" : ""}><Plus className={isMobile ? "w-3 h-3 mr-1" : "w-4 h-4 mr-1"} />New Transfer</Button>}
      />

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : isMobile ? (
        <div className="space-y-3">
          {transfers.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">No transfers yet.</div>
          ) : transfers.map(t => (
            <div key={t.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm font-mono">{t.transfer_number}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(t.created_date), 'MMM d, h:mm a')}</p>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground block">From</span><span className="font-medium">{locName(t.from_location_id)}</span></div>
                <div><span className="text-muted-foreground block">To</span><span className="font-medium">{locName(t.to_location_id)}</span></div>
                <div><span className="text-muted-foreground block">Items</span><span className="font-medium">{t.items?.length || 0}</span></div>
              </div>
              <div className="flex gap-2 pt-1 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1 h-9" onClick={() => setViewDialog(t)}>
                  <Eye className="w-4 h-4 mr-1" />View
                </Button>
                {t.status === 'in_transit' && (
                  <Button size="sm" className="flex-1 h-9 text-white bg-green-600 hover:bg-green-700" onClick={() => receiveTransfer(t)}>
                    <CheckCircle className="w-4 h-4 mr-1" />Receive
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Transfer #', 'From', 'To', 'Items', 'Status', 'Date', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfers.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No transfers yet.</td></tr>
              ) : transfers.map(t => (
                <tr key={t.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium font-mono">{t.transfer_number}</td>
                  <td className="px-4 py-3">{locName(t.from_location_id)}</td>
                  <td className="px-4 py-3">{locName(t.to_location_id)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{t.items?.length || 0}</td>
                  <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(t.created_date), 'MMM d, h:mm a')}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDialog(t)}><Eye className="w-3.5 h-3.5" /></Button>
                      {t.status === 'in_transit' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => receiveTransfer(t)}><CheckCircle className="w-3.5 h-3.5" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New Transfer Dialog */}
      <Dialog open={newDialog} onOpenChange={setNewDialog}>
        <DialogContent className={isMobile ? "max-w-full max-h-[90vh] overflow-y-auto mx-2" : "max-w-5xl max-h-[90vh] overflow-y-auto"}>
          <DialogHeader><DialogTitle>New Transfer</DialogTitle></DialogHeader>
          <div className={isMobile ? "space-y-3 py-2" : "space-y-4 py-2"}>
            <div className={isMobile ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-4"}>
              <div>
                <Label>From Location *</Label>
                <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.from_location_id} onChange={e => setForm(f => ({ ...f, from_location_id: e.target.value }))}>
                  <option value="">Select...</option>
                  {allLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <Label>To Location *</Label>
                <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.to_location_id} onChange={e => setForm(f => ({ ...f, to_location_id: e.target.value }))}>
                  <option value="">Select...</option>
                  {allLocations.filter(l => l.id !== form.from_location_id).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            </div>

            <div className={isMobile ? "flex flex-col gap-4 h-auto" : "flex gap-4 h-[500px]"}>
              {/* LEFT: Catalog */}
              <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border bg-muted/30 space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-8 h-8 text-sm"
                        placeholder="Search items..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        onClick={() => setCategoryFilter(cat)}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                          categoryFilter === cat
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {cat === 'all' ? 'All' : cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                  {filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                      <Package className="w-8 h-8 opacity-40" />
                      <p className="text-sm">No items match your filters</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredItems.map(item => {
                        const inCart = cartItemIds.has(item.id);
                        return (
                          <div
                            key={item.id}
                            className={`rounded-lg border p-3 flex flex-col gap-2 transition-all ${
                              inCart ? 'border-primary/50 bg-primary/5' : 'border-border bg-background hover:border-primary/30'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-1">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium leading-tight truncate">{item.name}</p>
                                {item.category && <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>}
                              </div>
                              {inCart && (
                                <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shrink-0">In cart</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{item.unit_of_measure}</span>
                            </div>
                            <Button
                              size="sm"
                              variant={inCart ? 'secondary' : 'default'}
                              className="w-full h-7 text-xs"
                              onClick={() => addToCart(item)}
                            >
                              <Plus className="w-3 h-3 mr-1" />{inCart ? 'Add more' : 'Add to transfer'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT: Cart */}
              <div className={isMobile ? "w-full flex flex-col bg-card border border-border rounded-xl overflow-hidden" : "w-80 flex flex-col bg-card border border-border rounded-xl overflow-hidden"}>
                <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm">Transfer Cart</span>
                    {form.items.length > 0 && (
                      <span className="bg-primary text-primary-foreground rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">
                        {form.items.length}
                      </span>
                    )}
                  </div>
                  {form.items.length > 0 && (
                    <button onClick={() => setForm(f => ({ ...f, items: [] }))} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                      Clear all
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto">
                  {form.items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-6">
                      <ShoppingCart className="w-10 h-10 opacity-20" />
                      <div className="text-center">
                        <p className="text-sm font-medium">Cart is empty</p>
                        <p className="text-xs mt-1">Add items from the catalog</p>
                      </div>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {form.items.map((item, idx) => (
                        <div key={item.item_id} className="p-3 flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-tight truncate">{item.item_name}</p>
                              <p className="text-xs text-muted-foreground">{item.unit_of_measure}</p>
                            </div>
                            <button
                              onClick={() => removeItem(idx)}
                              className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => updateItemQty(idx, item.quantity - 1)}
                                className="w-6 h-6 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input
                                type="number"
                                min="0"
                                value={item.quantity}
                                onChange={e => updateItemQtyInput(idx, e.target.value)}
                                className="w-12 h-6 text-center text-xs border border-input rounded bg-background"
                              />
                              <button
                                onClick={() => updateItemQty(idx, item.quantity + 1)}
                                className="w-6 h-6 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors"
                              >
                                <Plus className="w-3 h-3" />
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

            <div>
              <Label>Notes</Label>
              <Input className="mt-1" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDialog(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => submitTransfer(true)} disabled={!form.from_location_id || !form.to_location_id || form.items.length === 0}>
              <CheckCircle className="w-4 h-4 mr-1" />Send & Add to Stock
            </Button>
            <Button onClick={() => submitTransfer(false)} disabled={!form.from_location_id || !form.to_location_id || form.items.length === 0}>
              <ArrowLeftRight className="w-4 h-4 mr-1" />Send Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
        <DialogContent className={isMobile ? "max-w-full max-h-[90vh] overflow-y-auto mx-2" : "max-w-lg"}>
          <DialogHeader><DialogTitle>Transfer {viewDialog?.transfer_number}</DialogTitle></DialogHeader>
          {viewDialog && (
            <div className={isMobile ? "space-y-3 py-2 text-sm" : "space-y-3 py-2 text-sm"}>
              <div className={isMobile ? "grid grid-cols-1 gap-2" : "grid grid-cols-2 gap-2"}>
                <div><span className="text-muted-foreground">From:</span> <span className="font-medium">{locName(viewDialog.from_location_id)}</span></div>
                <div><span className="text-muted-foreground">To:</span> <span className="font-medium">{locName(viewDialog.to_location_id)}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewDialog.status} /></div>
                {viewDialog.notes && <div className={isMobile ? "col-span-1" : "col-span-2"}><span className="text-muted-foreground">Notes:</span> {viewDialog.notes}</div>}
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>{['Item', 'Qty', 'UOM'].map(h => <th key={h} className={`text-left ${isMobile ? 'px-2 py-2' : 'px-3 py-2'} text-xs font-medium text-muted-foreground`}>{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {viewDialog.items?.map((item, i) => (
                      <tr key={i}>
                        <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-3 py-2'}`}>{item.item_name}</td>
                        <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-3 py-2'}`}>{item.quantity}</td>
                        <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-3 py-2'} text-muted-foreground`}>{item.unit_of_measure}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {viewDialog.status === 'in_transit' && (
                <Button className="w-full" onClick={() => receiveTransfer(viewDialog)}>
                  <CheckCircle className={isMobile ? "w-3 h-3 mr-1" : "w-4 h-4 mr-1"} />Confirm Receipt & Update Stock
                </Button>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setViewDialog(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}