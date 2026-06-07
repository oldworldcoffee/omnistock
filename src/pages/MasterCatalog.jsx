import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Search, Pencil, Trash2, Package, Store, Star, Upload, Download, FileSpreadsheet, FileText, CheckSquare, Square, Archive, Combine, Image, MoreVertical, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import ItemEditDialog from '@/components/catalog/ItemEditDialog';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronUp, ChevronDown } from 'lucide-react';

const EMPTY = { name: '', sku: '', category: '', unit_of_measure: '', unit_cost: '', is_commissary_item: false, commissary_price: '', description: '', vendor_id: '', is_active: true, purchase_options: [] };

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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const fileInputRef = useRef(null);
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);

  const load = () => Promise.all([
    base44.entities.InventoryItem.list(),
    base44.entities.Vendor.list(),
    base44.entities.Location.list(),
  ]).then(([itms, vends, locs]) => { setItems(itms); setVendors(vends); setLocations(locs); setLoading(false); });

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setDialog(true); };
  const openEdit = (item) => { setForm({ ...item, purchase_options: item.purchase_options || [] }); setDialog(true); };

  const save = async () => {
    setSaving(true);
    const form = formRef.current;
    const opts = form.purchase_options || [];
    const hasImage = opts.some(o => o.product_image_url);
    toast.info(`Saving ${form.name} - ${hasImage ? 'WITH image' : 'NO image'}`);
    const data = {
      ...form,
      unit_cost: parseFloat(form.unit_cost) || 0,
      commissary_price: parseFloat(form.commissary_price) || 0,
      purchase_options: opts.map(o => ({
        ...o,
        unit_cost: parseFloat(o.unit_cost) || 0,
        inner_pack_units: parseFloat(o.inner_pack_units) || null,
        packs_per_case: parseFloat(o.packs_per_case) || null,
        inner_pack_name: o.inner_pack_name || null,
      })),
    };
    if (form.id) await base44.entities.InventoryItem.update(form.id, data);
    else await base44.entities.InventoryItem.create(data);
    await load();
    setDialog(false);
    setSaving(false);
    toast.success('Item saved!');
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
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(i => i.id)));
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
        toast.success(`Merged! Kept "${result.data.kept_name}", removed "${result.data.removed_name}".`);
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

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const result = await base44.functions.invoke('importCatalog', { file_url });
      
      if (result.data.success) {
        const { items: itemResults, vendors: vendorResults } = result.data.results;
        toast.success(`Import complete! Items: ${itemResults.created} created, ${itemResults.updated} updated. Vendors: ${vendorResults.created} created, ${vendorResults.updated} updated.`);
        if (itemResults.errors.length > 0 || vendorResults.errors.length > 0) {
          toast.warning(`${itemResults.errors.length + vendorResults.errors.length} rows had errors`);
          console.error('Import errors:', [...itemResults.errors, ...vendorResults.errors]);
        }
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
      const response = await base44.functions.invoke('exportCatalog', { format, items: filtered });
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

  const filtered = items.filter(i => {
    const matchesSearch = i.name?.toLowerCase().includes(search.toLowerCase()) ||
      i.category?.toLowerCase().includes(search.toLowerCase()) ||
      i.sku?.toLowerCase().includes(search.toLowerCase());
    const matchesArchive = showArchived ? !i.is_active : i.is_active;
    const matchesVendor = vendorFilter === 'all' || (i.purchase_options || []).some(o => o.vendor_name === vendorFilter);
    const matchesCategory = categoryFilter === 'all' || i.category === categoryFilter;
    return matchesSearch && matchesArchive && matchesVendor && matchesCategory;
  }).sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'name') {
      comparison = (a.name || '').localeCompare(b.name || '');
    } else if (sortBy === 'category') {
      comparison = (a.category || '').localeCompare(b.category || '');
    } else if (sortBy === 'vendor') {
      const aVendor = (a.purchase_options || []).find(o => o.is_preferred)?.vendor_name || (a.purchase_options || [])[0]?.vendor_name || '';
      const bVendor = (b.purchase_options || []).find(o => o.is_preferred)?.vendor_name || (b.purchase_options || [])[0]?.vendor_name || '';
      comparison = aVendor.localeCompare(bVendor);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

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

  const getPricePerUOM = (opt) => {
    const cost = parseFloat(opt?.unit_cost || 0);
    if (!cost) return null;
    const innerUnits = parseFloat(opt?.inner_pack_units || 0);
    const packsPerCase = parseFloat(opt?.packs_per_case || 0);
    if (!innerUnits || !packsPerCase) return null;
    const totalUnits = innerUnits * packsPerCase;
    const ppu = cost / totalUnits;
    // Show 4 decimals only if needed, otherwise fewer
    return ppu < 0.01 ? ppu.toFixed(4) : ppu < 1 ? ppu.toFixed(3) : ppu.toFixed(2);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
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
                  <DropdownMenuItem onClick={mergeDuplicates} disabled={selected.size !== 2}>
                    <Combine className="w-4 h-4 mr-2" />
                    Merge Duplicates
                    {selected.size !== 2 && <span className="text-xs text-muted-foreground ml-auto">(select 2)</span>}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10">
                    <button onClick={toggleSelectAll} className="hover:opacity-70">
                      {selected.size === filtered.length && filtered.length > 0 ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:bg-muted/30" onClick={() => { setSortBy('name'); setSortOrder(sortBy === 'name' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center gap-1">
                      Item Name
                      {sortBy === 'name' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:bg-muted/30" onClick={() => { setSortBy('category'); setSortOrder(sortBy === 'category' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center gap-1">
                      Category
                      {sortBy === 'category' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">UOM</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:bg-muted/30" onClick={() => { setSortBy('vendor'); setSortOrder(sortBy === 'vendor' && sortOrder === 'asc' ? 'desc' : 'asc'); }}>
                    <div className="flex items-center gap-1">
                      Purchase Options
                      {sortBy === 'vendor' && (sortOrder === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Best Price</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">$/UOM</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Commissary</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No items found. Add your first item to get started.</td></tr>
                ) : filtered.map(item => {
                  const opts = item.purchase_options || [];
                  const preferred = getPreferredOption(item);
                  const cheapest = getCheapestOption(item);
                  return (
                    <tr key={item.id} className={`hover:bg-muted/30 transition-colors ${!item.is_active ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleSelect(item.id)} className="hover:opacity-70">
                          {selected.has(item.id) ? (
                            <CheckSquare className="w-4 h-4" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const img = item.purchase_options?.find(o => o.product_image_url)?.product_image_url;
                            return img ? (
                              <img src={img} alt="" className="w-10 h-10 object-contain rounded border bg-white" onError={(e) => e.target.style.display = 'none'} />
                            ) : (
                              <div className="w-10 h-10 flex items-center justify-center bg-muted rounded border">
                                <Image className="w-4 h-4 text-muted-foreground" />
                              </div>
                            );
                          })()}
                          <div>
                            <div>{item.name}</div>
                            {item.purchase_options?.find(o => o.product_image_url) && (
                              <div className="text-xs text-muted-foreground">
                                <a href={item.purchase_options.find(o => o.product_image_url).product_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                                  🔗 {item.purchase_options.find(o => o.product_image_url).vendor_name}
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.category || '—'}</td>
                      <td className="px-4 py-3">{item.unit_of_measure}</td>
                      <td className="px-4 py-3">
                        {opts.length === 0 ? (
                          <span className="text-muted-foreground text-xs italic">None set</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {opts.map((o, i) => (
                              <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${o.is_preferred ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                {o.is_preferred && <Star className="w-2.5 h-2.5 fill-current" />}
                                {o.vendor_name || 'Vendor'}
                                {o.unit_cost ? ` $${parseFloat(o.unit_cost).toFixed(2)}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {cheapest ? (
                          <div>
                            <span className="font-semibold text-green-600">${parseFloat(cheapest.unit_cost).toFixed(2)}</span>
                            <span className="text-xs text-muted-foreground ml-1">via {cheapest.vendor_name}</span>
                          </div>
                        ) : preferred ? (
                          <span className="font-medium">${parseFloat(preferred.unit_cost || item.unit_cost || 0).toFixed(2)}</span>
                        ) : (
                          <span className="text-muted-foreground">${(item.unit_cost || 0).toFixed(2)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          // Try preferred first, then all options to find one with pack breakdown
                          const optWithPack = [preferred, ...opts].find(o => o && parseFloat(o?.inner_pack_units) > 0 && parseFloat(o?.packs_per_case) > 0);
                          const ppu = getPricePerUOM(optWithPack);
                          return ppu ? (
                            <span className="text-xs text-muted-foreground">${ppu}<span className="text-muted-foreground/60">/{item.unit_of_measure}</span></span>
                          ) : <span className="text-muted-foreground text-xs">—</span>;
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {item.is_commissary_item ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1 text-purple-600">
                              <Store className="w-3 h-3" />
                              <span className="text-xs font-medium">${(item.commissary_price || 0).toFixed(2)}</span>
                            </div>
                            {item.commissary_vendor_id && (
                              <span className="text-xs text-muted-foreground">
                                via {vendors.find(v => v.id === item.commissary_vendor_id)?.name || 'Unknown'}
                              </span>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={item.is_active ? 'active' : 'inactive'} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(item)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(item.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>

                    </tr>
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
        form={form}
        setForm={setForm}
        onSave={save}
        saving={saving}
        vendors={vendors}
        locations={locations}
        categories={categories}
      />

      {/* Merge dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Merge Duplicate Items</DialogTitle>
            <DialogDescription>
              Select which item to keep. All purchase options, order history, and associations will be combined.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {Array.from(selected).map(id => {
              const item = items.find(i => i.id === id);
              if (!item) return null;
              return (
                <label
                  key={id}
                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    mergeTargetId === id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                  }`}
                >
                  <input
                    type="radio"
                    name="merge_target"
                    value={id}
                    checked={mergeTargetId === id}
                    onChange={() => setMergeTargetId(id)}
                    className="w-4 h-4"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.purchase_options?.length || 0} purchase options • {(item.purchase_options || []).filter(o => o.product_image_url).length} with images
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMergeDialogOpen(false); setMergeTargetId(''); }}>Cancel</Button>
            <Button onClick={confirmMerge} disabled={merging || !mergeTargetId}>
              {merging ? 'Merging...' : 'Merge Items'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently Delete Items</DialogTitle>
            <DialogDescription>
              This action cannot be undone. You are about to delete {selected.size} items.
              Type "delete" to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="confirm-delete">Type "delete"</Label>
            <Input
              id="confirm-delete"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmBulkDelete} disabled={deleteConfirmText !== 'delete'}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}