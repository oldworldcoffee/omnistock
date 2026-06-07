import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { DollarSign, Package, TrendingDown, TrendingUp, Calendar, MapPin } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import StatCard from '@/components/ui/StatCard';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

export default function Reports() {
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [snapshotDate, setSnapshotDate] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('all');
  const [snapshotData, setSnapshotData] = useState([]);
  const [dateRangeStart, setDateRangeStart] = useState('');
  const [dateRangeEnd, setDateRangeEnd] = useState('');

  useEffect(() => {
    Promise.all([
      base44.entities.Location.list(),
      base44.entities.InventoryItem.list(),
      base44.entities.LocationInventory.list(),
      base44.entities.Order.list('-created_date', 100),
    ]).then(([locs, itms, linv, ords]) => {
      setLocations(locs);
      setItems(itms);
      setLocInv(linv);
      setOrders(ords);
      setLoading(false);
    });
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    setSnapshotDate(today);
    // Set default date range to last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setDateRangeStart(thirtyDaysAgo);
    setDateRangeEnd(today);
  }, []);

  useEffect(() => {
    if (snapshotDate) {
      // Load snapshot data for selected date
      base44.entities.InventorySnapshot.filter({
        snapshot_date: snapshotDate
      }).then(snapshots => {
        setSnapshotData(snapshots);
      });
    }
  }, [snapshotDate]);

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];

  const getFilteredItems = () => selectedCategory === 'all' ? items : items.filter(i => i.category === selectedCategory);

  // Use snapshot data if viewing historical date, otherwise use current data
  const isViewingSnapshot = snapshotData && snapshotData.length > 0;
  
  const totalValue = isViewingSnapshot 
    ? snapshotData.reduce((sum, snap) => {
        if (selectedLocationId !== 'all' && snap.location_id !== selectedLocationId) return sum;
        return sum + (snap.inventory_value || 0);
      }, 0)
    : locInv.reduce((sum, li) => {
        if (selectedLocationId !== 'all' && li.location_id !== selectedLocationId) return sum;
        const item = items.find(i => i.id === li.item_id);
        return sum + (li.on_hand_quantity || 0) * (item?.unit_cost || 0);
      }, 0);

  const lowStockItems = locInv.filter(li => {
    const par = li.par_level || 0;
    return par > 0 && (li.on_hand_quantity || 0) < par;
  });

  // Per-location value data
  const locValueData = locations.map((loc, idx) => {
    if (selectedLocationId !== 'all' && loc.id !== selectedLocationId) {
      return { name: loc.name, value: 0, color: COLORS[idx % COLORS.length] };
    }
    const val = isViewingSnapshot
      ? snapshotData
          .filter(snap => snap.location_id === loc.id)
          .reduce((sum, snap) => sum + (snap.inventory_value || 0), 0)
      : locInv
          .filter(li => li.location_id === loc.id)
          .reduce((sum, li) => {
            const item = items.find(i => i.id === li.item_id);
            return sum + (li.on_hand_quantity || 0) * (item?.unit_cost || 0);
          }, 0);
    return { name: loc.name, value: parseFloat(val.toFixed(2)), color: COLORS[idx % COLORS.length] };
  });

  // Per-category value
  const catValueData = categories.map((cat, idx) => {
    const catItems = items.filter(i => i.category === cat);
    const val = isViewingSnapshot
      ? snapshotData
          .filter(snap => {
            if (selectedLocationId !== 'all' && snap.location_id !== selectedLocationId) return false;
            return catItems.some(i => i.id === snap.item_id);
          })
          .reduce((sum, snap) => sum + (snap.inventory_value || 0), 0)
      : locInv
          .filter(li => catItems.some(i => i.id === li.item_id))
          .reduce((sum, li) => {
            const item = items.find(i => i.id === li.item_id);
            return sum + (li.on_hand_quantity || 0) * (item?.unit_cost || 0);
          }, 0);
    return { name: cat, value: parseFloat(val.toFixed(2)), color: COLORS[idx % COLORS.length] };
  });

  // Order spend for selected date range
  const filteredOrders = orders.filter(o => {
    if (o.status === 'cancelled') return false;
    if (!dateRangeStart || !dateRangeEnd) return true;
    const orderDate = o.created_date?.split('T')[0];
    return orderDate >= dateRangeStart && orderDate <= dateRangeEnd;
  });
  const orderSpend = filteredOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const orderCount = filteredOrders.length;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader title="Reports" subtitle="Inventory valuation and spending insights" />

      {/* Date pickers */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Snapshot date for inventory valuation */}
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">Inventory as of:</span>
          <input
            type="date"
            value={snapshotDate}
            onChange={(e) => setSnapshotDate(e.target.value)}
            className="bg-transparent text-sm text-foreground focus:outline-none"
          />
        </div>
        
        {/* Date range for order spend */}
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
          <span className="text-xs text-muted-foreground font-medium">Order spend:</span>
          <input
            type="date"
            value={dateRangeStart}
            onChange={(e) => setDateRangeStart(e.target.value)}
            className="bg-transparent text-sm text-foreground focus:outline-none"
          />
          <span className="text-muted-foreground text-xs">→</span>
          <input
            type="date"
            value={dateRangeEnd}
            onChange={(e) => setDateRangeEnd(e.target.value)}
            className="bg-transparent text-sm text-foreground focus:outline-none"
          />
        </div>
        
        {/* Location filter */}
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <select
            value={selectedLocationId}
            onChange={(e) => setSelectedLocationId(e.target.value)}
            className="bg-transparent text-sm text-foreground focus:outline-none"
          >
            <option value="all">All Locations</option>
            {locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Inventory Value" value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={DollarSign} color="text-primary" />
        <StatCard label="Total Items" value={items.filter(i => i.is_active).length} icon={Package} color="text-info" />
        <StatCard label="Low Stock Items" value={lowStockItems.length} icon={TrendingDown} color="text-warning" />
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-5 h-5 text-success" />
            <span className="text-sm text-muted-foreground">Order Spend</span>
          </div>
          <p className="text-2xl font-bold text-foreground">${orderSpend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground mt-1">{orderCount} orders from {new Date(dateRangeStart).toLocaleDateString()} to {new Date(dateRangeEnd).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Value by Location */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold text-foreground mb-4">Inventory Value by Location</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={locValueData}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v.toLocaleString()}`} />
              <Tooltip formatter={(v) => [`$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Value']} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {locValueData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Value by Category */}
        <div className="bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold text-foreground mb-4">Inventory Value by Category</h2>
          {catValueData.length === 0 ? (
            <p className="text-muted-foreground text-sm">No categories defined yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catValueData}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v.toLocaleString()}`} />
                <Tooltip formatter={(v) => [`$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Value']} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {catValueData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Low Stock Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Low Stock Alerts</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Items where on-hand quantity is below par level</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {['Item', 'Category', 'Location', 'On Hand', 'Par Level', 'Deficit', 'Value at Risk'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lowStockItems.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">All items are at or above par level. 🎉</td></tr>
            ) : lowStockItems.map((li, idx) => {
              const item = items.find(i => i.id === li.item_id);
              const loc = locations.find(l => l.id === li.location_id);
              const deficit = (li.par_level || 0) - (li.on_hand_quantity || 0);
              const valueAtRisk = deficit * (item?.unit_cost || 0);
              return (
                <tr key={idx} className="hover:bg-red-50/30">
                  <td className="px-4 py-3 font-medium">{item?.name || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item?.category || '—'}</td>
                  <td className="px-4 py-3">{loc?.name || '—'}</td>
                  <td className="px-4 py-3 text-red-600 font-semibold">{li.on_hand_quantity || 0}</td>
                  <td className="px-4 py-3">{li.par_level}</td>
                  <td className="px-4 py-3 text-red-600 font-medium">-{deficit}</td>
                  <td className="px-4 py-3">${valueAtRisk.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}