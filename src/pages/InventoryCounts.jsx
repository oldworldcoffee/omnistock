import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Plus, ClipboardList, CheckCircle, ChevronRight, Eye, Pencil, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';

export default function InventoryCounts() {
  const { canAccessLocation } = useAuth();
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [storageAreas, setStorageAreas] = useState([]);
  const [itemAreaMappings, setItemAreaMappings] = useState([]);
  const [counts, setCounts] = useState([]);
  const [newCountDialog, setNewCountDialog] = useState(false);
  const [activeCount, setActiveCount] = useState(null);
  const [activeAreaIdx, setActiveAreaIdx] = useState(0);
  const [form, setForm] = useState({ location_id: '', count_type: 'full', category: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const load = () => Promise.all([
    base44.entities.Location.list(),
    base44.entities.InventoryItem.filter({ is_active: true }),
    base44.entities.LocationInventory.list(),
    base44.entities.StorageArea.list(),
    base44.entities.ItemStorageArea.list(),
    base44.entities.InventoryCount.list('-created_date', 50),
  ]).then(([locs, itms, linv, areas, mappings, cnts]) => {
    const accessibleLocs = locs.filter(l => canAccessLocation(l.id));
    const accessibleLocIds = new Set(accessibleLocs.map(l => l.id));
    setLocations(accessibleLocs);
    setItems(itms);
    setLocInv(linv);
    setStorageAreas(areas.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    setItemAreaMappings(mappings);
    setCounts(cnts.filter(c => accessibleLocIds.has(c.location_id)));
    setLoading(false);
  });

  useEffect(() => { load(); }, []);

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const locName = (id) => locations.find(l => l.id === id)?.name || id;

  const getLocAreas = (locId) => storageAreas.filter(a => a.location_id === locId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const getItemsForArea = (areaId) => {
    const itemIds = itemAreaMappings.filter(m => m.storage_area_id === areaId).map(m => m.item_id);
    return items.filter(i => itemIds.includes(i.id));
  };

  const startCount = async () => {
    // Filter by location assortment — include item if any purchase option covers this location
    let countItems = items.filter(item => {
      const opts = item.purchase_options || [];
      if (opts.length === 0) return true; // no options = available everywhere
      return opts.some(o => !o.location_ids || o.location_ids.length === 0 || o.location_ids.includes(form.location_id));
    });
    if (form.count_type === 'spot' && form.category) {
      countItems = countItems.filter(i => i.category === form.category);
    }
    const areas = getLocAreas(form.location_id);

    const countRows = countItems.map(item => {
      const li = locInv.find(l => l.location_id === form.location_id && l.item_id === item.id);
      const mappedAreas = areas.filter(a => 
        itemAreaMappings.some(m => m.item_id === item.id && m.storage_area_id === a.id)
      );
      const area_counts = mappedAreas.map(a => ({ area_id: a.id, area_name: a.name, quantity: 0 }));
      return {
        item_id: item.id,
        item_name: item.name,
        category: item.category || '',
        unit_of_measure: item.unit_of_measure,
        count_units: getCountUnits(item),
        previous_quantity: li?.on_hand_quantity || 0,
        counted_quantity: 0,
        area_counts,
      };
    });

    const count = await base44.entities.InventoryCount.create({
      location_id: form.location_id,
      count_type: form.count_type,
      status: 'in_progress',
      categories: form.category ? [form.category] : [],
      items: countRows,
    });
    setActiveCount({ ...count, items: countRows });
    setActiveAreaIdx(0);
    setNewCountDialog(false);
  };

  const resumeCount = async (count) => {
    // Refresh the count data
    const freshCount = await base44.entities.InventoryCount.get(count.id);
    setActiveCount(freshCount);
    setActiveAreaIdx(0);
  };

  const viewCount = async (count) => {
    const freshCount = await base44.entities.InventoryCount.get(count.id);
    setActiveCount(freshCount);
    setActiveAreaIdx(0);
  };

  // Value helper — on_hand is in base units (EA); unit_cost may be per case
  const getItemValue = (itemId, onHand) => {
    const item = items.find(i => i.id === itemId);
    if (!item || !onHand) return 0;
    const preferred = item.purchase_options?.find(o => o.is_preferred) || item.purchase_options?.[0];
    const packUnits = preferred?.inner_pack_units || item.inner_pack_units || 1;
    const packsPerCase = preferred?.packs_per_case || item.packs_per_case;
    const unitCost = preferred?.unit_cost || item.unit_cost || 0;
    if (packsPerCase && packUnits) return (onHand / (packUnits * packsPerCase)) * unitCost;
    if (packUnits > 1) return (onHand / packUnits) * unitCost;
    return onHand * unitCost;
  };

  const getCountUnits = (item) => {
    // Use explicitly configured count_units if set
    if (item.count_units && item.count_units.length > 0) return item.count_units;
    // Otherwise derive from preferred purchase option
    const baseUnit = item.unit_of_measure || 'EA';
    const units = [{ label: baseUnit, multiplier: 1 }];
    const preferred = item.purchase_options?.find(o => o.is_preferred) || item.purchase_options?.[0];
    const packUnits = preferred?.inner_pack_units || item.inner_pack_units;
    const packName = preferred?.inner_pack_name || item.inner_pack_name;
    const packsPerCase = preferred?.packs_per_case || item.packs_per_case;
    if (packName && packUnits) units.push({ label: packName, multiplier: packUnits });
    if (packName && packUnits && packsPerCase) units.push({ label: 'Case', multiplier: packUnits * packsPerCase });
    return units;
  };

  // Update a per-area quantity. unitInputs = { [unitLabel]: rawNumber }
  const updateAreaQty = (itemIdx, areaId, unitInputs, countUnits) => {
    setActiveCount(prev => {
      const newItems = prev.items.map((row, i) => {
        if (i !== itemIdx) return row;
        const total = countUnits.reduce((sum, u) => sum + (parseFloat(unitInputs[u.label]) || 0) * u.multiplier, 0);
        const area_counts = row.area_counts.map(ac =>
          ac.area_id === areaId ? { ...ac, quantity: total, unit_inputs: unitInputs } : ac
        );
        const counted_quantity = area_counts.reduce((sum, ac) => sum + (ac.quantity || 0), 0);
        return { ...row, area_counts, counted_quantity };
      });
      return { ...prev, items: newItems };
    });
  };

  // Update a simple (no-area) counted quantity. unitInputs = { [unitLabel]: rawNumber }
  const updateCountedQty = (idx, unitInputs, countUnits) => {
    setActiveCount(prev => {
      const newItems = [...prev.items];
      const total = countUnits.reduce((sum, u) => sum + (parseFloat(unitInputs[u.label]) || 0) * u.multiplier, 0);
      newItems[idx] = { ...newItems[idx], counted_quantity: total, unit_inputs: unitInputs };
      return { ...prev, items: newItems };
    });
  };

  const submitCount = async () => {
    setSubmitting(true);
    await base44.entities.InventoryCount.update(activeCount.id, {
      ...activeCount,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    });
    for (const row of activeCount.items) {
      const li = locInv.find(l => l.location_id === activeCount.location_id && l.item_id === row.item_id);
      const data = { location_id: activeCount.location_id, item_id: row.item_id, on_hand_quantity: row.counted_quantity, par_level: li?.par_level || 0, reorder_point: li?.reorder_point || 0 };
      if (li) await base44.entities.LocationInventory.update(li.id, data);
      else await base44.entities.LocationInventory.create(data);
    }
    await load();
    setActiveCount(null);
    setSubmitting(false);
  };

  // ── Active count view ──
  if (activeCount) {
    const areas = getLocAreas(activeCount.location_id);
    const hasAreas = areas.length > 0;
    const isSubmitted = activeCount.status === 'submitted';

    // Items not assigned to any area
    const unassignedItems = activeCount.items.filter(row =>
      !row.area_counts || row.area_counts.length === 0
    );
    const allTabIdx = areas.length + 1; // after areas + summary
    const summaryTabIdx = areas.length;

    return (
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title={`${activeCount.count_type === 'full' ? 'Full' : 'Spot'} Count — ${locName(activeCount.location_id)}`}
          subtitle={hasAreas ? `Counting by storage area — quantities will be summed automatically` : 'Enter actual on-hand quantities'}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setActiveCount(null)}>
                {isSubmitted ? 'Close' : 'Cancel'}
              </Button>
              {!isSubmitted && (
                <Button onClick={submitCount} disabled={submitting}>
                  <CheckCircle className="w-4 h-4 mr-1" />
                  {submitting ? 'Submitting...' : 'Submit Count'}
                </Button>
              )}
            </div>
          }
        />

        {hasAreas ? (
          <>
            {/* Area tabs */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {areas.map((area, idx) => {
                const itemsInThisArea = activeCount.items.filter(row => 
                  row.area_counts?.some(ac => ac.area_id === area.id)
                ).length;
                return (
                  <button
                    key={area.id}
                    onClick={() => setActiveAreaIdx(idx)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeAreaIdx === idx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
                  >
                    {area.name}
                    <span className="ml-1.5 text-xs opacity-70">({itemsInThisArea})</span>
                  </button>
                );
              })}
              {/* Unallocated items tab */}
              {unassignedItems.length > 0 && (
                <button
                  onClick={() => setActiveAreaIdx(allTabIdx)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeAreaIdx === allTabIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
                >
                  Unallocated
                  <span className="ml-1.5 text-xs opacity-70">({unassignedItems.length})</span>
                </button>
              )}
              {/* Summary tab */}
              <button
                onClick={() => setActiveAreaIdx(summaryTabIdx)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeAreaIdx === summaryTabIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
              >
                Summary (Total)
              </button>
            </div>

            {activeAreaIdx === allTabIdx ? (
              // All Items (unassigned to any area)
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-muted/40 border-b border-border">
                  <p className="text-sm font-medium text-foreground">Unallocated Items <span className="text-muted-foreground font-normal">— items not assigned to any storage area</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter total on-hand quantity for each item</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Item', 'Category', 'Previous', 'Counted Qty', 'Value'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {unassignedItems.map((row) => {
                      const itemIdx = activeCount.items.findIndex(r => r.item_id === row.item_id);
                      const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
                      const unitInputs = row.unit_inputs || {};
                      return (
                        <tr key={row.item_id} className="hover:bg-muted/20">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {(() => {
                                const item = items.find(i => i.id === row.item_id);
                                const img = item?.purchase_options?.find(o => o.product_image_url)?.product_image_url;
                                return img ? (
                                  <img src={img} alt="" className="w-8 h-8 object-contain rounded border bg-white" onError={(e) => e.target.style.display = 'none'} />
                                ) : (
                                  <div className="w-8 h-8 flex items-center justify-center bg-muted rounded border">
                                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                                  </div>
                                );
                              })()}
                              <span className="font-medium">{row.item_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{row.category || '—'}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{row.previous_quantity} {row.unit_of_measure}</td>
                          <td className="px-4 py-2.5">
                            {isSubmitted ? (
                              <span className="font-medium">{row.counted_quantity} {row.unit_of_measure}</span>
                            ) : (
                              <div className="flex items-center gap-2 flex-wrap">
                                {countUnits.map(u => (
                                  <div key={u.label} className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      className="w-20 h-8"
                                      placeholder="0"
                                      value={unitInputs[u.label] || ''}
                                      onChange={e => {
                                        const newInputs = { ...unitInputs, [u.label]: e.target.value };
                                        updateCountedQty(itemIdx, newInputs, countUnits);
                                      }}
                                    />
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{u.label}</span>
                                  </div>
                                ))}
                                <span className="text-xs font-medium text-primary ml-1">= {row.counted_quantity} {row.unit_of_measure}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-right text-muted-foreground">Subtotal:</td>
                      <td className="px-4 py-2.5 font-bold text-green-700">${unassignedItems.reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : activeAreaIdx < areas.length ? (
              // Per-area count entry
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-muted/40 border-b border-border">
                  <p className="text-sm font-medium text-foreground">Counting: <span className="text-primary">{areas[activeAreaIdx].name}</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">Enter the quantity of each item found in this area</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Item', 'Category', `Qty in ${areas[activeAreaIdx].name}`, `Total (this area)`, 'Value'].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {activeCount.items.filter(row => {
                     const currentArea = areas[activeAreaIdx];
                     return row.area_counts?.some(ac => ac.area_id === currentArea.id);
                    }).map((row) => {
                     const itemIdx = activeCount.items.findIndex(r => r.item_id === row.item_id);
                     const currentArea = areas[activeAreaIdx];
                     const areaCount = row.area_counts?.find(ac => ac.area_id === currentArea.id) || { quantity: 0 };
                     const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
                     const unitInputs = areaCount.unit_inputs || {};
                     return (
                       <tr key={row.item_id} className="hover:bg-muted/20">
                         <td className="px-4 py-2.5">
                           <div className="flex items-center gap-2">
                             {(() => {
                               const item = items.find(i => i.id === row.item_id);
                               const img = item?.purchase_options?.find(o => o.product_image_url)?.product_image_url;
                               return img ? (
                                 <img src={img} alt="" className="w-8 h-8 object-contain rounded border bg-white" onError={(e) => e.target.style.display = 'none'} />
                               ) : (
                                 <div className="w-8 h-8 flex items-center justify-center bg-muted rounded border">
                                   <Package className="w-3.5 h-3.5 text-muted-foreground" />
                                 </div>
                               );
                             })()}
                             <span className="font-medium">{row.item_name}</span>
                           </div>
                         </td>
                         <td className="px-4 py-2.5 text-muted-foreground">{row.category || '—'}</td>
                         <td className="px-4 py-2.5">
                           {isSubmitted ? (
                             <span className="text-foreground font-medium">{areaCount.quantity || 0} {row.unit_of_measure}</span>
                           ) : (
                             <div className="flex items-center gap-2 flex-wrap">
                               {countUnits.map(u => (
                                 <div key={u.label} className="flex items-center gap-1">
                                   <Input
                                     type="number"
                                     className="w-20 h-8"
                                     placeholder="0"
                                     value={unitInputs[u.label] || ''}
                                     onChange={e => {
                                       const newInputs = { ...unitInputs, [u.label]: e.target.value };
                                       updateAreaQty(itemIdx, currentArea.id, newInputs, countUnits);
                                     }}
                                   />
                                   <span className="text-xs text-muted-foreground whitespace-nowrap">{u.label}</span>
                                 </div>
                               ))}
                             </div>
                           )}
                         </td>
                         <td className="px-4 py-2.5 text-sm font-medium text-primary">
                           {areaCount.quantity || 0} {row.unit_of_measure}
                         </td>
                         <td className="px-4 py-2.5 font-medium text-green-700">${getItemValue(row.item_id, areaCount.quantity || 0).toFixed(2)}</td>
                         </tr>
                         );
                         })}
                         </tbody>
                         <tfoot className="bg-muted/30 border-t border-border">
                         <tr>
                         <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-right text-muted-foreground">Area Total:</td>
                         <td className="px-4 py-2.5 font-bold text-green-700">
                         ${activeCount.items
                           .filter(row => row.area_counts?.some(ac => ac.area_id === areas[activeAreaIdx].id))
                           .reduce((s, row) => {
                             const ac = row.area_counts?.find(c => c.area_id === areas[activeAreaIdx].id);
                             return s + getItemValue(row.item_id, ac?.quantity || 0);
                           }, 0).toFixed(2)}
                         </td>
                         </tr>
                         </tfoot>
                         </table>
                         {!isSubmitted && (
                  <div className="px-4 py-3 border-t border-border flex justify-end">
                    {activeAreaIdx < areas.length - 1 ? (
                      <Button variant="outline" onClick={() => setActiveAreaIdx(i => i + 1)}>
                        Next: {areas[activeAreaIdx + 1].name} <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    ) : unassignedItems.length > 0 ? (
                      <Button variant="outline" onClick={() => setActiveAreaIdx(allTabIdx)}>
                        Next: Unallocated <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => setActiveAreaIdx(summaryTabIdx)}>
                        Next: Summary <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : activeAreaIdx === summaryTabIdx ? (
              // Summary view
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-muted/40 border-b border-border">
                  <p className="text-sm font-medium text-foreground">Summary — Total across all areas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Review combined quantities before submitting</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Item</th>
                      {areas.map(a => (
                        <th key={a.id} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{a.name}</th>
                      ))}
                      <th className="text-left px-4 py-3 text-xs font-semibold text-primary uppercase tracking-wide">Total</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Previous</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-green-700 uppercase tracking-wide">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {activeCount.items.map(row => (
                      <tr key={row.item_id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const item = items.find(i => i.id === row.item_id);
                              const img = item?.purchase_options?.find(o => o.product_image_url)?.product_image_url;
                              return img ? (
                                <img src={img} alt="" className="w-8 h-8 object-contain rounded border bg-white" onError={(e) => e.target.style.display = 'none'} />
                              ) : (
                                <div className="w-8 h-8 flex items-center justify-center bg-muted rounded border">
                                  <Package className="w-3.5 h-3.5 text-muted-foreground" />
                                </div>
                              );
                            })()}
                            <span className="font-medium">{row.item_name}</span>
                          </div>
                        </td>
                        {areas.map((a, ai) => {
                          const ac = row.area_counts?.find(c => c.area_id === a.id);
                          return (
                            <td key={a.id} className="px-4 py-2.5 text-muted-foreground">
                              {ac?.quantity || 0}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 font-bold text-primary">{row.counted_quantity}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.previous_quantity}</td>
                        <td className="px-4 py-2.5 font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</td>
                        </tr>
                        ))}
                        </tbody>
                        <tfoot className="bg-primary/5 border-t-2 border-primary/20">
                        <tr>
                        <td colSpan={areas.length + 2} className="px-4 py-3 text-sm font-semibold text-right text-foreground">Grand Total Value:</td>
                        <td className="px-4 py-3 font-bold text-lg text-green-700">
                        ${activeCount.items.reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}
                        </td>
                        </tr>
                        </tfoot>
                        </table>
              </div>
            ) : null}
          </>
        ) : (
          // No areas — simple entry
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 border-b border-border">
              <p className="text-xs text-amber-700">No storage areas defined for this location. <a href="/stock" className="underline font-medium">Add storage areas</a> in Location Stock to enable per-area counting.</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Item', 'Category', 'Previous Qty', 'Counted Qty', 'UOM', 'Value'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeCount.items.map((row, idx) => {
                  const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
                  const unitInputs = row.unit_inputs || {};
                  return (
                    <tr key={row.item_id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">{row.item_name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.category || '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.previous_quantity}</td>
                      <td className="px-4 py-2.5">
                        {isSubmitted ? (
                          <span className="text-foreground font-medium">{row.counted_quantity} {row.unit_of_measure}</span>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            {countUnits.map(u => (
                              <div key={u.label} className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  className="w-20 h-8"
                                  placeholder="0"
                                  value={unitInputs[u.label] || ''}
                                  onChange={e => {
                                    const newInputs = { ...unitInputs, [u.label]: e.target.value };
                                    updateCountedQty(idx, newInputs, countUnits);
                                  }}
                                />
                                <span className="text-xs text-muted-foreground whitespace-nowrap">{u.label}</span>
                              </div>
                            ))}
                            {countUnits.length > 1 && (
                              <span className="text-xs font-medium text-primary ml-1">= {row.counted_quantity} {row.unit_of_measure}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{row.unit_of_measure}</td>
                      <td className="px-4 py-2.5 font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</td>
                      </tr>
                      );
                      })}
                      </tbody>
                      <tfoot className="bg-primary/5 border-t-2 border-primary/20">
                      <tr>
                      <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-right text-foreground">Grand Total Value:</td>
                      <td className="px-4 py-3 font-bold text-lg text-green-700">
                      ${activeCount.items.reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}
                      </td>
                      </tr>
                      </tfoot>
                      </table>
                      </div>
                      )}
                      </div>
                      );
                      }

  // ── Count history list ──
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Inventory Counts"
        subtitle="Full and spot counts by location"
        actions={<Button onClick={() => setNewCountDialog(true)}><Plus className="w-4 h-4 mr-1" />New Count</Button>}
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Date', 'Location', 'Type', 'Areas', 'Items', 'Total Value', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {counts.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No counts yet. Start your first inventory count.</td></tr>
              ) : counts.map(c => {
                const usedAreas = [...new Set((c.items || []).flatMap(i => (i.area_counts || []).map(ac => ac.area_name)))].filter(Boolean);
                const canResume = c.status === 'in_progress';
                return (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">{format(new Date(c.created_date), 'MMM d, yyyy h:mm a')}</td>
                    <td className="px-4 py-3 font-medium">{locName(c.location_id)}</td>
                    <td className="px-4 py-3 capitalize">{c.count_type}{c.categories?.length > 0 && <span className="text-muted-foreground ml-1 text-xs">({c.categories.join(', ')})</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{usedAreas.length > 0 ? usedAreas.join(', ') : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.items?.length || 0} items</td>
                    <td className="px-4 py-3 font-medium text-green-700">
                      ${(c.items || []).reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity || 0), 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">
                      {canResume ? (
                        <Button variant="ghost" size="sm" onClick={() => resumeCount(c)}>
                          <Pencil className="w-3.5 h-3.5 mr-1" />Resume
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => viewCount(c)}>
                          <Eye className="w-3.5 h-3.5 mr-1" />View
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={newCountDialog} onOpenChange={setNewCountDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Start New Count</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Location *</Label>
              <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.location_id} onChange={e => setForm(f => ({ ...f, location_id: e.target.value }))}>
                <option value="">Select location...</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              {form.location_id && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {getLocAreas(form.location_id).length} storage area(s): {getLocAreas(form.location_id).map(a => a.name).join(', ') || 'none defined'}
                </p>
              )}
            </div>
            <div>
              <Label>Count Type</Label>
              <div className="mt-1 flex gap-2">
                {['full', 'spot'].map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, count_type: t, category: '' }))}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${form.count_type === t ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {form.count_type === 'spot' && (
              <div>
                <Label>Category</Label>
                <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCountDialog(false)}>Cancel</Button>
            <Button onClick={startCount} disabled={!form.location_id}><ClipboardList className="w-4 h-4 mr-1" />Start Count</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}