import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Plus, ClipboardList, CheckCircle, ChevronRight, Eye, Pencil, Package, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';
import { toast } from 'sonner';
import MobileCountDialog from '@/components/counts/MobileCountDialog';

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
  const [savingDraft, setSavingDraft] = useState(false);
  const [companyId, setCompanyId] = useState(null);
  const [unallocatedSearch, setUnallocatedSearch] = useState('');
  const [areaSearches, setAreaSearches] = useState({});
  const [openAreaSelector, setOpenAreaSelector] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [countToDelete, setCountToDelete] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [mobileCountItem, setMobileCountItem] = useState(null);
  const [mobileCountItemIdx, setMobileCountItemIdx] = useState(null);
  const mobileDialogOpen = !!mobileCountItem;
  const isMobile = useIsMobile();

  // Close area selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (openAreaSelector !== null && !e.target.closest('[data-area-selector]')) {
        setOpenAreaSelector(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openAreaSelector]);

  const getAreaSearch = (areaId) => areaSearches[areaId] || '';
  const setAreaSearch = (areaId, value) => setAreaSearches(prev => ({ ...prev, [areaId]: value }));

  const toggleItemArea = async (itemIdx, areaId, areaName) => {
    setActiveCount(prev => {
      const newItems = [...prev.items];
      const item = { ...newItems[itemIdx] };
      
      if (!item.area_counts) item.area_counts = [];
      
      const existingIdx = item.area_counts.findIndex(ac => ac.area_id === areaId);
      if (existingIdx >= 0) {
        // Remove from this area
        item.area_counts.splice(existingIdx, 1);
      } else {
        // Add to this area
        item.area_counts.push({
          area_id: areaId,
          area_name: areaName,
          quantity: 0,
          unit_inputs: {}
        });
        // Persist the area assignment
        const selectedLocation = locations.find(l => l.id === activeCount.location_id);
        const existingMapping = itemAreaMappings.find(m => 
          m.item_id === item.item_id && m.storage_area_id === areaId
        );
        if (!existingMapping) {
          base44.entities.ItemStorageArea.create({
            company_id: selectedLocation?.company_id || companyId,
            item_id: item.item_id,
            storage_area_id: areaId,
            sort_order: 0
          });
        }
      }
      
      newItems[itemIdx] = item;
      return { ...prev, items: newItems };
    });
  };

  const load = () => Promise.all([
    base44.entities.Location.list(),
    base44.entities.InventoryItem.filter({ is_active: true }),
    base44.entities.LocationInventory.list(),
    base44.entities.StorageArea.list(),
    base44.entities.ItemStorageArea.list(),
    base44.entities.InventoryCount.list('-created_date', 50),
  ]).then(async ([locs, itms, linv, areas, mappings, cnts]) => {
    const accessibleLocs = locs.filter(l => canAccessLocation(l.id));
    const accessibleLocIds = new Set(accessibleLocs.map(l => l.id));
    setLocations(accessibleLocs);
    setItems(itms);
    setLocInv(linv);
    setStorageAreas(areas.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    setItemAreaMappings(mappings);
    setCounts(cnts.filter(c => accessibleLocIds.has(c.location_id)));
    
    // Get company_id from current user
    const user = await base44.auth.me();
    setCompanyId(user.company_id);
    
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

  const startCount = async (status = 'draft') => {
    // Load variants for all items
    const allVariants = await base44.entities.ItemVariant.list();
    
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

    // Build count rows, grouping variants under parent items
    const countRows = [];
    const processedItems = new Set();
    
    // Group items by product_group_id if they have one
    const groupedItems = {};
    const standaloneItems = [];
    
    countItems.forEach(item => {
      if (item.product_group_id) {
        if (!groupedItems[item.product_group_id]) {
          groupedItems[item.product_group_id] = [];
        }
        groupedItems[item.product_group_id].push(item);
      } else {
        standaloneItems.push(item);
      }
    });
    
    // Process grouped items - create one parent row per group
    Object.entries(groupedItems).forEach(([groupId, items]) => {
      if (items.length === 0) return;
      
      // Sort items by group_sort_order
      items.sort((a, b) => (a.group_sort_order || 0) - (b.group_sort_order || 0));
      
      // Use first item as the base (they should all have same name/category/uom)
      const baseItem = items[0];
      
      // Extract base name by removing the variant suffix (last " - Something")
      const variantName = baseItem.name.split(' - ').pop();
      const baseName = baseItem.name.substring(0, baseItem.name.length - variantName.length - 3); // -3 for " - "
      
      const mappedAreas = areas.filter(a => 
        itemAreaMappings.some(m => items.some(it => it.id === m.item_id) && m.storage_area_id === a.id)
      );
      const area_counts = mappedAreas.map(a => ({ area_id: a.id, area_name: a.name, quantity: 0, unit_inputs: {} }));
      
      // Create parent row with variant names as count units
      countRows.push({
        item_id: baseItem.id,
        product_group_id: groupId,
        variant_id: null,
        item_name: baseName,
        variant_name: null,
        category: baseItem.category || '',
        unit_of_measure: baseItem.unit_of_measure,
        count_units: items.map(it => ({ label: it.name.split(' - ').pop(), multiplier: 1 })),
        previous_quantity: 0,
        counted_quantity: 0,
        unit_inputs: {},
        area_counts,
        has_variants: true,
        grouped_items: items.map(it => ({
          item_id: it.id,
          item_name: it.name,
          variant_name: it.name.split(' - ').pop(),
        }))
      });
      
      items.forEach(it => processedItems.add(it.id));
    });
    
    // Process standalone items
    standaloneItems.forEach(item => {
      if (processedItems.has(item.id)) return;
      processedItems.add(item.id);
      
      const mappedAreas = areas.filter(a => 
        itemAreaMappings.some(m => m.item_id === item.id && m.storage_area_id === a.id)
      );
      const area_counts = mappedAreas.map(a => ({ area_id: a.id, area_name: a.name, quantity: 0, unit_inputs: {} }));
      
      const li = locInv.find(l => l.location_id === form.location_id && l.item_id === item.id);
      
      // Regular item without variants
      countRows.push({
        item_id: item.id,
        variant_id: null,
        item_name: item.name,
        variant_name: null,
        category: item.category || '',
        unit_of_measure: item.unit_of_measure,
        count_units: getCountUnits(item),
        previous_quantity: li?.on_hand_quantity || 0,
        counted_quantity: 0,
        unit_inputs: {},
        area_counts,
      });
    });

    const selectedLocation = locations.find(l => l.id === form.location_id);
    const count = await base44.entities.InventoryCount.create({
      company_id: selectedLocation?.company_id || companyId,
      location_id: form.location_id,
      count_type: form.count_type,
      status: status,
      categories: form.category ? [form.category] : [],
      items: countRows,
    });
    setActiveCount({ ...count, items: countRows });
    setActiveAreaIdx(0);
    setNewCountDialog(false);
    setUnallocatedSearch('');
  };

  const resumeCount = async (count) => {
    // Refresh the count data and restore count_units for each item
    const freshCount = await base44.entities.InventoryCount.get(count.id);
    
    // Restore count_units based on whether item has variants
    const restoredItems = freshCount.items.map(item => {
      // If this is a variant item, ensure count_units is set correctly
      if (item.variant_id && item.variant_name) {
        return {
          ...item,
          count_units: item.count_units || [{ label: item.variant_name, multiplier: 1 }],
          unit_inputs: item.unit_inputs || {},
          area_counts: item.area_counts?.map(ac => ({
            ...ac,
            unit_inputs: ac.unit_inputs || {}
          })) || []
        };
      }
      // Regular item - preserve existing count_units or derive from item
      const baseItem = items.find(i => i.id === item.item_id);
      return {
        ...item,
        count_units: item.count_units || getCountUnits(baseItem),
        unit_inputs: item.unit_inputs || {},
        area_counts: item.area_counts?.map(ac => ({
          ...ac,
          unit_inputs: ac.unit_inputs || {}
        })) || []
      };
    });
    
    setActiveCount({ ...freshCount, items: restoredItems });
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

  const getCountUnits = (item, variant = null) => {
    // Use explicitly configured count_units if set
    if (item.count_units && item.count_units.length > 0) return item.count_units;
    // Otherwise derive from preferred purchase option
    const baseUnit = item.unit_of_measure || 'EA';
    const units = [{ label: baseUnit, multiplier: 1 }];
    
    // If item has variants, add each variant as a count unit
    if (item.has_variants && variant) {
      // For variant items, the variant itself is the count unit
      return [{ label: variant.variant_name || baseUnit, multiplier: 1 }];
    }
    
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

  const openMobileCount = (item, itemIdx) => {
    setMobileCountItem(item);
    setMobileCountItemIdx(itemIdx);
  };

  const handleNextItem = () => {
    if (mobileCountItemIdx === null || !activeCount) return;
    const nextIdx = mobileCountItemIdx + 1;
    if (nextIdx < activeCount.items.length) {
      const nextItem = activeCount.items[nextIdx];
      setMobileCountItem(nextItem);
      setMobileCountItemIdx(nextIdx);
    } else {
      // No more items
      setMobileCountItem(null);
      setMobileCountItemIdx(null);
    }
  };

  const handleMobileQtyChange = (newInputs) => {
    if (mobileCountItemIdx === null || !mobileCountItem) return;
    
    const row = activeCount.items[mobileCountItemIdx];
    const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
    
    if (row.area_counts && row.area_counts.length > 0) {
      // Has areas - update first area
      const firstArea = row.area_counts?.[0];
      if (firstArea) {
        updateAreaQty(mobileCountItemIdx, firstArea.area_id, newInputs, countUnits);
      }
    } else {
      // No areas - update directly
      updateCountedQty(mobileCountItemIdx, newInputs, countUnits);
    }
  };

  const handleToggleVariant = (variantId) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(variantId)) {
        next.delete(variantId);
      } else {
        next.add(variantId);
      }
      return next;
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
    try {
      const selectedLocation = locations.find(l => l.id === activeCount.location_id);
      const countCompanyId = selectedLocation?.company_id || companyId;
      
      // First, persist area assignments to ItemStorageArea
      const areaAssignments = [];
      for (const row of activeCount.items) {
        if (row.area_counts && row.area_counts.length > 0) {
          for (const ac of row.area_counts) {
            const area = storageAreas.find(a => a.id === ac.area_id);
            if (area) {
              const existing = itemAreaMappings.find(m => 
                m.item_id === row.item_id && m.storage_area_id === ac.area_id
              );
              if (!existing) {
                areaAssignments.push({
                  company_id: countCompanyId,
                  item_id: row.item_id,
                  storage_area_id: ac.area_id,
                  sort_order: 0
                });
              }
            }
          }
        }
      }
      
      // Create area assignments in bulk (single API call)
      if (areaAssignments.length > 0) {
        await base44.entities.ItemStorageArea.bulkCreate(areaAssignments);
      }
      
      // Update location inventory - aggregate variants for same item
      const updates = [];
      const creates = [];
      const itemQtyMap = {}; // Track total quantity per item_id (sum of all variants)
      
      // Aggregate quantities by item_id for ALL items (including zeros)
      // We write every item so that zeroing out a count actually clears old values
      for (const row of activeCount.items) {
        // Skip parent group rows - aggregate from grouped_items instead
        if (row.has_variants && row.grouped_items) continue;
        
        if (!itemQtyMap[row.item_id]) {
          itemQtyMap[row.item_id] = 0;
        }
        itemQtyMap[row.item_id] += row.counted_quantity || 0;
      }
      
      // Handle grouped items - sum variant counts by variant label
      for (const row of activeCount.items) {
        if (!row.has_variants || !row.grouped_items) continue;
        
        const unitInputs = row.unit_inputs || {};
        row.grouped_items.forEach((variant) => {
          const variantLabel = variant.variant_name;
          const qty = parseFloat(unitInputs[variantLabel]) || 0;
          if (!itemQtyMap[variant.item_id]) {
            itemQtyMap[variant.item_id] = 0;
          }
          itemQtyMap[variant.item_id] += qty;
        });
      }
      
      // Create update/create for each unique item that was counted
      for (const [itemId, totalQty] of Object.entries(itemQtyMap)) {
        const li = locInv.find(l => l.location_id === activeCount.location_id && l.item_id === itemId);
        const data = { 
          company_id: countCompanyId, 
          location_id: activeCount.location_id, 
          item_id: itemId, 
          on_hand_quantity: totalQty, 
          par_level: li?.par_level || 0, 
          reorder_point: li?.reorder_point || 0 
        };
        if (li) {
          updates.push({ id: li.id, data });
        } else {
          creates.push(data);
        }
      }
      
      const total = Object.keys(itemQtyMap).length;
      toast.info(`Updating ${total} inventory records...`);

      // Build a map of itemId -> existing LocationInventory record ID (from already-loaded locInv)
      const locInvMap = {};
      for (const itemId of Object.keys(itemQtyMap)) {
        const li = locInv.find(l => l.location_id === activeCount.location_id && l.item_id === itemId);
        if (li) locInvMap[itemId] = li.id;
      }

      // Use backend function to do bulk updates server-side (avoids rate limits)
      const result = await base44.functions.invoke('submitInventoryCount', {
        countId: activeCount.id,
        locationId: activeCount.location_id,
        companyId: countCompanyId,
        itemQtyMap,
        locInvMap,
      });
      
      toast.success(`Updated ${result.data.updated + result.data.created} inventory records`);
      
      await load();
      setActiveCount(null);
      window.dispatchEvent(new CustomEvent('inventory-updated'));
      toast.success('Count submitted successfully!');
    } catch (err) {
      console.error('Submit count error:', err);
      toast.error('Failed to submit count: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      await base44.entities.InventoryCount.update(activeCount.id, {
        ...activeCount,
        status: 'draft',
      });
      await load();
      setActiveCount(null);
      toast.success('Draft saved!');
    } catch (err) {
      toast.error('Failed to save draft: ' + err.message);
    } finally {
      setSavingDraft(false);
    }
  };

  const deleteCount = async () => {
    if (!countToDelete) return;
    try {
      await base44.entities.InventoryCount.delete(countToDelete.id);
      await load();
      setDeleteConfirmOpen(false);
      setCountToDelete(null);
      toast.success('Count deleted!');
    } catch (err) {
      if (err.status === 404) {
        toast.error('This count was already deleted');
      } else {
        toast.error('Failed to delete count: ' + err.message);
      }
    } finally {
      setDeleteConfirmOpen(false);
      setCountToDelete(null);
    }
  };

  const reopenCount = async (count) => {
    await base44.entities.InventoryCount.update(count.id, {
      ...count,
      status: 'in_progress',
      submitted_at: null,
      submitted_by: null,
    });
    await load();
    toast.success('Count reopened for editing');
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
    const unallocatedTabIdx = areas.length + 1; // after areas
    const allItemsTabIdx = areas.length + 2; // after unallocated
    const summaryTabIdx = areas.length;

    return (
      <div className={isMobile ? "p-3 max-w-full" : "p-6 max-w-5xl mx-auto"}>
        <PageHeader
          title={`${activeCount.count_type === 'full' ? 'Full' : 'Spot'} Count — ${locName(activeCount.location_id)}`}
          subtitle={hasAreas ? `Counting by storage area — quantities will be summed automatically` : 'Enter actual on-hand quantities'}
          actions={
            <div className={isMobile ? "flex gap-1 flex-wrap" : "flex gap-2"}>
              <Button variant="outline" onClick={() => {
                setActiveCount(null);
                setUnallocatedSearch('');
              }} className={isMobile ? "text-xs px-2 py-1 h-8" : ""}>
                {isSubmitted ? 'Close' : 'Cancel'}
              </Button>
              {!isSubmitted && (
                <>
                  <Button variant="outline" onClick={saveDraft} disabled={savingDraft} className={isMobile ? "text-xs px-2 py-1 h-8" : ""}>
                    {savingDraft ? 'Saving...' : 'Save Draft'}
                  </Button>
                  <Button onClick={submitCount} disabled={submitting} className={isMobile ? "text-xs px-2 py-1 h-8" : ""}>
                    <CheckCircle className={isMobile ? "w-3 h-3 mr-1" : "w-4 h-4 mr-1"} />
                    {submitting ? 'Submitting...' : 'Submit Count'}
                  </Button>
                </>
              )}
            </div>
          }
        />

        {hasAreas ? (
          <>
            {/* Area tabs */}
            <div className={isMobile ? "flex items-center gap-1 mb-3 flex-wrap" : "flex items-center gap-2 mb-4 flex-wrap"}>
              {areas.map((area, idx) => {
                const itemsInThisArea = activeCount.items.filter(row => 
                  row.area_counts?.some(ac => ac.area_id === area.id)
                ).length;
                return (
                  <button
                    key={area.id}
                    onClick={() => setActiveAreaIdx(idx)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${activeAreaIdx === idx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
                  >
                    {area.name}
                    <span className="ml-1 text-xs opacity-70">({itemsInThisArea})</span>
                  </button>
                );
              })}
              {/* Unallocated items tab */}
              {unassignedItems.length > 0 && (
                <button
                  onClick={() => setActiveAreaIdx(unallocatedTabIdx)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeAreaIdx === unallocatedTabIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
                >
                  Unallocated
                  <span className="ml-1.5 text-xs opacity-70">({unassignedItems.length})</span>
                </button>
              )}
              {/* All Items tab */}
              <button
                onClick={() => setActiveAreaIdx(allItemsTabIdx)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeAreaIdx === allItemsTabIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
              >
                All Items
                <span className="ml-1.5 text-xs opacity-70">({activeCount.items.length})</span>
              </button>
              {/* Summary tab */}
              <button
                onClick={() => setActiveAreaIdx(summaryTabIdx)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${activeAreaIdx === summaryTabIdx ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}
              >
                Summary (Total)
              </button>
            </div>

            {activeAreaIdx === allItemsTabIdx ? (
              // All Items - complete view with area assignment
              <div className={isMobile ? "space-y-3" : "bg-card border border-border rounded-xl overflow-hidden"}>
                <div className={`px-4 py-3 bg-muted/40 border-b border-border ${isMobile ? 'rounded-lg' : ''}`}>
                  <div className={isMobile ? "space-y-2" : "flex items-center justify-between gap-4"}>
                    <div>
                      <p className="text-sm font-medium text-foreground">All Items <span className="text-muted-foreground font-normal">— complete inventory count</span></p>
                      <p className="text-xs text-muted-foreground mt-0.5">Enter quantities and manage area assignments</p>
                    </div>
                    <Input type="search" placeholder="Search items..." className={isMobile ? "w-full h-10" : "w-48 h-8"} value={unallocatedSearch} onChange={e => setUnallocatedSearch(e.target.value)} />
                  </div>
                </div>
                {isMobile ? (
                 <div className="space-y-3 px-3 pb-3">
                   {activeCount.items.filter(row => {
                     if (!unallocatedSearch.trim()) return true;
                     const s = unallocatedSearch.toLowerCase();
                     return row.item_name.toLowerCase().includes(s) || (row.category && row.category.toLowerCase().includes(s));
                   }).map((row) => {
                     const rowIdx = activeCount.items.findIndex(r => r.item_id === row.item_id);
                     const isUnallocated = !row.area_counts || row.area_counts.length === 0;
                     return (
                       <div key={row.item_id} className="bg-card border border-border rounded-lg overflow-hidden">
                         <div onClick={() => !isSubmitted && openMobileCount(row, rowIdx)}
                           className={`p-4 space-y-2 ${!isSubmitted ? 'cursor-pointer active:bg-muted' : ''}`}>
                           <div className="flex items-start justify-between gap-2">
                             <div className="flex-1">
                               <p className="font-semibold text-sm">{row.item_name}</p>
                               {row.category && <p className="text-xs text-muted-foreground">{row.category}</p>}
                               {isUnallocated && areas.length > 0 && <p className="text-xs text-amber-600 font-medium">Unallocated</p>}
                             </div>
                             <div className="text-right">
                               <p className="text-lg font-bold text-primary">{row.counted_quantity || 0}</p>
                               <p className="text-xs text-muted-foreground">{row.unit_of_measure}</p>
                             </div>
                           </div>
                           <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
                             <span className="text-muted-foreground">Previous: {row.previous_quantity}</span>
                             <span className="font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</span>
                           </div>
                         </div>
                         {!isSubmitted && areas.length > 0 && (
                           <div className="px-4 py-2 bg-muted/30 border-t border-border">
                             <p className="text-xs text-muted-foreground mb-2">Add to area:</p>
                             <div className="flex flex-wrap gap-2">
                               {areas.map(a => {
                                 const isInArea = row.area_counts?.some(ac => ac.area_id === a.id);
                                 return (
                                   <button
                                     key={a.id}
                                     onClick={(e) => { e.stopPropagation(); toggleItemArea(rowIdx, a.id, a.name); }}
                                     className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${isInArea ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground hover:bg-muted'}`}
                                   >
                                     {isInArea ? '✓ ' : ''}{a.name}
                                   </button>
                                 );
                               })}
                             </div>
                           </div>
                         )}
                       </div>
                     );
                   })}
                 </div>
                ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Item', 'Category', 'Previous', 'Counted Qty', 'Value', hasAreas ? 'Add to Area(s)' : null].filter(Boolean).map((h, i) => (
                        <th key={i} className={`text-left ${isMobile ? 'px-2 py-2' : 'px-4 py-3'} text-xs font-semibold text-muted-foreground uppercase tracking-wide`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {activeCount.items
                      .filter(row => {
                        if (!unallocatedSearch.trim()) return true;
                        const search = unallocatedSearch.toLowerCase();
                        return row.item_name.toLowerCase().includes(search) || 
                               (row.category && row.category.toLowerCase().includes(search));
                      })
                      .map((row) => {
                        const itemIdx = activeCount.items.findIndex(r => r === row);
                        const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
                        const isUnallocated = !row.area_counts || row.area_counts.length === 0;
                        // For area items, show/edit the first area's inputs; for unallocated, use row.unit_inputs
                        const firstArea = !isUnallocated ? row.area_counts?.[0] : null;
                        const unitInputs = isUnallocated ? (row.unit_inputs || {}) : (firstArea?.unit_inputs || {});
                        const currentOpenState = openAreaSelector === itemIdx;
                        return (
                        <tr 
                          key={`allitems-${itemIdx}`}
                          className={`hover:bg-muted/20 ${isMobile ? 'cursor-pointer' : ''}`}
                          onClick={() => isMobile && !isSubmitted && openMobileCount(row, itemIdx)}
                        >
                          <td className={`${isMobile ? 'px-2 py-2' : 'px-4 py-2.5'}`}>
                            <div className="flex items-center gap-2">
                              {(() => {
                                const item = items.find(i => i.id === row.item_id);
                                const img = item?.purchase_options?.find(o => o.product_image_url)?.product_image_url;
                                return img ? (
                                  <img src={img} alt="" className={isMobile ? "w-6 h-6 object-contain rounded border bg-white" : "w-8 h-8 object-contain rounded border bg-white"} onError={(e) => e.target.style.display = 'none'} />
                                ) : (
                                  <div className={isMobile ? "w-6 h-6 flex items-center justify-center bg-muted rounded border" : "w-8 h-8 flex items-center justify-center bg-muted rounded border"}>
                                    <Package className={isMobile ? "w-3 h-3 text-muted-foreground" : "w-3.5 h-3.5 text-muted-foreground"} />
                                  </div>
                                );
                              })()}
                              <span className={isMobile ? "text-xs font-medium" : "font-medium"}>{row.item_name}</span>
                              {isUnallocated && <span className="text-xs text-amber-600 font-medium">(Unallocated)</span>}
                              {!isUnallocated && <span className="text-xs text-muted-foreground">(editing: {firstArea?.area_name})</span>}
                            </div>
                          </td>
                          <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-2.5'} text-muted-foreground`}>{row.category || '—'}</td>
                          <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-2.5'} text-muted-foreground`}>{row.previous_quantity} {row.unit_of_measure}</td>
                          <td className={`${isMobile ? 'px-2 py-2' : 'px-4 py-2.5'}`}>
                            {isSubmitted ? (
                              <span className={isMobile ? "text-xs font-medium" : "font-medium"}>{row.counted_quantity} {row.unit_of_measure}</span>
                            ) : isMobile ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-primary">{row.counted_quantity}</span>
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 flex-wrap">
                                {countUnits.map(u => (
                                  <div key={u.label} className="flex items-center gap-1">
                                    <Input
                                      type="number"
                                      className={isMobile ? "w-16 h-7 text-xs" : "w-20 h-8"}
                                      placeholder="0"
                                      value={unitInputs[u.label] ?? ''}
                                      onChange={e => {
                                        const newInputs = { ...unitInputs, [u.label]: e.target.value };
                                        if (isUnallocated) {
                                          updateCountedQty(itemIdx, newInputs, countUnits);
                                        } else {
                                          updateAreaQty(itemIdx, firstArea.area_id, newInputs, countUnits);
                                        }
                                      }}
                                    />
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">{u.label}</span>
                                  </div>
                                ))}
                                <span className="text-xs font-medium text-primary ml-1">= {row.counted_quantity} {row.unit_of_measure}</span>
                              </div>
                            )}
                          </td>
                          <td className={`${isMobile ? 'px-2 py-2 text-xs' : 'px-4 py-2.5'} font-medium text-green-700`}>${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</td>
                          <td className="px-4 py-2.5">
                            {hasAreas && !isSubmitted && areas.length > 0 && (
                              <div className="relative" data-area-selector>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenAreaSelector(currentOpenState ? null : itemIdx);
                                  }}
                                >
                                  Add to Area(s)
                                </Button>
                                {currentOpenState && (
                                  <div className="absolute right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg p-2 min-w-[200px]" data-area-selector>
                                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5 border-b border-border mb-1">
                                      Select areas to add to:
                                    </div>
                                    {areas.map(a => {
                                      const isInArea = row.area_counts?.some(ac => ac.area_id === a.id);
                                      return (
                                        <label
                                          key={a.id}
                                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded cursor-pointer"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isInArea || false}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              toggleItemArea(itemIdx, a.id, a.name);
                                            }}
                                            className="h-4 w-4"
                                          />
                                          <span className="text-xs">{a.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-right text-muted-foreground">Subtotal:</td>
                      <td className="px-4 py-2.5 font-bold text-green-700">${activeCount.items
                        .filter(row => {
                          if (!unallocatedSearch.trim()) return true;
                          const search = unallocatedSearch.toLowerCase();
                          return row.item_name.toLowerCase().includes(search) || 
                                 (row.category && row.category.toLowerCase().includes(search));
                        })
                        .reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
                )}
              </div>
              ) : activeAreaIdx === unallocatedTabIdx ? (
              // Unallocated Items only
              <div className={isMobile ? "space-y-3" : "bg-card border border-border rounded-xl overflow-hidden"}>
                <div className={`px-4 py-3 bg-muted/40 border-b border-border ${isMobile ? 'rounded-lg' : ''}`}>
                  <div className={isMobile ? "space-y-2" : "flex items-center justify-between gap-4"}>
                    <div>
                      <p className="text-sm font-medium text-foreground">Unallocated Items</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Items not assigned to any storage area</p>
                    </div>
                    <Input type="search" placeholder="Search items..." className={isMobile ? "w-full h-10" : "w-48 h-8"} value={unallocatedSearch} onChange={e => setUnallocatedSearch(e.target.value)} />
                  </div>
                </div>
                {isMobile ? (
                 <div className="space-y-3 px-3 pb-3">
                   {unassignedItems.filter(row => {
                     if (!unallocatedSearch.trim()) return true;
                     const s = unallocatedSearch.toLowerCase();
                     return row.item_name.toLowerCase().includes(s) || (row.category && row.category.toLowerCase().includes(s));
                   }).map((row) => {
                     const rowIdx = activeCount.items.findIndex(r => r.item_id === row.item_id);
                     return (
                       <div key={row.item_id} onClick={() => !isSubmitted && openMobileCount(row, rowIdx)}
                         className={`bg-card border border-border rounded-lg p-4 space-y-2 ${!isSubmitted ? 'cursor-pointer active:bg-muted' : ''}`}>
                         <div className="flex items-start justify-between gap-2">
                           <div className="flex-1">
                             <p className="font-semibold text-sm">{row.item_name}</p>
                             {row.category && <p className="text-xs text-muted-foreground">{row.category}</p>}
                           </div>
                           <div className="text-right">
                             <p className="text-lg font-bold text-primary">{row.counted_quantity || 0}</p>
                             <p className="text-xs text-muted-foreground">{row.unit_of_measure}</p>
                           </div>
                         </div>
                         <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
                           <span className="text-muted-foreground">Previous: {row.previous_quantity}</span>
                           <span className="font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</span>
                         </div>
                       </div>
                     );
                   })}
                 </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        {['Item', 'Category', 'Previous', 'Counted Qty', 'Value'].map((h, i) => (
                          <th key={i} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {unassignedItems.filter(row => {
                        if (!unallocatedSearch.trim()) return true;
                        const search = unallocatedSearch.toLowerCase();
                        return row.item_name.toLowerCase().includes(search) || (row.category && row.category.toLowerCase().includes(search));
                      }).map((row, rowIdx) => {
                        const hasVariants = row.has_variants && row.count_units.length > 1;
                        const isExpanded = expandedGroups.has(row.item_id);
                        const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
                        const unitInputs = row.unit_inputs || {};
                        return (
                          <>
                            <tr key={row.item_id} className={`hover:bg-muted/20 ${hasVariants ? 'bg-muted/10' : ''}`}>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  {hasVariants && (
                                    <button onClick={() => setExpandedGroups(prev => { const next = new Set(prev); if (next.has(row.item_id)) next.delete(row.item_id); else next.add(row.item_id); return next; })} className="hover:opacity-70">
                                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    </button>
                                  )}
                                  <div className={`font-medium ${hasVariants ? 'font-semibold' : ''}`}>{row.item_name}</div>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-muted-foreground">{row.category || '—'}</td>
                              <td className="px-4 py-2.5 text-muted-foreground">{row.previous_quantity} {row.unit_of_measure}</td>
                              <td className="px-4 py-2.5">
                                {hasVariants ? <span className="text-xs text-muted-foreground">Expand to count</span> : isSubmitted ? (
                                  <span className="font-medium">{row.counted_quantity} {row.unit_of_measure}</span>
                                ) : (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {countUnits.map(u => (
                                      <div key={u.label} className="flex items-center gap-1">
                                        <Input type="number" className="w-20 h-8" placeholder="0" value={unitInputs[u.label] || ''} onChange={e => { const newInputs = { ...unitInputs, [u.label]: e.target.value }; updateCountedQty(rowIdx, newInputs, countUnits); }} />
                                        <span className="text-xs text-muted-foreground whitespace-nowrap">{u.label}</span>
                                      </div>
                                    ))}
                                    <span className="text-xs font-medium text-primary ml-1">= {row.counted_quantity} {row.unit_of_measure}</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</td>
                            </tr>
                            {hasVariants && isExpanded && row.grouped_items?.map((variant) => {
                              const variantLabel = variant.variant_name;
                              return (
                                <tr key={`${row.item_id}-${variant.item_id}`} className="bg-muted/5 hover:bg-muted/15 border-b border-border/50">
                                  <td className="px-4 py-2 pl-12"><div className="text-sm font-medium text-primary">{variantLabel}</div></td>
                                  <td className="px-4 py-2 text-muted-foreground text-sm">{row.category || '—'}</td>
                                  <td className="px-4 py-2 text-muted-foreground text-sm">—</td>
                                  <td className="px-4 py-2">
                                    <div className="flex items-center gap-2">
                                      <Input type="number" className="w-20 h-8" placeholder="0" value={unitInputs[variantLabel] || ''} onChange={e => { const newInputs = { ...unitInputs, [variantLabel]: e.target.value }; updateCountedQty(rowIdx, newInputs, countUnits); }} />
                                      <span className="text-xs text-muted-foreground">{variantLabel}</span>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-sm font-medium text-green-700">${getItemValue(variant.item_id, parseFloat(unitInputs[variantLabel]) || 0).toFixed(2)}</td>
                                </tr>
                              );
                            })}
                          </>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 border-t border-border">
                      <tr>
                        <td colSpan={4} className="px-4 py-2.5 text-sm font-semibold text-right text-muted-foreground">Subtotal:</td>
                        <td className="px-4 py-2.5 font-bold text-green-700">${unassignedItems.filter(row => { if (!unallocatedSearch.trim()) return true; const s = unallocatedSearch.toLowerCase(); return row.item_name.toLowerCase().includes(s) || (row.category && row.category.toLowerCase().includes(s)); }).reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
              ) : activeAreaIdx < areas.length ? (
              // Per-area count entry
              <div className={isMobile ? "space-y-3" : "bg-card border border-border rounded-xl overflow-hidden"}>
               <div className={`px-4 py-3 bg-muted/40 border-b border-border ${isMobile ? 'rounded-lg' : ''}`}>
                 <div className={isMobile ? "space-y-3" : "flex items-center justify-between"}>
                   <div>
                     <p className="text-sm font-medium text-foreground">Counting: <span className="text-primary">{areas[activeAreaIdx].name}</span></p>
                     <p className="text-xs text-muted-foreground mt-0.5">Enter the quantity of each item found in this area</p>
                   </div>
                   <Input
                     type="search"
                     placeholder="Search items..."
                     className={isMobile ? "w-full h-10" : "w-48 h-8"}
                     value={getAreaSearch(areas[activeAreaIdx].id)}
                     onChange={(e) => setAreaSearch(areas[activeAreaIdx].id, e.target.value)}
                   />
                 </div>
               </div>
               {isMobile ? (
                 // Mobile: Card list
                 <div className="space-y-3 px-3 py-3">
                   {activeCount.items.filter(row => {
                     const currentArea = areas[activeAreaIdx];
                     const hasArea = row.area_counts?.some(ac => ac.area_id === currentArea.id);
                     if (!hasArea) return false;
                     const search = getAreaSearch(currentArea.id);
                     if (!search.trim()) return true;
                     return row.item_name.toLowerCase().includes(search.toLowerCase()) || 
                            (row.category && row.category.toLowerCase().includes(search.toLowerCase()));
                   }).map((row, mapIdx) => {
                     const rowIdx = activeCount.items.findIndex(r => r.item_id === row.item_id);
                     const currentArea = areas[activeAreaIdx];
                     const areaCount = row.area_counts?.find(ac => ac.area_id === currentArea.id) || { quantity: 0 };
                     return (
                       <div
                         key={row.item_id}
                         onClick={() => {
                           if (!isSubmitted) openMobileCount(row, rowIdx);
                         }}
                         className={`bg-card border border-border rounded-lg p-4 space-y-2 ${!isSubmitted ? 'cursor-pointer active:bg-muted' : ''}`}
                       >
                         <div className="flex items-start justify-between gap-2">
                           <div className="flex-1">
                             <p className="font-semibold text-sm">{row.item_name}</p>
                             {row.category && <p className="text-xs text-muted-foreground">{row.category}</p>}
                           </div>
                           <div className="text-right">
                             <p className="text-lg font-bold text-primary">{areaCount.quantity || 0}</p>
                             <p className="text-xs text-muted-foreground">{row.unit_of_measure}</p>
                           </div>
                         </div>
                         <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
                           <span className="text-muted-foreground">Area: {currentArea.name}</span>
                           <span className="font-medium text-green-700">${getItemValue(row.item_id, areaCount.quantity || 0).toFixed(2)}</span>
                         </div>
                       </div>
                     );
                   })}
                 </div>
               ) : (
                 // Desktop: Table layout
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
                    const hasArea = row.area_counts?.some(ac => ac.area_id === currentArea.id);
                    if (!hasArea) return false;
                    const search = getAreaSearch(currentArea.id);
                    if (!search.trim()) return true;
                    return row.item_name.toLowerCase().includes(search.toLowerCase()) || 
                           (row.category && row.category.toLowerCase().includes(search.toLowerCase()));
                   }).map((row) => {
                     const isGroupParent = row.is_parent && row.variants;
                     const isExpanded = expandedGroups.has(row.item_id);
                     const rowIdx = activeCount.items.findIndex(r => r === row);
                     const currentArea = areas[activeAreaIdx];
                     const areaCount = row.area_counts?.find(ac => ac.area_id === currentArea.id) || { quantity: 0 };
                     const countUnits = row.count_units?.length > 0 ? row.count_units : [{ label: row.unit_of_measure || 'EA', multiplier: 1 }];
                     const unitInputs = areaCount.unit_inputs || {};
                     return (
                       <>
                       <tr key={row.item_id} className={`hover:bg-muted/20 ${isGroupParent ? 'bg-muted/10' : ''}`}>
                         <td className="px-4 py-2.5">
                           <div className="flex items-center gap-2">
                             {isGroupParent && (
                               <button
                                 onClick={() => setExpandedGroups(prev => {
                                   const next = new Set(prev);
                                   if (next.has(row.item_id)) next.delete(row.item_id);
                                   else next.add(row.item_id);
                                   return next;
                                 })}
                                 className="hover:opacity-70"
                               >
                                 {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                               </button>
                             )}
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
                             <div>
                               <div className={`font-medium ${isGroupParent ? 'font-semibold' : ''}`}>{row.item_name}</div>
                               {isGroupParent && <div className="text-xs text-muted-foreground">{row.variants.length} sizes</div>}
                             </div>
                           </div>
                         </td>
                         <td className="px-4 py-2.5 text-muted-foreground">{row.category || '—'}</td>
                         <td className="px-4 py-2.5">
                           {isGroupParent ? (
                             <span className="text-xs text-muted-foreground">Count each size below</span>
                           ) : isSubmitted ? (
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
                                       updateAreaQty(rowIdx, currentArea.id, newInputs, countUnits);
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
                         {isGroupParent && isExpanded && row.grouped_items?.map((variant) => {
                           const areaCount = row.area_counts?.find(ac => ac.area_id === currentArea.id) || { quantity: 0, unit_inputs: {} };
                           const variantLabel = variant.variant_name;
                           const variantInputs = areaCount.unit_inputs || {};
                           return (
                             <tr key={`${row.item_id}-${variant.item_id}`} className="bg-muted/5 hover:bg-muted/15 border-b border-border/50">
                               <td className="px-4 py-2 pl-12">
                                 <div className="text-sm font-medium text-primary">{variantLabel}</div>
                               </td>
                               <td className="px-4 py-2 text-muted-foreground text-sm">{row.category || '—'}</td>
                               <td className="px-4 py-2">
                                 {isSubmitted ? (
                                   <span className="text-sm font-medium">{variantInputs[variantLabel] || 0} {row.unit_of_measure}</span>
                                 ) : (
                                   <div className="flex items-center gap-2">
                                     <Input
                                       type="number"
                                       className="w-20 h-8"
                                       placeholder="0"
                                       value={variantInputs[variantLabel] || ''}
                                       onChange={e => {
                                         const newInputs = { ...variantInputs, [variantLabel]: e.target.value };
                                         updateAreaQty(rowIdx, currentArea.id, newInputs, countUnits);
                                       }}
                                     />
                                     <span className="text-xs text-muted-foreground">{variantLabel}</span>
                                   </div>
                                 )}
                               </td>
                               <td className="px-4 py-2 text-sm font-medium text-primary">{variantInputs[variantLabel] || 0}</td>
                               <td className="px-4 py-2 text-sm font-medium text-green-700">${getItemValue(variant.item_id, parseFloat(variantInputs[variantLabel]) || 0).toFixed(2)}</td>
                             </tr>
                           );
                         })}
                         </>
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
                         )}
                         {!isSubmitted && (
                         <div className={`px-4 py-3 border-t border-border flex justify-end ${isMobile ? 'rounded-b-lg bg-card' : ''}`}>
                    {activeAreaIdx < areas.length - 1 ? (
                      <Button variant="outline" onClick={() => setActiveAreaIdx(i => i + 1)}>
                        Next: {areas[activeAreaIdx + 1].name} <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => setActiveAreaIdx(allItemsTabIdx)}>
                        Next: All Items <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : activeAreaIdx === summaryTabIdx ? (
              // Summary view
              <div className={isMobile ? "space-y-3" : "bg-card border border-border rounded-xl overflow-hidden"}>
                <div className={`px-4 py-3 bg-muted/40 border-b border-border ${isMobile ? 'rounded-lg' : ''}`}>
                  <p className="text-sm font-medium text-foreground">Summary — Total across all areas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Review combined quantities before submitting</p>
                </div>
                {isMobile ? (
                  <div className="space-y-3 px-3 pb-3">
                    {activeCount.items.map(row => (
                      <div key={row.item_id} className="bg-card border border-border rounded-lg p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{row.item_name}</p>
                            {row.category && <p className="text-xs text-muted-foreground">{row.category}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-primary">{row.counted_quantity || 0}</p>
                            <p className="text-xs text-muted-foreground">{row.unit_of_measure}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border text-xs">
                          {areas.map(a => {
                            const ac = row.area_counts?.find(c => c.area_id === a.id);
                            return ac ? (
                              <div key={a.id} className="flex items-center justify-between">
                                <span className="text-muted-foreground">{a.name}:</span>
                                <span className="font-medium">{ac.quantity || 0}</span>
                              </div>
                            ) : null;
                          })}
                        </div>
                        <div className="flex items-center justify-between text-xs pt-1">
                          <span className="text-muted-foreground">Previous: {row.previous_quantity}</span>
                          <span className="font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                    <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-3 flex items-center justify-between">
                      <span className="text-sm font-semibold">Grand Total Value:</span>
                      <span className="font-bold text-lg text-green-700">${activeCount.items.reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}</span>
                    </div>
                  </div>
                ) : (
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
                          <td className="px-4 py-2.5 font-medium">{row.item_name}</td>
                          {areas.map(a => {
                            const ac = row.area_counts?.find(c => c.area_id === a.id);
                            return <td key={a.id} className="px-4 py-2.5 text-muted-foreground">{ac?.quantity || 0}</td>;
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
                        <td className="px-4 py-3 font-bold text-lg text-green-700">${activeCount.items.reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity), 0).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            ) : null}
          </>
        ) : (
          // No areas — simple entry
          <div className={isMobile ? "space-y-3 px-3" : "bg-card border border-border rounded-xl overflow-hidden"}>
            {!isMobile && (
              <div className="px-4 py-3 bg-amber-50 border-b border-border">
                <p className="text-xs text-amber-700">No storage areas defined for this location. <a href="/stock" className="underline font-medium">Add storage areas</a> in Location Stock to enable per-area counting.</p>
              </div>
            )}
            {isMobile ? (
              // Mobile: Card list layout
              <div className="space-y-3 pt-3">
                {activeCount.items.map((row, mapIdx) => {
                  const rowIdx = activeCount.items.findIndex(r => r.item_id === row.item_id);
                  return (
                  <div
                    key={row.item_id}
                    onClick={() => {
                      if (!isSubmitted) openMobileCount(row, rowIdx);
                    }}
                    className={`bg-card border border-border rounded-lg p-4 space-y-2 ${!isSubmitted ? 'cursor-pointer active:bg-muted' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{row.item_name}</p>
                        {row.category && <p className="text-xs text-muted-foreground">{row.category}</p>}
                        {row.variant_name && <p className="text-xs text-primary font-medium">Variant: {row.variant_name}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">{row.counted_quantity}</p>
                        <p className="text-xs text-muted-foreground">{row.unit_of_measure}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
                      <span className="text-muted-foreground">Previous: {row.previous_quantity}</span>
                      <span className="font-medium text-green-700">${getItemValue(row.item_id, row.counted_quantity).toFixed(2)}</span>
                    </div>
                  </div>
                );
                })}
              </div>
            ) : (
              // Desktop: Table layout
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
                      <td className="px-4 py-2.5">
                        <div>
                          <div className="font-medium">{row.item_name}</div>
                          {row.variant_name && (
                            <div className="text-xs text-primary font-medium">Variant: {row.variant_name}</div>
                          )}
                        </div>
                      </td>
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
            )}
          </div>
        )}

        {/* Mobile Count Dialog */}
        {(() => {
          const liveItem = mobileCountItemIdx !== null ? activeCount?.items[mobileCountItemIdx] : null;
          const hasNext = mobileCountItemIdx !== null && activeCount && mobileCountItemIdx + 1 < activeCount.items.length;
          return (
            <MobileCountDialog
              open={mobileDialogOpen}
              onOpenChange={(open) => {
                if (!open) {
                  setMobileCountItem(null);
                  setMobileCountItemIdx(null);
                }
              }}
              item={liveItem || mobileCountItem}
              previousQuantity={liveItem?.previous_quantity || 0}
              countUnits={liveItem?.count_units?.length > 0 ? liveItem.count_units : [{ label: liveItem?.unit_of_measure || 'EA', multiplier: 1 }]}
              currentInputs={liveItem?.unit_inputs || {}}
              onSave={handleMobileQtyChange}
              onNext={hasNext ? handleNextItem : null}
              isSubmitted={activeCount?.status === 'submitted'}
              itemValue={liveItem ? getItemValue(liveItem.item_id, liveItem.counted_quantity) : 0}
            />
          );
        })()}
      </div>
    );
  }

  // Count history list
  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Inventory Counts"
        subtitle="Full and spot counts by location"
        actions={<Button onClick={() => setNewCountDialog(true)}><Plus className="w-4 h-4 mr-1" />New Count</Button>}
      />

      <div className={isMobile ? "space-y-3" : "bg-card border border-border rounded-xl overflow-hidden"}>
        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : isMobile ? (
          counts.length === 0 ? (
            <div className="bg-card border border-border rounded-xl px-4 py-8 text-center text-muted-foreground text-sm">No counts yet. Start your first inventory count.</div>
          ) : counts.map(c => {
            const usedAreas = [...new Set((c.items || []).flatMap(i => (i.area_counts || []).map(ac => ac.area_name)))].filter(Boolean);
            const totalValue = (c.items || []).reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity || 0), 0);
            return (
              <div key={c.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{locName(c.location_id)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">{c.count_type} count · {format(new Date(c.created_date), 'MMM d, yyyy')}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs border-t border-border pt-2">
                  <div><p className="text-muted-foreground">Items</p><p className="font-medium mt-0.5">{c.items?.length || 0}</p></div>
                  <div><p className="text-muted-foreground">Value</p><p className="font-medium text-green-700 mt-0.5">${totalValue.toFixed(2)}</p></div>
                  <div><p className="text-muted-foreground">Areas</p><p className="font-medium mt-0.5">{usedAreas.length > 0 ? usedAreas.length : '—'}</p></div>
                </div>
                <div className="flex gap-2 pt-1">
                  {c.status === 'draft' && <>
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => resumeCount(c)}><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button>
                    <Button variant="outline" size="sm" className="h-8 w-8 text-destructive px-0" onClick={() => { setCountToDelete(c); setDeleteConfirmOpen(true); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </>}
                  {c.status === 'in_progress' && <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => resumeCount(c)}><Pencil className="w-3.5 h-3.5 mr-1" />Resume</Button>}
                  {c.status === 'submitted' && <>
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => viewCount(c)}><Eye className="w-3.5 h-3.5 mr-1" />View</Button>
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => reopenCount(c)}><Pencil className="w-3.5 h-3.5 mr-1" />Reopen</Button>
                  </>}
                </div>
              </div>
            );
          })
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
                return (
                  <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">{format(new Date(c.created_date), 'MMM d, yyyy h:mm a')}</td>
                    <td className="px-4 py-3 font-medium">{locName(c.location_id)}</td>
                    <td className="px-4 py-3 capitalize">{c.count_type}{c.categories?.length > 0 && <span className="text-muted-foreground ml-1 text-xs">({c.categories.join(', ')})</span>}</td>
                    <td className="px-4 py-3 text-muted-foreground">{usedAreas.length > 0 ? usedAreas.join(', ') : '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.items?.length || 0} items</td>
                    <td className="px-4 py-3 font-medium text-green-700">${(c.items || []).reduce((s, r) => s + getItemValue(r.item_id, r.counted_quantity || 0), 0).toFixed(2)}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3">
                      {c.status === 'draft' ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => resumeCount(c)}><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setCountToDelete(c); setDeleteConfirmOpen(true); }}><Trash2 className="w-3.5 h-3.5 mr-1" /></Button>
                        </div>
                      ) : c.status === 'in_progress' ? (
                        <Button variant="ghost" size="sm" onClick={() => resumeCount(c)}><Pencil className="w-3.5 h-3.5 mr-1" />Resume</Button>
                      ) : c.status === 'submitted' ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => viewCount(c)}><Eye className="w-3.5 h-3.5 mr-1" />View</Button>
                          <Button variant="ghost" size="sm" onClick={() => reopenCount(c)}><Pencil className="w-3.5 h-3.5 mr-1" />Reopen</Button>
                        </div>
                      ) : null}
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
            <Button variant="outline" onClick={() => startCount('draft')} disabled={!form.location_id}>Save as Draft</Button>
            <Button onClick={() => startCount('in_progress')} disabled={!form.location_id}><ClipboardList className="w-4 h-4 mr-1" />Start Count</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Count</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this count? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteCount}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}