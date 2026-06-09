import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ShoppingBasket, Eye, CheckCircle, FileText, Check, X, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function InStoreOrders() {
  const { canAccessLocation, companyId } = useAuth();
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewOrder, setViewOrder] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [skippedItems, setSkippedItems] = useState({});
  const [itemQtys, setItemQtys] = useState({});
  const [completing, setCompleting] = useState(false);
  const isMobile = useIsMobile();

  const load = async () => {
    const [locs, vends, ords] = await Promise.all([
      base44.entities.Location.filter({ is_active: true, company_id: companyId }),
      base44.entities.Vendor.filter({ is_active: true, company_id: companyId }),
      base44.entities.Order.filter({ company_id: companyId }, '-created_date', 100),
    ]);
    const accessibleLocIds = new Set(locs.filter(l => canAccessLocation(l.id)).map(l => l.id));
    const instoreVendorIds = new Set(vends.filter(v => v.order_type === 'instore').map(v => v.id));
    setLocations(locs);
    setVendors(vends);
    setOrders(
      ords.filter(o =>
        accessibleLocIds.has(o.location_id) &&
        instoreVendorIds.has(o.vendor_id) &&
        o.status !== 'cancelled'
      )
    );
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openOrder = async (order) => {
    if (order.status === 'sent') {
      await base44.entities.Order.update(order.id, { status: 'viewed', viewed_at: new Date().toISOString() });
      await load();
      const fresh = await base44.entities.Order.get(order.id);
      setViewOrder(fresh);
    } else {
      setViewOrder(order);
    }
    const isDone = order.status === 'fulfilled' || order.status === 'received';
    const initChecked = {};
    const initQtys = {};
    (order.items || []).forEach(item => {
      initChecked[item.item_id] = isDone;
      initQtys[item.item_id] = item.quantity_ordered;
    });
    setCheckedItems(initChecked);
    setSkippedItems({});
    setItemQtys(initQtys);
  };

  const toggleItem = (itemId) => {
    if (skippedItems[itemId]) return;
    setCheckedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const toggleSkip = (itemId) => {
    setSkippedItems(prev => {
      const nowSkipped = !prev[itemId];
      if (nowSkipped) setCheckedItems(c => ({ ...c, [itemId]: false }));
      return { ...prev, [itemId]: nowSkipped };
    });
  };

  const updateQty = (itemId, delta) => {
    setItemQtys(prev => {
      const current = prev[itemId] ?? 0;
      return { ...prev, [itemId]: Math.max(0, current + delta) };
    });
  };

  const allResolved = viewOrder
    ? (viewOrder.items || []).every(i => checkedItems[i.item_id] || skippedItems[i.item_id])
    : false;

  const resolvedCount = viewOrder ? (viewOrder.items || []).filter(i => checkedItems[i.item_id] || skippedItems[i.item_id]).length : 0;

  const markFulfilled = async () => {
    if (!viewOrder || !allResolved) return;
    setCompleting(true);
    const updatedItems = (viewOrder.items || []).map(item => {
      const skipped = !!skippedItems[item.item_id];
      const actualQty = skipped ? 0 : (itemQtys[item.item_id] ?? item.quantity_ordered);
      return {
        ...item,
        quantity_received: actualQty,
        total_cost: actualQty * (item.unit_cost || 0),
      };
    });
    const newTotal = updatedItems.reduce((sum, i) => sum + (i.total_cost || 0), 0);
    await base44.entities.Order.update(viewOrder.id, {
      status: 'fulfilled',
      items: updatedItems,
      total_amount: newTotal,
    });
    toast.success('Order marked as fulfilled! Upload an invoice to complete receiving.');
    await load();
    setViewOrder(null);
    setCompleting(false);
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const vendorName = (id) => vendors.find(v => v.id === id)?.name || '—';

  const statusOrder = { sent: 0, viewed: 1, fulfilled: 2, received: 3 };
  const sortedOrders = [...orders].sort((a, b) => (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className={isMobile ? "p-3 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="In-Store Shopping"
        subtitle="Track and complete in-store purchase orders"
      />

      {sortedOrders.length === 0 ? (
        <div className="text-center py-20">
          <ShoppingBasket className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground font-medium">No in-store orders yet</p>
          <p className="text-sm text-muted-foreground mt-1">Place an order with an in-store type vendor from Vendor Orders</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
              {['Order #', 'Location', 'Vendor', 'Items', 'Total', 'Status', 'Date', ''].map(h => (
                <th key={h} className={`text-left ${isMobile ? 'px-2 py-2' : 'px-4 py-3'} text-xs font-semibold text-muted-foreground uppercase tracking-wide`}>{h}</th>
              ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedOrders.map(o => (
                <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium font-mono">{o.order_number}</td>
                  <td className="px-4 py-3">{locName(o.location_id)}</td>
                  <td className="px-4 py-3">{vendorName(o.vendor_id)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{o.items?.length || 0}</td>
                  <td className="px-4 py-3 font-medium">${(o.total_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{format(new Date(o.created_date), 'MMM d, h:mm a')}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openOrder(o)}>
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Order Detail Dialog */}
      <Dialog open={!!viewOrder} onOpenChange={() => setViewOrder(null)}>
        <DialogContent className={isMobile ? "max-w-full max-h-[90vh] overflow-y-auto mx-2" : "max-w-lg max-h-[90vh] overflow-y-auto"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBasket className={isMobile ? "w-3 h-3" : "w-4 h-4"} />
              Order {viewOrder?.order_number}
              {viewOrder && <StatusBadge status={viewOrder.status} />}
            </DialogTitle>
          </DialogHeader>
          {viewOrder && (
            <div className={isMobile ? "space-y-3 py-2" : "space-y-4 py-2"}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Location:</span> <span className="font-medium">{locName(viewOrder.location_id)}</span></div>
                <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{vendorName(viewOrder.vendor_id)}</span></div>
              </div>

              {viewOrder.status !== 'fulfilled' && viewOrder.status !== 'received' && (
                <>
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>{resolvedCount} / {viewOrder.items?.length || 0} items</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-2 bg-success rounded-full transition-all duration-300"
                        style={{ width: viewOrder.items?.length ? `${(resolvedCount / viewOrder.items.length) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">Check off items as you find them. Adjust qty or <strong>Skip</strong> if out of stock.</p>
                </>
              )}

              <div className="border border-border rounded-xl overflow-hidden">
                <div className="divide-y divide-border">
                  {viewOrder.items?.map((item, idx) => {
                    const checked = !!checkedItems[item.item_id];
                    const skipped = !!skippedItems[item.item_id];
                    const qty = itemQtys[item.item_id] ?? item.quantity_ordered;
                    const isDone = viewOrder.status === 'fulfilled' || viewOrder.status === 'received';

                    return (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 px-4 py-3 transition-colors ${
                          skipped ? 'bg-destructive/5 opacity-60' : checked || isDone ? 'bg-success/5' : 'hover:bg-muted/20'
                        }`}
                      >
                        <button
                          onClick={() => !isDone && !skipped && toggleItem(item.item_id)}
                          disabled={isDone || skipped}
                          className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                            isDone || checked ? 'bg-success border-success text-white' : 'border-muted-foreground/40 hover:border-primary'
                          }`}
                        >
                          {(checked || isDone) && <Check className="w-3.5 h-3.5" />}
                        </button>

                        <div className="flex-1">
                          <p className={`text-sm font-medium ${skipped || checked || isDone ? 'line-through text-muted-foreground' : ''}`}>
                            {item.item_name}
                          </p>
                          {skipped ? (
                            <p className="text-xs text-destructive font-medium">Skipped / Not available</p>
                          ) : isDone ? (
                            <p className="text-xs text-muted-foreground">Received: {item.quantity_received ?? item.quantity_ordered} {item.unit_of_measure}</p>
                          ) : (
                            <div className="flex items-center gap-2 mt-1">
                              <button onClick={() => updateQty(item.item_id, -1)} className="w-5 h-5 rounded border flex items-center justify-center hover:bg-muted transition-colors">
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="text-xs font-medium min-w-[40px] text-center">{qty} {item.unit_of_measure}</span>
                              <button onClick={() => updateQty(item.item_id, 1)} className="w-5 h-5 rounded border flex items-center justify-center hover:bg-muted transition-colors">
                                <Plus className="w-3 h-3" />
                              </button>
                              <span className="text-xs text-muted-foreground ml-1">· ${(item.unit_cost || 0).toFixed(2)} ea</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-0.5 flex-shrink-0">
                          <span className="text-sm font-medium">
                            {isDone ? `$${(item.total_cost || 0).toFixed(2)}` : skipped ? '$0.00' : `$${(qty * (item.unit_cost || 0)).toFixed(2)}`}
                          </span>
                          {!isDone && (
                            <button
                              onClick={() => toggleSkip(item.item_id)}
                              title={skipped ? 'Un-skip item' : 'Skip / out of stock'}
                              className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                                skipped ? 'bg-destructive text-white' : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
                              }`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="bg-muted/30 px-4 py-2 flex justify-end">
                  <span className="text-sm font-semibold">Total: ${(viewOrder.total_amount || 0).toFixed(2)}</span>
                </div>
              </div>

              {viewOrder.status === 'fulfilled' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                  Order fulfilled. Go to <strong>Invoices</strong> to upload the receipt and mark it as received.
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
            {viewOrder && viewOrder.status !== 'fulfilled' && viewOrder.status !== 'received' && (
              <Button onClick={markFulfilled} disabled={!allResolved || completing}>
                <CheckCircle className="w-4 h-4 mr-1" />
                {completing ? 'Saving...' : `Mark as Fulfilled${!allResolved ? ' (resolve all items)' : ''}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}