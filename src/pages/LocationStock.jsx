import { useState, useEffect, Fragment } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Search, Pencil, AlertTriangle, CheckCircle, Plus, Trash2, MapPin, GripVertical, ChevronRight, X, ArrowUpDown, ArrowDownAZ, TrendingUp, Calendar, RefreshCw } from 'lucide-react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export default function LocationStock() {
  const { canAccessLocation } = useAuth();
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [storageAreas, setStorageAreas] = useState([]);
  const [itemAreaMappings, setItemAreaMappings] = useState([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [search, setSearch] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({ par_level: '', reorder_point: '' });
  const [areaDialog, setAreaDialog] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [manageAreasDialog, setManageAreasDialog] = useState(false);
  const [selectedAreaForItems, setSelectedAreaForItems] = useState(null);
  const [sortMode, setSortMode] = useState('manual'); // manual, alpha, count
  const [addItemsDialog, setAddItemsDialog] = useState(false);
  const [loading, setLoading] = useState(true);


  const load = () => Promise.all([
    base44.entities.Location.list(),
    base44.entities.InventoryItem.list(),
    base44.entities.LocationInventory.list(),
    base44.entities.StorageArea.list(),
    base44.entities.ItemStorageArea.list(),
  ]).then(([locs, itms, linv, areas, mappings]) => {
    const filteredLocs = locs.filter(l => canAccessLocation(l.id));
    setLocations(filteredLocs);
    setItems(itms);
    setLocInv(linv);
    setStorageAreas(areas.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    setItemAreaMappings(mappings);
    if (!selectedLoc && filteredLocs.length) setSelectedLoc(filteredLocs[0].id);
    setLoading(false);
  });



  useEffect(() => { 
    load();
  }, []);

  // Reload data when page gains focus or becomes visible (e.g., after returning from Inventory Counts)
  useEffect(() => {
    const handleFocus = () => load();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    const handleInventoryUpdate = () => {
      console.log('Inventory updated event received, reloading...');
      load();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('inventory-updated', handleInventoryUpdate);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('inventory-updated', handleInventoryUpdate);
    };
  }, []);



  const locAreas = storageAreas.filter(a => a.location_id === selectedLoc).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const addArea = async () => {
    if (!newAreaName.trim()) return;
    await base44.entities.StorageArea.create({ name: newAreaName.trim(), location_id: selectedLoc, sort_order: locAreas.length });
    setNewAreaName('');
    setAreaDialog(false);
    await load();
  };

  const deleteArea = async (id) => {
    if (!confirm('Delete this storage area? This will also remove all item assignments.')) return;
    await base44.entities.StorageArea.delete(id);
    const mappingsToDelete = itemAreaMappings.filter(m => m.storage_area_id === id);
    for (const m of mappingsToDelete) {
      await base44.entities.ItemStorageArea.delete(m.id);
    }
    await load();
  };

  const getItemsForArea = (areaId) => {
    const itemIds = itemAreaMappings.filter(m => m.storage_area_id === areaId).map(m => m.item_id);
    return items.filter(i => itemIds.includes(i.id));
  };

  const getItemsForAreaSorted = (areaId, mode) => {
    const areaItems = getItemsForArea(areaId);
    if (mode === 'alpha') {
      return areaItems.sort((a, b) => a.name.localeCompare(b.name));
    } else if (mode === 'count') {
      const li = locInv.find(l => l.location_id === selectedLoc);
      return areaItems.sort((a, b) => {
        const aQty = locInv.find(l => l.location_id === selectedLoc && l.item_id === a.id)?.on_hand_quantity || 0;
        const bQty = locInv.find(l => l.location_id === selectedLoc && l.item_id === b.id)?.on_hand_quantity || 0;
        return bQty - aQty;
      });
    }
    // manual - use sort_order from mapping
    return areaItems.sort((a, b) => {
      const aMap = itemAreaMappings.find(m => m.item_id === a.id && m.storage_area_id === areaId);
      const bMap = itemAreaMappings.find(m => m.item_id === b.id && m.storage_area_id === areaId);
      return (aMap?.sort_order || 0) - (bMap?.sort_order || 0);
    });
  };

  const toggleItemForArea = async (itemId, areaId) => {
    const existing = itemAreaMappings.find(m => m.item_id === itemId && m.storage_area_id === areaId);
    if (existing) {
      await base44.entities.ItemStorageArea.delete(existing.id);
      setItemAreaMappings(prev => prev.filter(m => m.id !== existing.id));
    } else {
      const maxOrder = Math.max(0, ...itemAreaMappings.filter(m => m.storage_area_id === areaId).map(m => m.sort_order || 0));
      const newMapping = await base44.entities.ItemStorageArea.create({ item_id: itemId, storage_area_id: areaId, sort_order: maxOrder + 1 });
      setItemAreaMappings(prev => [...prev, newMapping]);
    }
  };

  const onAreaReorder = async (result) => {
    if (!result.destination) return;
    const reordered = Array.from(locAreas);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    
    for (let i = 0; i < reordered.length; i++) {
      await base44.entities.StorageArea.update(reordered[i].id, { sort_order: i });
    }
    setStorageAreas(prev => prev.map(a => {
      const idx = reordered.findIndex(r => r.id === a.id);
      return idx >= 0 ? { ...a, sort_order: idx } : a;
    }));
  };

  const onItemReorder = async (result) => {
    if (!result.destination || !selectedAreaForItems) return;
    const areaItems = getItemsForAreaSorted(selectedAreaForItems.id, 'manual');
    const reordered = Array.from(areaItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    
    // Update sort_order for all items in this area
    for (let i = 0; i < reordered.length; i++) {
      const mapping = itemAreaMappings.find(m => m.item_id === reordered[i].id && m.storage_area_id === selectedAreaForItems.id);
      if (mapping) {
        await base44.entities.ItemStorageArea.update(mapping.id, { sort_order: i + 1 });
      }
    }
    await load();
  };

  const applySortMode = async (mode) => {
    if (!selectedAreaForItems) return;
    const areaItems = getItemsForArea(selectedAreaForItems.id);
    
    if (mode === 'alpha') {
      areaItems.sort((a, b) => a.name.localeCompare(b.name));
    } else if (mode === 'count') {
      areaItems.sort((a, b) => {
        const aQty = locInv.find(l => l.location_id === selectedLoc && l.item_id === a.id)?.on_hand_quantity || 0;
        const bQty = locInv.find(l => l.location_id === selectedLoc && l.item_id === b.id)?.on_hand_quantity || 0;
        return bQty - aQty;
      });
    }
    
    // Update sort_order
    for (let i = 0; i < areaItems.length; i++) {
      const mapping = itemAreaMappings.find(m => m.item_id === areaItems[i].id && m.storage_area_id === selectedAreaForItems.id);
      if (mapping) {
        await base44.entities.ItemStorageArea.update(mapping.id, { sort_order: i + 1 });
      }
    }
    setSortMode(mode);
    await load();
  };

  const getLocInv = (locId) => {
    return items.filter(item => item.is_active).map(item => {
      const li = locInv.find(l => l.location_id === locId && l.item_id === item.id);
      return { item, li: li || { on_hand_quantity: 0, par_level: 0, reorder_point: 0 }, liId: li?.id };
    });
  };

  const openEdit = (row) => {
    setEditRow(row);
    setEditForm({ 
      par_level: row?.li?.par_level || 0, 
      reorder_point: row?.li?.reorder_point || 0 
    });
  };

  const savePar = async () => {
    const data = { location_id: selectedLoc, item_id: editRow.item.id, on_hand_quantity: editRow.li.on_hand_quantity || 0, par_level: parseFloat(editForm.par_level) || 0, reorder_point: parseFloat(editForm.reorder_point) || 0 };
    if (editRow.liId) await base44.entities.LocationInventory.update(editRow.liId, data);
    else await base44.entities.LocationInventory.create(data);
    await load();
    setEditRow(null);
  };

  // Group items by product_group_id
  const groupedItems = items.filter(i => i.is_active).reduce((acc, item) => {
    const groupId = item.product_group_id || `standalone_${item.id}`;
    if (!acc[groupId]) {
      acc[groupId] = {
        group_id: groupId,
        name: item.product_group_id ? item.purchase_options?.[0]?.product_name || item.name : item.name,
        is_group: !!item.product_group_id,
        items: []
      };
    }
    acc[groupId].items.push(item);
    return acc;
  }, {});

  const rows = getLocInv(selectedLoc).filter(r =>
    r.item.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.item.category?.toLowerCase().includes(search.toLowerCase())
  );

  const getItemValue = (item, onHand) => {
    const preferred = item.purchase_options?.find(o => o.is_preferred) || item.purchase_options?.[0];
    const packUnits = preferred?.inner_pack_units || item.inner_pack_units || 1;
    const packsPerCase = preferred?.packs_per_case || item.packs_per_case;
    const unitCost = preferred?.unit_cost || item.unit_cost || 0;
    if (packsPerCase && packUnits) {
      const unitsPerCase = packUnits * packsPerCase;
      return (onHand / unitsPerCase) * unitCost;
    } else if (packUnits && packUnits > 1) {
      return (onHand / packUnits) * unitCost;
    }
    return onHand * unitCost;
  };
  const locValue = rows.reduce((sum, r) => sum + getItemValue(r.item, r.li.on_hand_quantity || 0), 0);

  const isMobile = useIsMobile();

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader 
        title="Location Stock" 
        subtitle="On-hand quantities, par levels, and storage areas per location"
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />Refresh
          </Button>
        }
      />

      {/* Location selector */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {locations.map(loc => (
          <button
            key={loc.id}
            onClick={() => setSelectedLoc(loc.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${selectedLoc === loc.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-foreground hover:bg-muted'}`}
          >
            {loc.name}
          </button>
        ))}
      </div>

      {selectedLoc && (
        <div className="flex flex-wrap items-start gap-4 mb-6">
          {/* Inventory value */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3">
            <span className="text-sm text-muted-foreground">Inventory value: </span>
            <span className="text-lg font-bold text-primary">${locValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          {/* Storage areas */}
          <div className="flex-1 bg-card border border-border rounded-lg px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                Storage Areas
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setManageAreasDialog(true); setSelectedAreaForItems(null); }}>
                  <Pencil className="w-3 h-3 mr-1" />Edit Areas
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAreaDialog(true)}>
                  <Plus className="w-3 h-3 mr-1" />Add Area
                </Button>
              </div>
            </div>
            {locAreas.length === 0 ? (
              <p className="text-xs text-muted-foreground">No storage areas defined. Add areas like "Front Counter", "Back Counter", "Walk-in Cooler" to enable per-area counting.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {locAreas.map(area => (
                  <div key={area.id} className="flex items-center gap-1 bg-muted rounded-full pl-3 pr-1 py-0.5">
                    <span className="text-xs font-medium">{area.name}</span>
                    <span className="text-xs text-muted-foreground">({getItemsForArea(area.id).length} items)</span>
                    <button onClick={() => deleteArea(area.id)} className="w-4 h-4 rounded-full hover:bg-destructive/20 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search items..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : isMobile ? (
          <div className="space-y-3 p-3">
            {Object.values(groupedItems).map(group => {
              if (group.is_group && group.items.length > 1) {
                return (
                  <Fragment key={group.group_id}>
                    <div className="px-3 py-2 bg-muted/40 rounded-lg">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.name} ({group.items.length} variants)</p>
                    </div>
                    {group.items.sort((a, b) => (a.group_sort_order || 0) - (b.group_sort_order || 0)).map(item => {
                      const li = locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id);
                      const onHand = li?.on_hand_quantity || 0;
                      const par = li?.par_level || 0;
                      const isLow = par > 0 && onHand < par;
                      const rowLi = li || { on_hand_quantity: 0, par_level: 0, reorder_point: 0 };
                      return (
                        <div key={item.id} className={`bg-card border rounded-xl p-4 ${isLow ? 'border-red-200' : 'border-border'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{item.name}</p>
                              {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
                            </div>
                            <div className="flex items-center gap-2">
                              {isLow ? <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle className="w-3 h-3" />Low</span> : <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3 h-3" />OK</span>}
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit({ item, li: rowLi, liId: li?.id })}><Pencil className="w-3.5 h-3.5" /></Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border text-xs">
                            <div><p className="text-muted-foreground">On Hand</p><p className={`font-semibold mt-0.5 ${isLow ? 'text-red-600' : ''}`}>{onHand} <span className="text-muted-foreground font-normal">{item.unit_of_measure}</span></p></div>
                            <div><p className="text-muted-foreground">Par</p><p className="font-medium mt-0.5">{par || '—'}</p></div>
                            <div><p className="text-muted-foreground">Value</p><p className="font-medium mt-0.5">${getItemValue(item, onHand).toFixed(2)}</p></div>
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              } else {
                const item = group.items[0];
                const li = locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id);
                const onHand = li?.on_hand_quantity || 0;
                const par = li?.par_level || 0;
                const isLow = par > 0 && onHand < par;
                const rowLi = li || { on_hand_quantity: 0, par_level: 0, reorder_point: 0 };
                return (
                  <div key={item.id} className={`bg-card border rounded-xl p-4 ${isLow ? 'border-red-200' : 'border-border'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{item.name}</p>
                        {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {isLow ? <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle className="w-3 h-3" />Low</span> : <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3 h-3" />OK</span>}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit({ item, li: rowLi, liId: li?.id })}><Pencil className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border text-xs">
                      <div><p className="text-muted-foreground">On Hand</p><p className={`font-semibold mt-0.5 ${isLow ? 'text-red-600' : ''}`}>{onHand} <span className="text-muted-foreground font-normal">{item.unit_of_measure}</span></p></div>
                      <div><p className="text-muted-foreground">Par</p><p className="font-medium mt-0.5">{par || '—'}</p></div>
                      <div><p className="text-muted-foreground">Value</p><p className="font-medium mt-0.5">${getItemValue(item, onHand).toFixed(2)}</p></div>
                    </div>
                  </div>
                );
              }
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Item', 'Category', 'On Hand', 'Par Level', 'Reorder Point', 'Value', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {Object.values(groupedItems).map(group => {
                  if (group.is_group && group.items.length > 1) {
                    return (
                      <Fragment key={group.group_id}>
                        <tr className="bg-muted/30">
                          <td colSpan={8} className="px-4 py-2 font-semibold text-foreground">
                            {group.name} ({group.items.length} variants)
                          </td>
                        </tr>
                        {group.items.sort((a, b) => (a.group_sort_order || 0) - (b.group_sort_order || 0)).map(item => {
                          const li = locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id);
                          const onHand = li?.on_hand_quantity || 0;
                          const par = li?.par_level || 0;
                          const isLow = par > 0 && onHand < par;
                          const rowLi = li || { on_hand_quantity: 0, par_level: 0, reorder_point: 0 };
                          return (
                            <tr key={item.id} className={`hover:bg-muted/30 ${isLow ? 'bg-red-50/50' : ''}`}>
                              <td className="px-4 py-3 pl-8 text-muted-foreground"><span className="text-xs">└─</span> {item.name}</td>
                              <td className="px-4 py-3 text-muted-foreground">{item.category || '—'}</td>
                              <td className="px-4 py-3"><span className={`font-semibold ${isLow ? 'text-red-600' : 'text-foreground'}`}>{onHand}</span><span className="text-muted-foreground ml-1 text-xs">{item.unit_of_measure}</span></td>
                              <td className="px-4 py-3 text-muted-foreground">{par || '—'}</td>
                              <td className="px-4 py-3 text-muted-foreground">{li?.reorder_point || '—'}</td>
                              <td className="px-4 py-3 font-medium">${getItemValue(item, onHand, li?.unit_cost).toFixed(2)}</td>
                              <td className="px-4 py-3">{isLow ? <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle className="w-3 h-3" />Low</span> : <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3 h-3" />OK</span>}</td>
                              <td className="px-4 py-3"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit({ item, li: rowLi, liId: li?.id })}><Pencil className="w-3.5 h-3.5" /></Button></td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  } else {
                    const item = group.items[0];
                    const li = locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id);
                    const onHand = li?.on_hand_quantity || 0;
                    const par = li?.par_level || 0;
                    const isLow = par > 0 && onHand < par;
                    const rowLi = li || { on_hand_quantity: 0, par_level: 0, reorder_point: 0 };
                    return (
                      <tr key={item.id} className={`hover:bg-muted/30 transition-colors ${isLow ? 'bg-red-50/50' : ''}`}>
                        <td className="px-4 py-3 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{item.category || '—'}</td>
                        <td className="px-4 py-3"><span className={`font-semibold ${isLow ? 'text-red-600' : 'text-foreground'}`}>{onHand}</span><span className="text-muted-foreground ml-1 text-xs">{item.unit_of_measure}</span></td>
                        <td className="px-4 py-3 text-muted-foreground">{par || '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{li?.reorder_point || '—'}</td>
                        <td className="px-4 py-3 font-medium">${getItemValue(item, onHand, li?.unit_cost).toFixed(2)}</td>
                        <td className="px-4 py-3">{isLow ? <span className="flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle className="w-3 h-3" />Low</span> : <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3 h-3" />OK</span>}</td>
                        <td className="px-4 py-3"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit({ item, li: rowLi, liId: li?.id })}><Pencil className="w-3.5 h-3.5" /></Button></td>
                      </tr>
                    );
                  }
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit par dialog */}
      <Dialog open={!!editRow} onOpenChange={() => setEditRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit Par Levels — {editRow?.item?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Par Level</Label>
              <Input className="mt-1" type="number" value={editForm.par_level} onChange={e => setEditForm(f => ({ ...f, par_level: e.target.value }))} />
            </div>
            <div>
              <Label>Reorder Point</Label>
              <Input className="mt-1" type="number" value={editForm.reorder_point} onChange={e => setEditForm(f => ({ ...f, reorder_point: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
            <Button onClick={savePar}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add storage area dialog */}
      <Dialog open={areaDialog} onOpenChange={setAreaDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Storage Area</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label>Area Name</Label>
            <Input className="mt-1" placeholder="e.g. Front Counter, Walk-in Cooler, Dry Storage" value={newAreaName} onChange={e => setNewAreaName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addArea()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAreaDialog(false)}>Cancel</Button>
            <Button onClick={addArea} disabled={!newAreaName.trim()}>Add Area</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage items per area dialog */}
      <Dialog open={manageAreasDialog} onOpenChange={setManageAreasDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Manage Storage Area Items</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col gap-4 mt-2">
            {!selectedAreaForItems ? (
              // Area selection
              <div className="grid grid-cols-2 gap-4 overflow-y-auto">
                {locAreas.map(area => (
                  <button
                    key={area.id}
                    onClick={() => { setSelectedAreaForItems(area); setSortMode('manual'); }}
                    className="p-4 border border-border rounded-lg hover:bg-muted text-left transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">{area.name}</p>
                        <p className="text-sm text-muted-foreground mt-1">{getItemsForArea(area.id).length} items assigned</p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              // Item assignment for selected area
              <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-medium text-foreground">{selectedAreaForItems.name}</p>
                  <p className="text-sm text-muted-foreground">{getItemsForArea(selectedAreaForItems.id).length} items in this area</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAddItemsDialog(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" />Add Items
                  </Button>
                  <Button variant={sortMode === 'alpha' ? 'default' : 'outline'} size="sm" onClick={() => applySortMode('alpha')}>
                    <ArrowDownAZ className="w-3.5 h-3.5 mr-1" />A-Z
                  </Button>
                  <Button variant={sortMode === 'count' ? 'default' : 'outline'} size="sm" onClick={() => applySortMode('count')}>
                    <TrendingUp className="w-3.5 h-3.5 mr-1" />By Count
                  </Button>
                  <Button variant={sortMode === 'manual' ? 'default' : 'outline'} size="sm" onClick={() => setSortMode('manual')}>
                    <ArrowUpDown className="w-3.5 h-3.5 mr-1" />Manual
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => { setSelectedAreaForItems(null); setSortMode('manual'); }}>Back</Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto border border-border rounded-lg">
                  {sortMode === 'manual' ? (
                    <DragDropContext onDragEnd={onItemReorder}>
                      <Droppable droppableId="items">
                        {(provided) => (
                          <table className="w-full text-sm" ref={provided.innerRef} {...provided.droppableProps}>
                            <thead className="bg-muted/50 sticky top-0">
                              <tr>
                                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground w-10"></th>
                                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Item</th>
                                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Category</th>
                                <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">On Hand</th>
                                <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground">In this area</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {getItemsForAreaSorted(selectedAreaForItems.id, 'manual').map((item, index) => (
                                <Draggable key={item.id} draggableId={item.id} index={index}>
                                  {(provided, snapshot) => (
                                    <tr
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      className={`hover:bg-muted/30 ${snapshot.isDragging ? 'bg-muted shadow-lg' : ''}`}
                                    >
                                      <td className="px-4 py-2.5" {...provided.dragHandleProps}>
                                        <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
                                      </td>
                                      <td className="px-4 py-2.5 font-medium">{item.name}</td>
                                      <td className="px-4 py-2.5 text-muted-foreground">{item.category || '—'}</td>
                                      <td className="px-4 py-2.5 text-muted-foreground">
                                        {locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id)?.on_hand_quantity || 0}
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <button
                                          onClick={() => toggleItemForArea(item.id, selectedAreaForItems.id)}
                                          className="text-red-600 hover:text-red-700 text-xs font-medium"
                                        >
                                          Remove
                                        </button>
                                      </td>
                                    </tr>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            </tbody>
                          </table>
                        )}
                      </Droppable>
                    </DragDropContext>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Item</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Category</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">On Hand</th>
                          <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground">In this area</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {getItemsForAreaSorted(selectedAreaForItems.id, sortMode).map(item => (
                          <tr key={item.id} className="hover:bg-muted/30">
                            <td className="px-4 py-2.5 font-medium">{item.name}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{item.category || '—'}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id)?.on_hand_quantity || 0}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                onClick={() => toggleItemForArea(item.id, selectedAreaForItems.id)}
                                className="text-red-600 hover:text-red-700 text-xs font-medium"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setManageAreasDialog(false); setSelectedAreaForItems(null); setSortMode('manual'); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Items dialog */}
      <Dialog open={addItemsDialog} onOpenChange={setAddItemsDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Items to {selectedAreaForItems?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col mt-2">
            <div className="mb-3">
              <Input
                placeholder="Search items..."
                className="max-w-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Item</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Category</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">On Hand</th>
                    <th className="text-center px-4 py-2 text-xs font-semibold text-muted-foreground">Add</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items
                    .filter(item => item.is_active)
                    .filter(item =>
                      item.name?.toLowerCase().includes(search.toLowerCase()) ||
                      item.category?.toLowerCase().includes(search.toLowerCase())
                    )
                    .map(item => {
                      const alreadyAdded = itemAreaMappings.some(m => m.item_id === item.id && m.storage_area_id === selectedAreaForItems?.id);
                      return (
                        <tr key={item.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-medium">{item.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">{item.category || '—'}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {locInv.find(l => l.location_id === selectedLoc && l.item_id === item.id)?.on_hand_quantity || 0}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {alreadyAdded ? (
                              <span className="text-green-600 text-xs font-medium">Already added</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => toggleItemForArea(item.id, selectedAreaForItems.id)}
                              >
                                <Plus className="w-3.5 h-3.5 mr-1" />Add
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAddItemsDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}