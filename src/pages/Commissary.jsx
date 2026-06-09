import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Plus, Store, CheckCircle, Truck, Eye, Package, XCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';
import { toast } from 'sonner';
import FulfillmentDialog from '@/components/commissary/FulfillmentDialog';

export default function Commissary() {
  const { canAccessLocation, getManagedCommissaryLocationIds, companyId } = useAuth();
  const [locations, setLocations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [variants, setVariants] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [orders, setOrders] = useState([]);
  const [fulfillments, setFulfillments] = useState([]);
  const [newOrderDialog, setNewOrderDialog] = useState(false);
  const [viewDialog, setViewDialog] = useState(null);
  const [cartForm, setCartForm] = useState({ location_id: '', items: [] });
  const [fulfillmentDialog, setFulfillmentDialog] = useState(null);
  const [cancelDialog, setCancelDialog] = useState(null);
  const [printDialog, setPrintDialog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('outgoing');
  const [backstockDialog, setBackstockDialog] = useState(null);
  const [backstockNote, setBackstockNote] = useState('');
  const [selectedCommissaryId, setSelectedCommissaryId] = useState('');

  const load = () => Promise.all([
    base44.entities.Location.list(),
    base44.entities.Vendor.filter({ is_commissary: true }),
    base44.entities.InventoryItem.filter({ is_commissary_item: true, is_active: true }),
    base44.entities.ItemVariant.list(),
    base44.entities.LocationInventory.list(),
    base44.entities.Order.filter({ type: 'commissary' }, '-created_date', 50),
    base44.entities.CommissaryFulfillment.list('-fulfillment_date', 50),
  ]).then(([locs, vnds, itms, variants, linv, ords, fuls]) => {
    setLocations(locs.filter(l => canAccessLocation(l.id)));
    setVendors(vnds);
    setItems(itms);
    setVariants(variants);
    setLocInv(linv);
    setOrders(ords);
    setFulfillments(fuls);
    setLoading(false);
  });

  useEffect(() => { 
    load(); 
  }, []);

  // Auto-select commissary if only one managed, else require selection
  const managedCommissaryIds = getManagedCommissaryLocationIds();
  const commissaryLocs = locations.filter(l => l.type === 'commissary' && managedCommissaryIds.includes(l.id));

  useEffect(() => {
    if (commissaryLocs.length === 1 && !selectedCommissaryId) {
      setSelectedCommissaryId(commissaryLocs[0].id);
    }
  }, [commissaryLocs.length]);

  useEffect(() => {
    if (viewDialog) {
      markAsViewed(viewDialog);
    }
  }, [viewDialog]);

  const regularLocs = locations.filter(l => l.type !== 'commissary');

  // Find all vendor IDs that represent this commissary location.
  // Includes: vendors with commissioned_location_id set, AND legacy commissary vendors
  // that share the same name/email (auto-created before the location link existed).
  const commissaryLoc = locations.find(l => l.id === selectedCommissaryId);
  const commissaryVendorIds = selectedCommissaryId
    ? vendors
        .filter(v => v.is_commissary && (
          v.commissioned_location_id === selectedCommissaryId ||
          // Legacy match: same email or name as the commissary location
          (commissaryLoc && (v.email === commissaryLoc.email || v.name === commissaryLoc.name))
        ))
        .map(v => v.id)
    : [];

  // Filter orders/fulfillments to selected commissary — show empty state if none selected
  // Include orders without vendor_id (direct commissary orders)
  const filteredOrders = selectedCommissaryId
    ? orders.filter(o => 
        o.type === 'commissary' && 
        (commissaryVendorIds.includes(o.vendor_id) || o.vendor_id === selectedCommissaryId || !o.vendor_id)
      )
    : [];
  const filteredFulfillments = selectedCommissaryId
    ? fulfillments.filter(f => f.commissary_location_id === selectedCommissaryId)
    : [];

  const buildCart = (locationId) => {
    const cartItems = [];
    
    items.forEach(item => {
      const itemVariants = variants.filter(v => v.item_id === item.id);
      
      if (itemVariants.length > 0) {
        // Item has variants - create a row for each variant
        itemVariants.forEach(variant => {
          const li = locInv.find(l => l.location_id === locationId && l.item_id === item.id);
          const onHand = li?.on_hand_quantity || 0;
          const par = li?.par_level || 0;
          const qty = Math.max(0, par - onHand);
          cartItems.push({
            item_id: item.id,
            variant_id: variant.id,
            item_name: `${item.name} (${variant.variant_name})`,
            unit_of_measure: item.unit_of_measure,
            quantity_ordered: qty,
            unit_cost: variant.unit_cost || item.commissary_price || item.unit_cost || 0,
            total_cost: qty * (variant.unit_cost || item.commissary_price || item.unit_cost || 0),
            on_hand: onHand,
            par_level: par,
          });
        });
      } else {
        // No variants - standard item
        const li = locInv.find(l => l.location_id === locationId && l.item_id === item.id);
        const onHand = li?.on_hand_quantity || 0;
        const par = li?.par_level || 0;
        const qty = Math.max(0, par - onHand);
        cartItems.push({
          item_id: item.id,
          item_name: item.name,
          unit_of_measure: item.unit_of_measure,
          quantity_ordered: qty,
          unit_cost: item.commissary_price || item.unit_cost || 0,
          total_cost: qty * (item.commissary_price || item.unit_cost || 0),
          on_hand: onHand,
          par_level: par,
        });
      }
    });
    
    return cartItems;
  };

  const openNewOrder = () => {
    setCartForm({ location_id: '', items: [] });
    setNewOrderDialog(true);
  };

  const onSelectLocation = (locId) => {
    const cartItems = buildCart(locId);
    setCartForm({ location_id: locId, items: cartItems });
  };

  const updateQty = (idx, val) => {
    setCartForm(prev => {
      const its = [...prev.items];
      its[idx] = { ...its[idx], quantity_ordered: parseFloat(val) || 0, total_cost: (parseFloat(val) || 0) * its[idx].unit_cost };
      return { ...prev, items: its };
    });
  };

  const submitOrder = async () => {
    const orderItems = cartForm.items.filter(i => i.quantity_ordered > 0);
    await base44.entities.Order.create({
      type: 'commissary',
      status: 'sent',
      location_id: cartForm.location_id,
      company_id: companyId,
      items: orderItems,
      total_amount: orderItems.reduce((s, i) => s + i.total_cost, 0),
      order_number: `CO-${Date.now().toString().slice(-6)}`,
    });
    await load();
    setNewOrderDialog(false);
  };

  const fulfillOrder = async (order) => {
    // Open fulfillment dialog instead of instant fulfillment
    setFulfillmentDialog(order);
  };

  const handleFulfilled = () => {
    load();
    setFulfillmentDialog(null);
    setViewDialog(null);
  };

  const markAsViewedRef = useRef(null);
  const markAsViewed = async (order) => {
    // Prevent duplicate calls
    if (markAsViewedRef.current) return;
    if (order.status !== 'sent') return;
    
    markAsViewedRef.current = true;
    try {
      await base44.entities.Order.update(order.id, {
        status: 'viewed',
        viewed_at: new Date().toISOString(),
      });
      await load();
    } catch (error) {
      if (error.message?.includes('Rate limit')) {
        console.warn('Rate limited, skipping viewed status update');
      } else {
        throw error;
      }
    } finally {
      markAsViewedRef.current = false;
    }
  };

  const cancelOrder = async () => {
    if (!cancelDialog) return;
    await base44.entities.Order.update(cancelDialog.id, {
      status: 'cancelled',
    });
    await load();
    setCancelDialog(null);
  };

  const markBackstock = async () => {
    if (!backstockDialog || !backstockNote.trim()) return;
    
    try {
      // Update commissary order
      await base44.entities.Order.update(backstockDialog.id, {
        status: 'backstocked',
        backstock_note: backstockNote.trim(),
      });
      
      // Find and update related vendor orders (draft or sent) for the same location
      const allOrders = await base44.entities.Order.list('-created_date', 100);
      const relatedVendorOrders = allOrders.filter(vo => 
        (vo.type === 'vendor') &&
        vo.location_id === backstockDialog.location_id &&
        (vo.status === 'draft' || vo.status === 'sent' || vo.status === 'viewed') &&
        vo.items?.some(vi => backstockDialog.items?.some(ci => ci.item_id === vi.item_id))
      );
      
      for (const relatedOrder of relatedVendorOrders) {
        const existingNote = relatedOrder.notes || '';
        const backstockText = `\n\n[COMMISSARY BACKSTOCK - ${format(new Date(), 'MMM d, yyyy')}] ${backstockNote.trim()}`;
        if (!existingNote.includes('[COMMISSARY BACKSTOCK')) {
          await base44.entities.Order.update(relatedOrder.id, {
            notes: existingNote + backstockText
          });
          toast.success(`Vendor order ${relatedOrder.order_number} updated with backstock note`);
        }
      }
      
      await load();
      setBackstockDialog(null);
      setBackstockNote('');
    } catch (error) {
      if (error.message?.includes('Rate limit')) {
        toast.error('Rate limited. Please wait a moment and try again.');
      } else {
        throw error;
      }
    }
  };

  const clearBackstock = async (order) => {
    await base44.entities.Order.update(order.id, {
      status: 'viewed',
      backstock_note: null,
    });
    await load();
    setViewDialog(null);
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const total = cartForm.items.reduce((s, i) => s + i.total_cost, 0);

  const handlePrint = () => {
    window.print();
  };

  const isMobile = useIsMobile();

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs font-mono">
        <strong>VARIANTS DEBUG:</strong> Total variants loaded: {variants.length} | Items: {items.length} | Items with is_commissary_item: {items.filter(i => i.is_commissary_item).length}
      </div>
      <PageHeader
        title="Commissary"
        subtitle="Internal orders and fulfillment between commissary and locations"
        actions={
          <Button onClick={openNewOrder}><Plus className="w-4 h-4 mr-1" />Place Order</Button>
        }
      />

      {commissaryLocs.length === 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
          No commissary access. Set up a commissary location and assign manage permissions to get started.
        </div>
      )}

      {commissaryLocs.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Commissary:</label>
          <div className="flex gap-2 flex-wrap">
            {commissaryLocs.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedCommissaryId(c.id)}
                className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                  selectedCommissaryId === c.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border hover:bg-muted text-foreground'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="outgoing">Outgoing Orders (to Locations)</TabsTrigger>
          <TabsTrigger value="fulfillments">Fulfillment History</TabsTrigger>
        </TabsList>

        <TabsContent value="outgoing" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
          ) : isMobile ? (
            <div className="space-y-3">
              {filteredOrders.filter(o => o.status !== 'fulfilled' && o.status !== 'cancelled' && o.status !== 'received').length === 0 ? (
                <div className="bg-card border border-border rounded-xl px-4 py-8 text-center text-muted-foreground text-sm">{selectedCommissaryId ? 'No pending orders.' : 'Select a commissary to view orders.'}</div>
              ) : filteredOrders.filter(o => o.status !== 'fulfilled' && o.status !== 'cancelled' && o.status !== 'received').map(o => (
                <div key={o.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-semibold text-sm">{o.order_number}{o.notes?.includes('Split from') && <span className="ml-2 text-[10px] bg-pink-100 text-pink-700 px-1 rounded">Split</span>}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{locName(o.location_id)} · {format(new Date(o.created_date), 'MMM d, h:mm a')}</p>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="flex items-center justify-between text-sm border-t border-border pt-2">
                    <span className="text-muted-foreground">{o.items?.length || 0} items</span>
                    <span className="font-semibold">${(o.total_amount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => setViewDialog(o)}><Eye className="w-3.5 h-3.5 mr-1" />View</Button>
                    {(o.status === 'sent' || o.status === 'viewed' || o.status === 'partial') && <>
                      <Button variant="outline" size="sm" className="flex-1 h-8 text-xs text-green-600" onClick={() => fulfillOrder(o)}><CheckCircle className="w-3.5 h-3.5 mr-1" />Fulfill</Button>
                      <Button variant="outline" size="sm" className="h-8 w-8 text-red-600 px-0" onClick={() => setCancelDialog(o)}><XCircle className="w-3.5 h-3.5" /></Button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>{['Order #', 'Location', 'Items', 'Total', 'Status', 'Date', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredOrders.filter(o => o.status !== 'fulfilled' && o.status !== 'cancelled' && o.status !== 'received').length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{selectedCommissaryId ? 'No pending orders.' : 'Select a commissary to view orders.'}</td></tr>
                  ) : filteredOrders.filter(o => o.status !== 'fulfilled' && o.status !== 'cancelled' && o.status !== 'received').map(o => (
                    <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium font-mono">{o.order_number}{o.notes?.includes('Split from') && <span className="ml-2 text-[10px] bg-pink-100 text-pink-700 px-1 rounded">Split Order</span>}</td>
                      <td className="px-4 py-3">{locName(o.location_id)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{o.items?.length || 0}</td>
                      <td className="px-4 py-3 font-medium">${(o.total_amount || 0).toFixed(2)}</td>
                      <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(o.created_date), 'MMM d, h:mm a')}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewDialog(o)}><Eye className="w-3.5 h-3.5" /></Button>
                          {o.status === 'fulfilled' && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrintDialog(o)}><Printer className="w-3.5 h-3.5" /></Button>}
                          {(o.status === 'sent' || o.status === 'viewed' || o.status === 'partial') && <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => fulfillOrder(o)}><CheckCircle className="w-3.5 h-3.5" /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => setCancelDialog(o)}><XCircle className="w-3.5 h-3.5" /></Button>
                          </>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="fulfillments" className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
          ) : isMobile ? (
            <div className="space-y-3">
              {filteredFulfillments.length === 0 ? (
                <div className="bg-card border border-border rounded-xl px-4 py-8 text-center text-muted-foreground text-sm">{selectedCommissaryId ? 'No fulfillments yet.' : 'Select a commissary to view fulfillments.'}</div>
              ) : filteredFulfillments.map(f => (
                <div key={f.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-semibold text-sm">{f.order_number}{f.is_split_invoice && <span className="ml-2 text-[10px] bg-pink-100 text-pink-700 px-1 rounded">Split</span>}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{locName(f.retail_location_id)}</p>
                    </div>
                    <StatusBadge status={f.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs border-t border-border pt-2">
                    <div><p className="text-muted-foreground">Items</p><p className="font-medium mt-0.5">{f.items?.length || 0}</p></div>
                    <div><p className="text-muted-foreground">Total</p><p className="font-medium mt-0.5">${(f.items || []).reduce((s, i) => s + (i.total_cost || 0), 0).toFixed(2)}</p></div>
                    <div><p className="text-muted-foreground">Fulfilled</p><p className="font-medium mt-0.5">{f.fulfillment_date ? format(new Date(f.fulfillment_date), 'MMM d') : '—'}</p></div>
                    <div><p className="text-muted-foreground">From</p><p className="font-medium mt-0.5">{locName(f.commissary_location_id)}</p></div>
                  </div>
                  <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => setPrintDialog(f)}><Printer className="w-3.5 h-3.5 mr-1" />Print Invoice</Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>{['Order #', 'Retail Location', 'Items', 'Total', 'Status', 'Fulfilled', 'Commissary', ''].map(h => <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredFulfillments.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{selectedCommissaryId ? 'No fulfillments yet.' : 'Select a commissary to view fulfillments.'}</td></tr>
                  ) : filteredFulfillments.map(f => (
                    <tr key={f.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium font-mono">{f.order_number}{f.is_split_invoice && <span className="ml-2 text-[10px] bg-pink-100 text-pink-700 px-1 rounded">Split</span>}</td>
                      <td className="px-4 py-3">{locName(f.retail_location_id)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{f.items?.length || 0}</td>
                      <td className="px-4 py-3 font-medium">${(f.items || []).reduce((s, i) => s + (i.total_cost || 0), 0).toFixed(2)}</td>
                      <td className="px-4 py-3"><StatusBadge status={f.status} /></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{f.fulfillment_date ? format(new Date(f.fulfillment_date), 'MMM d, h:mm a') : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{locName(f.commissary_location_id)}</td>
                      <td className="px-4 py-3"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPrintDialog(f)}><Printer className="w-3.5 h-3.5" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* New Commissary Order Dialog */}
      <Dialog open={newOrderDialog} onOpenChange={setNewOrderDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle><Store className="w-4 h-4 inline mr-1" />New Commissary Order</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Ordering Location *</Label>
              <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={cartForm.location_id} onChange={e => onSelectLocation(e.target.value)}>
                <option value="">Select location...</option>
                {regularLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            {cartForm.items.length > 0 && (
              <div>
                <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-xs font-mono">
                  <strong>DEBUG:</strong><br/>
                  Variants in DB: {variants.length}<br/>
                  Cart items: {cartForm.items.length}<br/>
                  Items with variant_id: {cartForm.items.filter(i => i.variant_id).length}<br/>
                  First item: {cartForm.items[0]?.item_name}
                </div>
                <Label className="mb-2 block">Items (auto-filled to par, commissary pricing)</Label>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        {['Item', 'On Hand', 'Par', 'Order Qty', 'Price', 'Total'].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {cartForm.items.map((row, idx) => (
                        <tr key={row.item_id + (row.variant_id || '')} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-medium text-xs">{row.item_name}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{row.on_hand}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{row.par_level}</td>
                          <td className="px-3 py-2">
                            <Input type="number" className="w-20 h-7 text-xs" value={row.quantity_ordered} onChange={e => updateQty(idx, e.target.value)} />
                          </td>
                          <td className="px-3 py-2 text-xs">${row.unit_cost.toFixed(2)}</td>
                          <td className="px-3 py-2 text-xs font-medium">${row.total_cost.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end mt-2">
                  <span className="font-semibold text-sm">Total: ${total.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOrderDialog(false)}>Cancel</Button>
            <Button onClick={submitOrder} disabled={!cartForm.location_id || cartForm.items.filter(i => i.quantity_ordered > 0).length === 0}>
              <Truck className="w-4 h-4 mr-1" />Submit to Commissary
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Order {viewDialog?.order_number}</DialogTitle></DialogHeader>
          {viewDialog && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">From:</span> <span className="font-medium">{locName(viewDialog.location_id)}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewDialog.status} /></div>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Item', 'Qty', 'UOM', 'Price', 'Total'].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {viewDialog.items?.map((item, i) => {
                      const hasVariantBreakdown = item.variant_quantities && Object.keys(item.variant_quantities).length > 0;
                      const itemVariants = hasVariantBreakdown 
                        ? Object.entries(item.variant_quantities)
                            .map(([variantId, qty]) => {
                              const variant = variants.find(v => v.id === variantId);
                              return { variantId, qty, variant };
                            })
                            .filter(v => v.qty > 0)
                        : [];

                      const hasSingleVariant = item.variant_id && !hasVariantBreakdown;
                      const singleVariant = hasSingleVariant ? variants.find(v => v.id === item.variant_id) : null;

                      return (
                        <React.Fragment key={i}>
                          <tr>
                            <td className="px-3 py-2">
                              {item.item_name}
                              {hasSingleVariant && singleVariant && (
                                <span className="ml-2 text-xs text-primary font-semibold">({singleVariant.variant_name})</span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">{item.quantity_ordered}</td>
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{item.unit_of_measure}</td>
                            <td className="px-3 py-2 whitespace-nowrap">${(item.unit_cost || 0).toFixed(2)}</td>
                            <td className="px-3 py-2 font-medium whitespace-nowrap">${(item.total_cost || 0).toFixed(2)}</td>
                          </tr>
                          {itemVariants.length > 0 && (
                            <tr className="bg-muted/20">
                              <td colSpan={5} className="px-6 py-2.5">
                                <div className="text-xs space-y-1.5">
                                  <p className="font-medium text-muted-foreground mb-2">Variant Breakdown:</p>
                                  <div className="grid grid-cols-2 gap-3 ml-2">
                                    {itemVariants.map(({ variantId, qty, variant }) => (
                                      <div key={variantId} className="flex items-center justify-between">
                                        <span className="text-muted-foreground">{variant?.variant_name || 'Unknown'}</span>
                                        <span className="font-medium">× {qty}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {viewDialog.status === 'backstocked' && (
                <div className="space-y-3">
                  {viewDialog.backstock_note && (
                    <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
                      <p className="text-xs font-medium text-amber-800 mb-1">Backstock Note</p>
                      <p className="text-sm text-amber-900">{viewDialog.backstock_note}</p>
                    </div>
                  )}
                  <Button variant="outline" className="w-full" onClick={() => clearBackstock(viewDialog)}>
                    <Package className="w-4 h-4 mr-1" />Clear Backstock Status
                  </Button>
                </div>
              )}
              {(viewDialog.status === 'sent' || viewDialog.status === 'viewed' || viewDialog.status === 'partial') && (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => fulfillOrder(viewDialog)}>
                    <CheckCircle className="w-4 h-4 mr-1" />Fulfill Order
                  </Button>
                  <Button variant="outline" className="flex-1 text-amber-600 hover:text-amber-700" onClick={() => setBackstockDialog(viewDialog)}>
                    <Package className="w-4 h-4 mr-1" />Backstock
                  </Button>
                  <Button variant="outline" className="flex-1 text-red-600 hover:text-red-700" onClick={() => setCancelDialog(viewDialog)}>
                    <XCircle className="w-4 h-4 mr-1" />Cancel Order
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setViewDialog(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backstock Dialog */}
      <Dialog open={!!backstockDialog} onOpenChange={() => setBackstockDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Order {backstockDialog?.order_number} as Backstocked</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will mark the order as waiting for backstock. The note will be visible on the vendor order.
            </p>
            <div>
              <Label>Backstock Note *</Label>
              <textarea
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background min-h-[100px]"
                placeholder="Explain what items are on backstock and expected timeline..."
                value={backstockNote}
                onChange={(e) => setBackstockNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackstockDialog(null)}>Cancel</Button>
            <Button variant="secondary" onClick={markBackstock} disabled={!backstockNote.trim()}>
              <Package className="w-4 h-4 mr-1" />Mark as Backstocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fulfillment Dialog */}
      <FulfillmentDialog
        open={!!fulfillmentDialog}
        onOpenChange={() => setFulfillmentDialog(null)}
        order={fulfillmentDialog}
        commissaryLocationId={selectedCommissaryId || commissaryLoc?.id}
        onFulfilled={handleFulfilled}
      />

      {/* Cancel Order Confirmation Dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={() => setCancelDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel Order {cancelDialog?.order_number}?</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-sm text-muted-foreground">
            Are you sure you want to cancel this order? This action cannot be undone.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialog(null)}>No, Keep Order</Button>
            <Button variant="destructive" onClick={cancelOrder}>
              <XCircle className="w-4 h-4 mr-1" />Yes, Cancel Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Invoice Dialog */}
      <Dialog open={!!printDialog} onOpenChange={() => setPrintDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Commissary Invoice - {printDialog?.order_number}</span>
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="w-4 h-4 mr-1" />Print
              </Button>
            </DialogTitle>
          </DialogHeader>
          {printDialog && (
            <div className="space-y-4 py-4">
              <div className="border border-border rounded-lg p-4 bg-muted/30">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Invoice Number</p>
                    <p className="font-mono font-medium">{printDialog.order_number}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date</p>
                    <p className="font-medium">{printDialog.fulfillment_date ? format(new Date(printDialog.fulfillment_date), 'MMM d, yyyy') : '—'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">From</p>
                    <p className="font-medium">{locName(printDialog.commissary_location_id)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">To</p>
                    <p className="font-medium">{locName(printDialog.retail_location_id)}</p>
                  </div>
                </div>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Item</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Qty</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">UOM</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Unit Price</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {printDialog.items?.map((item, i) => {
                      const hasVariantBreakdown = item.variant_quantities && Object.keys(item.variant_quantities).length > 0;
                      const itemVariants = hasVariantBreakdown 
                        ? Object.entries(item.variant_quantities)
                            .map(([variantId, qty]) => {
                              const variant = variants.find(v => v.id === variantId);
                              return { variantId, qty, variant };
                            })
                            .filter(v => v.qty > 0)
                        : [];
                      
                      const hasSingleVariant = item.variant_id && !hasVariantBreakdown;
                      const singleVariant = hasSingleVariant ? variants.find(v => v.id === item.variant_id) : null;
                      
                      return (
                        <React.Fragment key={i}>
                          <tr>
                            <td className="px-4 py-3">
                              {item.item_name}
                              {hasSingleVariant && singleVariant && (
                                <span className="ml-2 text-xs text-primary font-semibold">({singleVariant.variant_name})</span>
                              )}
                            </td>
                            <td className="px-4 py-3">{item.quantity_fulfilled || item.quantity_ordered}</td>
                            <td className="px-4 py-3 text-muted-foreground">{item.unit_of_measure}</td>
                            <td className="px-4 py-3">${(item.unit_cost || 0).toFixed(2)}</td>
                            <td className="px-4 py-3 font-medium">${(item.total_cost || 0).toFixed(2)}</td>
                          </tr>
                          {itemVariants.length > 0 && (
                            <tr className="bg-muted/20">
                              <td colSpan={5} className="px-6 py-2.5">
                                <div className="text-xs space-y-1.5">
                                  <p className="font-medium text-muted-foreground mb-2">Variant Breakdown:</p>
                                  <div className="grid grid-cols-2 gap-3 ml-2">
                                    {itemVariants.map(({ variantId, qty, variant }) => (
                                      <div key={variantId} className="flex items-center justify-between">
                                        <span className="text-muted-foreground">{variant?.variant_name || 'Unknown'}</span>
                                        <span className="font-medium">× {qty}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/50">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-right font-semibold">Total Amount:</td>
                      <td className="px-4 py-3 font-bold">${(printDialog.items || []).reduce((s, i) => s + (i.total_cost || 0), 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {printDialog.notes && (
                <div className="border border-border rounded-lg p-3 bg-muted/30">
                  <p className="text-xs text-muted-foreground font-medium mb-1">Notes</p>
                  <p className="text-sm">{printDialog.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}