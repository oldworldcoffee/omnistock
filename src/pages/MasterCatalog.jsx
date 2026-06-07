import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Plus, Search, Pencil, Trash2, Package, Archive, Combine, MoreVertical, FileDown, FileSpreadsheet, FileText, Upload, Download, CheckSquare, Square, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import ItemEditDialog from '@/components/catalog/ItemEditDialog';
import SplitOptionsDialog from '@/components/catalog/SplitOptionsDialog';
import GroupedCatalogRow from '@/components/catalog/GroupedCatalogRow';
import ProductGroupManager from '@/components/catalog/ProductGroupManager';
import AssignToGroupDialog from '@/components/catalog/AssignToGroupDialog';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronUp, ChevronDown, GripVertical } from 'lucide-react';

const EMPTY = { name: '', sku: '', category: '', unit_of_measure: '', unit_cost: '', is_commissary_item: false, commissary_price: '', description: '', vendor_id: '', is_active: true, purchase_options: [], product_group_id: null, group_sort_order: 0 };

const UOM_TO_BASE = {
  'fl-oz': { family: 'volume', toBase: 1 },
  'oz':    { family: 'volume', toBase: 1 },
  'ml':    { family: 'volume', toBase: 0.033814 },
  'L':     { family: 'volume', toBase: 33.814 },
  'Qt':    { family: 'volume', toBase: 32 },
  'gal':   { family: 'volume', toBase: 128 },
  'g':     { family: 'weight', toBase: 1 },
  'gr':    { family: 'weight', toBase: 1 },
  'kg':    { family: 'weight', toBase: 1000 },
  'lb':    { family: 'weight', toBase: 453.592 },
  'EA':    { family: 'count',  toBase: 1 },
};

const convertPrice = (pricePerFromUOM, fromUOM, toUOM) => {
  if (!fromUOM || !toUOM || fromUOM === toUOM) return pricePerFromUOM;
  const from = UOM_TO_BASE[fromUOM];
  const to   = UOM_TO_BASE[toUOM];
  if (!from || !to || from.family !== to.family) return null;
  return pricePerFromUOM / (from.toBase / to.toBase);
};

export default function MasterCatalog() {
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [groupByOpen, setGroupByOpen] = useState(false);
  const [assignToGroupOpen, setAssignToGroupOpen] = useState(false);
  const [groupNames, setGroupNames] = useState({});
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const fileInputRef = useRef(null);

  const load = async () => {
    try {
      const [itms, vends, locs, groups] = await Promise.all([
        base44.entities.InventoryItem.list(),
        base44.entities.Vendor.list(),
        base44.entities.Location.list(),
        base44.entities.ProductGroup.list(),
      ]);
      setItems(itms);
      setVendors(vends);
      setLocations(locs);
      
      // Create group name lookup map
      const groupMap = {};
      groups.forEach(g => {
        groupMap[g.id] = g.name;
      });
      setGroupNames(groupMap);
      
      setLoading(false);
      return itms;
    } catch (error) {
      if (error.message?.includes('Rate limit')) {
        toast.error('Too many requests. Please wait a moment and refresh.');
      } else {
        toast.error('Failed to load catalog: ' + error.message);
      }
      setLoading(false);
      return [];
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setDialog(true); };
  const openEdit = (item) => { setForm({ ...item, purchase_options: item.purchase_options || [] }); setDialog(true); };

  const save = async (latestForm) => {
    setSaving(true);
    try {
      const f = latestForm;
      const opts = f.purchase_options || [];
      const data = {
        ...f,
        unit_cost: parseFloat(f.unit_cost) || 0,
        commissary_price: parseFloat(f.commissary_price) || 0,
        purchase_options: opts.map(o => ({
          ...o,
          unit_cost: parseFloat(o.unit_cost) || 0,
          inner_pack_units: parseFloat(o.inner_pack_units) || null,
          packs_per_case: parseFloat(o.packs_per_case) || null,
          inner_pack_name: o.inner_pack_name || null,
          inner_pack_uom: o.inner_pack_uom || null,
        })),
      };
      let savedId = f.id;
      if (f.id) await base44.entities.InventoryItem.update(f.id, data);
      else { const created = await base44.entities.InventoryItem.create(data); savedId = created.id; }
      
      const freshItems = await load();
      const freshItem = freshItems?.find(i => i.id === savedId);
      if (freshItem) setForm({ ...freshItem, purchase_options: freshItem.purchase_options || [] });
      setDialog(false);
      toast.success('Item saved!');
    } catch (err) {
      toast.error('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this item?')) return;
    await base44.entities.InventoryItem.delete(id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const toggleSelect = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    const allItems = sortedGroups.flatMap(g => g.items);
    if (selected.size === allItems.length) setSelected(new Set());
    else setSelected(new Set(allItems.map(i => i.id)));
  };

  const bulkArchive = async () => {
    if (!confirm(`Archive ${selected.size} items?`)) return;
    await Promise.all(Array.from(selected).map(id => base44.entities.InventoryItem.update(id, { is_active: false })));
    await load();
    setSelected(new Set());
    toast.success(`Archived ${selected.size} items`);
  };

  const bulkUnarchive = async () => {
    if (!confirm(`Unarchive ${selected.size} items?`)) return;
    await Promise.all(Array.from(selected).map(id => base44.entities.InventoryItem.update(id, { is_active: true })));
    await load();
    setSelected(new Set());
    toast.success(`Unarchived ${selected.size} items`);
  };

  const bulkDelete = async () => {
    setDeleteConfirmOpen(true);
  };

  const confirmBulkDelete = async () => {
    if (deleteConfirmText !== 'delete') return;
    await Promise.all(Array.from(selected).map(id => base44.entities.InventoryItem.delete(id)));
    await load();
    setSelected(new Set());
    setDeleteConfirmOpen(false);
    setDeleteConfirmText('');
    toast.success(`Deleted ${selected.size} items`);
  };

  const mergeDuplicates = async () => {
    if (selected.size !== 2) {
      toast.error('Please select exactly 2 items to merge');
      return;
    }
    setMergeDialogOpen(true);
  };

  const confirmMerge = async () => {
    if (!mergeTargetId) {
      toast.error('Please select which item to keep');
      return;
    }
    setMerging(true);
    try {
      const [id1, id2] = Array.from(selected);
      const result = await base44.functions.invoke('mergeDuplicateItems', { 
        item1_id: id1, 
        item2_id: id2, 
        keep_id: mergeTargetId 
      });
      if (result.data?.success) {
        toast.success(`Merged! Kept "${result.data.kept_name}" with purchase options combined.`);
      } else {
        toast.error(result.data?.error || 'Merge failed');
      }
    } catch (error) {
      toast.error('Merge failed: ' + error.message);
    } finally {
      setMerging(false);
      await load();
      setMergeDialogOpen(false);
      setSelected(new Set());
      setMergeTargetId('');
    }
  };

  const splitItem = async () => {
    if (selected.size !== 1) {
      toast.error('Please select exactly 1 item to split');
      return;
    }
    const item = items.find(i => selected.has(i.id));
    if (!item || (item.purchase_options || []).length < 2) {
      toast.error('Item must have at least 2 purchase options to split');
      return;
    }
    setSplitDialogOpen(true);
  };

  const confirmSplit = async (selectedOptions) => {
    if (!selectedOptions || selectedOptions.length < 2) {
      toast.error('Select at least 2 purchase options to split');
      return;
    }
    setSplitting(true);
    try {
      const item = items.find(i => selected.has(i.id));
      const opts = item.purchase_options || [];
      const selectedOpts = opts.filter((_, idx) => selectedOptions.includes(idx));
      
      for (let i = 0; i < selectedOpts.length; i++) {
        const opt = selectedOpts[i];
        const newItem = {
          ...item,
          name: `${item.name} (${opt.vendor_name || 'Option ' + (i + 1)})`,
          purchase_options: [opt],
          vendor_id: opt.vendor_id,
          unit_cost: parseFloat(opt.unit_cost) || 0,
        };
        await base44.entities.InventoryItem.create(newItem);
      }
      
      const remainingOpts = opts.filter((_, idx) => !selectedOptions.includes(idx));
      if (remainingOpts.length > 0) {
        await base44.entities.InventoryItem.update(item.id, {
          purchase_options: remainingOpts,
          vendor_id: remainingOpts[0]?.vendor_id || '',
          unit_cost: parseFloat(remainingOpts[0]?.unit_cost) || 0,
        });
      } else {
        await base44.entities.InventoryItem.delete(item.id);
      }
      
      toast.success(`Split into ${selectedOpts.length} separate items`);
      await load();
      setSplitDialogOpen(false);
      setSelected(new Set());
    } catch (error) {
      toast.error('Split failed: ' + error.message);
    } finally {
      setSplitting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const response = await base44.functions.invoke('downloadCatalogTemplate', {});
      const blobUrl = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `catalog_import_template_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      toast.error('Failed to download template: ' + error.message);
    }
  };

  const handleReorderGroupItems = async (groupId, sourceIndex, destinationIndex) => {
    const group = sortedGroups.find(g => g.groupId === groupId);
    if (!group) return;
    
    const items = [...group.items];
    const [removed] = items.splice(sourceIndex, 1);
    items.splice(destinationIndex, 0, removed);
    
    // Update group_sort_order for all items in the group
    const updates = items.map((item, idx) => ({
      id: item.id,
      data: { group_sort_order: idx }
    }));
    
    await Promise.all(
      updates.map(({ id, data }) => base44.entities.InventoryItem.update(id, data))
    );
    
    await load();
    toast.success('Items reordered');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const result = await base44.functions.invoke('importCatalog', { file_url });
      
      if (result.data.success) {
        toast.success(`Import complete!`);
        await load();
      }
    } catch (error) {
      toast.error('Import failed: ' + error.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const exportCatalog = async (format) => {
    setExporting(true);
    try {
      const allItems = sortedGroups.flatMap(g => g.items);
      const response = await base44.functions.invoke('exportCatalog', { format, items: allItems });
      const blob = new Blob([response.data], { type: format === 'pdf' ? 'application/pdf' : 'text/csv' });
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `master_catalog_${new Date().toISOString().split('T')[0]}.${format}`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      toast.success(`Catalog exported as ${format.toUpperCase()}`);
    } catch (error) {
      toast.error('Export failed: ' + error.message);
    } finally {
      setExporting(false);
    }
  };

  // Group items by product_group_id
  const itemsWithGroups = items.filter(i => {
    const matchesSearch = i.name?.toLowerCase().includes(search.toLowerCase()) ||
      i.category?.toLowerCase().includes(search.toLowerCase()) ||
      i.sku?.toLowerCase().includes(search.toLowerCase());
    const matchesArchive = showArchived ? !i.is_active : i.is_active;
    const matchesVendor = vendorFilter === 'all' || (i.purchase_options || []).some(o => o.vendor_name === vendorFilter);
    const matchesCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchesSearch && matchesArchive && matchesVendor && matchesCategory;
  });

  const groupedItems = {};
  itemsWithGroups.forEach(item => {
    if (item.product_group_id) {
      if (!groupedItems[item.product_group_id]) {
        groupedItems[item.product_group_id] = { groupId: item.product_group_id, items: [], sortBase: item.name };
      }
      groupedItems[item.product_group_id].items.push(item);
    } else {
      groupedItems[`standalone-${item.id}`] = { groupId: null, items: [item], sortBase: item.name };
    }
  });

  const sortedGroups = Object.values(groupedItems).sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'name') {
      comparison = (a.sortBase || '').localeCompare(b.sortBase || '');
    } else if (sortBy === 'category') {
      const aCat = a.items[0]?.category || '';
      const bCat = b.items[0]?.category || '';
      comparison = aCat.localeCompare(bCat);
    } else if (sortBy === 'vendor') {
      const aVendor = (a.items[0]?.purchase_options || []).find(o => o.is_preferred)?.vendor_name || (a.items[0]?.purchase_options || [])[0]?.vendor_name || '';
      const bVendor = (b.items[0]?.purchase_options || []).find(o => o.is_preferred)?.vendor_name || (b.items[0]?.purchase_options || [])[0]?.vendor_name || '';
      comparison = aVendor.localeCompare(bVendor);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  sortedGroups.forEach(group => {
    group.items.sort((a, b) => {
      if (a.group_sort_order !== b.group_sort_order) {
        return (a.group_sort_order || 0) - (b.group_sort_order || 0);
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  });

  const toggleGroup = (groupId) => {
    const next = new Set(expandedGroups);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    setExpandedGroups(next);
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const uniqueVendors = [...new Set(items.flatMap(i => (i.purchase_options || []).map(o => o.vendor_name).filter(Boolean)))].sort();

  const getPreferredOption = (item) => {
    const opts = item.purchase_options || [];
    return opts.find(o => o.is_preferred) || opts[0];
  };

  const getCheapestOption = (item) => {
    const opts = (item.purchase_options || []).filter(o => o.unit_cost);
    if (opts.length < 2) return null;
    return opts.reduce((a, b) => parseFloat(a.unit_cost) < parseFloat(b.unit_cost) ? a : b);
  };

  const getPricePerUOM = (opt, itemUOM) => {
    const cost = parseFloat(opt?.unit_cost || 0);
    if (!cost) return null;
    const orderingUOM = opt?.unit_of_measure || itemUOM;
    const packUOM = opt?.inner_pack_uom || itemUOM;
    const innerUnits = parseFloat(opt?.inner_pack_units || 0);
    const packsPerCase = parseFloat(opt?.packs_per_case || 0);
    const packName = opt?.inner_pack_name || '';

    let pricePerPackUnit;
    if (orderingUOM === 'Case' && innerUnits > 0 && packsPerCase > 0) {
      pricePerPackUnit = cost / (innerUnits * packsPerCase);
    } else if (packName && orderingUOM === packName && innerUnits > 0) {
      pricePerPackUnit = cost / innerUnits;
    } else if (innerUnits > 0 && packsPerCase > 0) {
      pricePerPackUnit = cost / (innerUnits * packsPerCase);
    } else {
      pricePerPackUnit = null;
    }

    const fmt = (v) => v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(2);

    if (pricePerPackUnit !== null) {
      if (packUOM === itemUOM) return { price: fmt(pricePerPackUnit), uom: itemUOM };
      const converted = convertPrice(pricePerPackUnit, packUOM, itemUOM);
      if (converted === null) return { price: fmt(pricePerPackUnit), uom: packUOM };
      return { price: fmt(converted), uom: itemUOM };
    }

    if (orderingUOM === itemUOM) return { price: fmt(cost), uom: itemUOM };
    const converted = convertPrice(cost, orderingUOM, itemUOM);
    if (converted === null) return { price: fmt(cost), uom: orderingUOM };
    return { price: fmt(converted), uom: itemUOM };
  };

  const isMobile = useIsMobile();

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Master Catalog"
        subtitle="All inventory items across your operation"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <FileDown className="w-4 h-4 mr-1" />File Options
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={downloadTemplate} disabled={uploading}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Download Template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Upload className="w-4 h-4 mr-2" />
                  Import Catalog
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportCatalog('csv')} disabled={exporting}>
                  <FileText className="w-4 h-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportCatalog('pdf')} disabled={exporting}>
                  <Download className="w-4 h-4 mr-2" />
                  Export as PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => setShowArchived(!showArchived)}>
              <Archive className="w-4 h-4 mr-1" />{showArchived ? 'Hide Archived' : 'Show Archived'}
            </Button>
            <Button variant="outline" onClick={() => setGroupByOpen(true)}>
              <FolderOpen className="w-4 h-4 mr-1" />Manage Groups
            </Button>
            <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add Item</Button>
            
            {selected.size > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="ml-2">
                    <span className="text-sm">{selected.size} selected</span>
                    <MoreVertical className="w-4 h-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {showArchived ? (
                    <DropdownMenuItem onClick={bulkUnarchive}>
                      <CheckSquare className="w-4 h-4 mr-2" />
                      Unarchive
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={bulkArchive}>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={splitItem} disabled={selected.size !== 1}>
                    <Package className="w-4 h-4 mr-2" />
                    Split Order Options
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={mergeDuplicates} disabled={selected.size !== 2}>
                    <Combine className="w-4 h-4 mr-2" />
                    Merge Duplicates
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setAssignToGroupOpen(true)}>
                    <Package className="w-4 h-4 mr-2" />
                    Assign to Group
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={bulkDelete} className="text-destructive focus:text-destructive">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search items..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vendors</SelectItem>
              {uniqueVendors.map(v => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : uploading ? (
          <div className="flex items-center justify-center h-32 gap-3">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Importing catalog...</span>
          </div>
        ) : isMobile ? (
          <div className="divide-y divide-border">
            {sortedGroups.length === 0 ? (
              <p className="px-4 py-8 text-center text-muted-foreground text-sm">No items found.</p>
            ) : sortedGroups.map(group => {
              const isGroup = group.groupId !== null && group.items.length > 1;
              const firstItem = group.items[0];
              const preferred = getPreferredOption(firstItem);
              const pricePerUOM = preferred ? getPricePerUOM(preferred, firstItem.unit_of_measure) : null;
              const groupVendors = [...new Set(group.items.flatMap(i => (i.purchase_options || []).map(o => o.vendor_name).filter(Boolean)))];
              return (
                <div key={group.groupId || firstItem.id} className="p-4 space-y-2">
                  {isGroup && (
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{groupNames[group.groupId] || 'Group'} ({group.items.length} items)</p>
                  )}
                  {group.items.map(item => {
                    const pref = getPreferredOption(item);
                    const ppu = pref ? getPricePerUOM(pref, item.unit_of_measure) : null;
                    const isSelected = selected.has(item.id);
                    return (
                      <div key={item.id} className={`bg-card border rounded-xl p-4 ${isSelected ? 'border-primary' : 'border-border'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-3 flex-1">
                            <button onClick={() => toggleSelect(item.id)} className="mt-0.5">
                              {isSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                            </button>
                            <div className="flex-1">
                              <p className="font-semibold text-sm">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{item.category || '—'} · {item.unit_of_measure}</p>
                              {groupVendors.length > 0 && <p className="text-xs text-muted-foreground mt-0.5">{groupVendors.join(', ')}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <StatusBadge status={item.is_active ? 'active' : 'inactive'} />
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}><Pencil className="w-3.5 h-3.5" /></Button>
                          </div>
                        </div>
                        {(pref || item.is_commissary_item) && (
                          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border text-xs">
                            {pref && <div><p className="text-muted-foreground">Best Price</p><p className="font-medium mt-0.5">${parseFloat(pref.unit_cost || 0).toFixed(2)}</p></div>}
                            {ppu && <div><p className="text-muted-foreground">$/UOM</p><p className="font-medium mt-0.5">${ppu.price}/{ppu.uom}</p></div>}
                            {item.is_commissary_item && <div><p className="text-muted-foreground">Commissary</p><p className="font-medium mt-0.5">${parseFloat(item.commissary_price || 0).toFixed(2)}</p></div>}
                            <div><p className="text-muted-foreground">Options</p><p className="font-medium mt-0.5">{(item.purchase_options || []).length}</p></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">
                    <button onClick={toggleSelectAll} className="hover:opacity-70">
                      {selected.size > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:bg-muted/30" onClick={() => { setSortBy('name'); setSortOrder(sortBy === 'name' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center gap-1">Item Name {sortBy === 'name' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:bg-muted/30" onClick={() => { setSortBy('category'); setSortOrder(sortBy === 'category' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center gap-1">Category {sortBy === 'category' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">UOM</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Purchase Options</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Best Price</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">$/UOM</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commissary</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedGroups.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No items found.</td></tr>
                ) : sortedGroups.map(group => {
                  const isGroup = group.groupId !== null && group.items.length > 1;
                  const isExpanded = expandedGroups.has(group.groupId);
                  const firstItem = group.items[0];
                  const allUnitCosts = group.items.map(i => parseFloat(i.unit_cost) || 0).filter(c => c > 0);
                  const groupVendors = [...new Set(group.items.flatMap(i => (i.purchase_options || []).map(o => o.vendor_name).filter(Boolean)))];
                  return (
                    <GroupedCatalogRow
                      key={group.groupId || firstItem.id}
                      group={group}
                      isGroup={isGroup}
                      isExpanded={isExpanded}
                      firstItem={firstItem}
                      selected={selected}
                      uniqueVendors={groupVendors}
                      allUnitCosts={allUnitCosts}
                      onToggleGroup={() => toggleGroup(group.groupId)}
                      onToggleSelect={toggleSelect}
                      onEdit={openEdit}
                      onDelete={remove}
                      onRefresh={load}
                      onReorderGroupItems={handleReorderGroupItems}
                      getPreferredOption={getPreferredOption}
                      getCheapestOption={getCheapestOption}
                      getPricePerUOM={getPricePerUOM}
                      groupNames={groupNames}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ItemEditDialog
        open={dialog}
        onOpenChange={setDialog}
        initialForm={form}
        onSave={save}
        saving={saving}
        vendors={vendors}
        locations={locations}
        categories={categories}
      />

      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge Duplicate Items</DialogTitle>
            <DialogDescription>Select which item to keep. All purchase options will be combined.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {Array.from(selected).map(id => {
              const item = items.find(i => i.id === id);
              if (!item) return null;
              return (
                <label key={id} className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer ${mergeTargetId === id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}>
                  <input type="radio" name="merge_target" value={id} checked={mergeTargetId === id} onChange={() => setMergeTargetId(id)} className="w-4 h-4" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.purchase_options?.length || 0} purchase options</p>
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMergeDialogOpen(false); setMergeTargetId(''); }}>Cancel</Button>
            <Button onClick={confirmMerge} disabled={merging || !mergeTargetId}>{merging ? 'Merging...' : 'Merge Items'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={splitDialogOpen} onOpenChange={setSplitDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Split Order Options</DialogTitle>
            <DialogDescription>Select which purchase options to split into separate items.</DialogDescription>
          </DialogHeader>
          <SplitOptionsDialog
            item={items.find(i => selected.has(i.id))}
            onCancel={() => setSplitDialogOpen(false)}
            onConfirm={confirmSplit}
            splitting={splitting}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently Delete Items</DialogTitle>
            <DialogDescription>This action cannot be undone. Type "delete" to confirm deleting {selected.size} items.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="confirm-delete">Type "delete"</Label>
            <Input id="confirm-delete" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="delete" className="mt-2" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmBulkDelete} disabled={deleteConfirmText !== 'delete'}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProductGroupManager
        open={groupByOpen}
        onOpenChange={setGroupByOpen}
      />

      <AssignToGroupDialog
        open={assignToGroupOpen}
        onOpenChange={setAssignToGroupOpen}
        itemIds={Array.from(selected)}
        itemNames={Array.from(selected).map(id => items.find(i => i.id === id)?.name).filter(Boolean)}
      />

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );
}