import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { DollarSign, Package, ArrowLeftRight, AlertTriangle, ShoppingCart, FileText } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import PageHeader from '@/components/layout/PageHeader';
import { Link } from 'react-router-dom';
import StatusBadge from '@/components/ui/StatusBadge';

export default function Dashboard() {
  const { canAccessLocation } = useAuth();
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [orders, setOrders] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Location.list(),
      base44.entities.InventoryItem.list(),
      base44.entities.LocationInventory.list(),
      base44.entities.Order.list('-created_date', 10),
      base44.entities.Transfer.list('-created_date', 10),
      base44.entities.Invoice.filter({ status: 'pending_review' }),
    ]).then(([locs, itms, linv, ords, trans, invs]) => {
      const filteredLocs = locs.filter(l => canAccessLocation(l.id));
      setLocations(filteredLocs);
      setItems(itms);
      setLocInv(linv.filter(li => canAccessLocation(li.location_id)));
      setOrders(ords);
      setTransfers(trans);
      setInvoices(invs);
      setLoading(false);
    });
  }, []);

  const totalValue = locInv.reduce((sum, li) => {
    const item = items.find(i => i.id === li.item_id);
    return sum + (li.on_hand_quantity || 0) * (item?.unit_cost || 0);
  }, 0);

  const lowStockCount = locInv.filter(li => {
    const par = li.par_level || 0;
    return par > 0 && (li.on_hand_quantity || 0) < par;
  }).length;

  const pendingTransfers = transfers.filter(t => t.status === 'pending').length;
  const pendingInvoices = invoices.length;

  const locationValues = locations.map(loc => {
    const val = locInv
      .filter(li => li.location_id === loc.id)
      .reduce((sum, li) => {
        const item = items.find(i => i.id === li.item_id);
        return sum + (li.on_hand_quantity || 0) * (item?.unit_cost || 0);
      }, 0);
    return { ...loc, value: val };
  });

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Dashboard" subtitle="Overview across all locations" />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Inventory Value" value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={DollarSign} color="text-primary" />
        <StatCard label="Low Stock Alerts" value={lowStockCount} sub="items below par" icon={AlertTriangle} color="text-warning" />
        <StatCard label="Pending Transfers" value={pendingTransfers} icon={ArrowLeftRight} color="text-info" />
        <StatCard label="Invoices to Review" value={pendingInvoices} icon={FileText} color="text-amber-600" />
      </div>

      {/* Location Value Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold text-foreground mb-4">Inventory Value by Location</h2>
          {locationValues.length === 0 ? (
            <p className="text-muted-foreground text-sm">No locations yet. <Link to="/locations" className="text-primary underline">Add locations</Link></p>
          ) : (
            <div className="space-y-3">
              {locationValues.map(loc => (
                <div key={loc.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={loc.type} />
                    <span className="text-sm font-medium">{loc.name}</span>
                  </div>
                  <span className="text-sm font-semibold">${loc.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold text-foreground mb-4">Recent Orders</h2>
          {orders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No orders yet. <Link to="/orders" className="text-primary underline">Place an order</Link></p>
          ) : (
            <div className="space-y-2">
              {orders.slice(0, 6).map(order => (
                <div key={order.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{order.order_number || `Order #${order.id.slice(-6)}`}</p>
                    <p className="text-xs text-muted-foreground capitalize">{order.type} order</p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={order.status} />
                    <p className="text-xs text-muted-foreground mt-0.5">${(order.total_amount || 0).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pending Invoices Alert */}
      {pendingInvoices > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">{pendingInvoices} invoice{pendingInvoices > 1 ? 's' : ''} awaiting review</p>
            <p className="text-xs text-amber-600">AI has extracted invoice data — please review and confirm</p>
          </div>
          <Link to="/invoices" className="text-sm text-amber-700 font-medium underline">Review now</Link>
        </div>
      )}
    </div>
  );
}