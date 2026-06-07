import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Star, ChevronDown, ChevronUp, Check, MapPin, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

const EMPTY_OPTION = { vendor_id: '', vendor_name: '', product_name: '', product_code: '', pack_size: '', unit_cost: '', unit_of_measure: '', inner_pack_units: '', inner_pack_name: '', packs_per_case: '', is_preferred: false, notes: '', location_ids: null };

export default function ItemEditDialog({ open, onOpenChange, form, setForm, onSave, saving, vendors, locations = [], categories }) {
  const [expandedOption, setExpandedOption] = useState(null);
  const [scrapingIdx, setScrapingIdx] = useState(null);

  const scrapeProductImage = async (idx) => {
    const opt = (form.purchase_options || [])[idx];
    if (!opt.product_url) return;
    
    setScrapingIdx(idx);
    try {
      const response = await base44.functions.invoke('scrapeProductImage', { productUrl: opt.product_url });
      const imageUrl = response.data?.image_url;
      const price = response.data?.price;
      if (imageUrl) {
        updateOption(idx, 'product_image_url', imageUrl);
      }
      if (price) {
        updateOption(idx, 'unit_cost', price.toString());
      }
      toast.success(imageUrl && price ? 'Image & price scraped!' : imageUrl ? 'Image scraped!' : price ? 'Price scraped!' : 'Nothing found');
    } catch (error) {
      toast.error('Failed to scrape: ' + error.message);
    } finally {
      setScrapingIdx(null);
    }
  };

  // Debug: Check if vendor_id matches available vendors
  useEffect(() => {
    (form.purchase_options || []).forEach((opt, idx) => {
      if (opt.vendor_id && !vendors.find(v => v.id === opt.vendor_id)) {
        console.warn(`Purchase option ${idx}: vendor_id "${opt.vendor_id}" not found in vendors list. vendor_name: "${opt.vendor_name}"`);
      }
    });
  }, [form.purchase_options, vendors]);

  const addOption = () => {
    const opts = [...(form.purchase_options || []), { ...EMPTY_OPTION }];
    setForm(f => ({ ...f, purchase_options: opts }));
    setExpandedOption(opts.length - 1);
  };

  const removeOption = (idx) => {
    setForm(f => ({ ...f, purchase_options: (f.purchase_options || []).filter((_, i) => i !== idx) }));
    if (expandedOption === idx) setExpandedOption(null);
  };

  const updateOption = (idx, field, value) => {
    setForm(f => ({
      ...f,
      purchase_options: (f.purchase_options || []).map((o, i) => i === idx ? { ...o, [field]: value } : o),
    }));
  };

  const setPreferred = (idx) => {
    const opts = (form.purchase_options || []).map((o, i) => ({ ...o, is_preferred: i === idx }));
    setForm(f => ({ ...f, purchase_options: opts }));
    // Set the item's default unit_cost and vendor_id to the preferred option
    const opt = opts[idx];
    setForm(f => ({ ...f, purchase_options: opts, unit_cost: opt.unit_cost || f.unit_cost, vendor_id: opt.vendor_id || f.vendor_id }));
  };

  const handleVendorChange = (idx, vendorId) => {
    const vendor = vendors.find(v => v.id === vendorId);
    setForm(f => ({
      ...f,
      purchase_options: (f.purchase_options || []).map((o, i) =>
        i === idx ? { ...o, vendor_id: vendorId, vendor_name: vendor?.name || '' } : o
      ),
    }));
  };

  const options = form.purchase_options || [];
  const preferredOption = options.find(o => o.is_preferred);
  const cheapest = options.length > 1 ? options.reduce((a, b) => (parseFloat(a.unit_cost) || 0) < (parseFloat(b.unit_cost) || 0) ? a : b) : null;

  // Derive all possible counting units from purchase options
  const deriveAvailableCountUnits = () => {
    const baseUOM = form.unit_of_measure || 'EA';
    const all = [{ label: baseUOM, multiplier: 1 }];
    const seen = new Set([baseUOM]);
    for (const opt of options) {
      const packUnits = parseFloat(opt.inner_pack_units);
      const packName = opt.inner_pack_name?.trim();
      const packsPerCase = parseFloat(opt.packs_per_case);
      if (packName && packUnits > 0 && !seen.has(packName)) {
        all.push({ label: packName, multiplier: packUnits });
        seen.add(packName);
      }
      if (packName && packUnits > 0 && packsPerCase > 0 && !seen.has('Case')) {
        all.push({ label: 'Case', multiplier: packUnits * packsPerCase });
        seen.add('Case');
      }
    }
    return all;
  };

  const availableCountUnits = deriveAvailableCountUnits();
  // If count_units not yet explicitly set, default to all available
  const enabledCountUnits = form.count_units ?? availableCountUnits;

  const toggleCountUnit = (unit) => {
    const isEnabled = enabledCountUnits.some(u => u.label === unit.label);
    const next = isEnabled
      ? enabledCountUnits.filter(u => u.label !== unit.label)
      : [...enabledCountUnits, unit];
    setForm(f => ({ ...f, count_units: next }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Edit Item' : 'Add Item'}</DialogTitle>
        </DialogHeader>

        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Item Name *</Label>
            <Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <Label>Category</Label>
            <Input className="mt-1" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} list="cats-dlg" />
            <datalist id="cats-dlg">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <Label>Unit of Measure *</Label>
            <Input className="mt-1" placeholder="e.g. case, lb, each" value={form.unit_of_measure} onChange={e => setForm(f => ({ ...f, unit_of_measure: e.target.value }))} />
          </div>
          <div>
            <Label>SKU / Internal Code</Label>
            <Input className="mt-1" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
          </div>
          <div>
            <Label>Description</Label>
            <Input className="mt-1" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="col-span-2 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={form.is_commissary_item} onCheckedChange={v => setForm(f => ({ ...f, is_commissary_item: v }))} />
              <Label>Commissary Item</Label>
            </div>
            {form.is_commissary_item && (
              <>
                <div className="flex items-center gap-2">
                  <Label>Commissary Price $</Label>
                  <Input className="w-24" type="number" step="0.01" value={form.commissary_price} onChange={e => setForm(f => ({ ...f, commissary_price: e.target.value }))} />
                </div>
                <div className="flex items-center gap-2">
                  <Label>Commissary Vendor</Label>
                  <select
                    className="border border-input rounded-md px-3 py-2 text-sm bg-background"
                    value={form.commissary_vendor_id || ''}
                    onChange={e => setForm(f => ({ ...f, commissary_vendor_id: e.target.value }))}
                  >
                    <option value="">Select commissary...</option>
                    {vendors.filter(v => v.is_commissary).map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
        </div>

        {/* Purchase Options */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm text-foreground">Purchase Options</h3>
            {options.length > 0 && preferredOption && (
              <span className="text-xs text-muted-foreground">
                Default: <span className="font-medium text-foreground">{preferredOption.vendor_name || 'Unknown'}</span> @ <span className="font-medium text-primary">${parseFloat(preferredOption.unit_cost || 0).toFixed(2)}</span>
              </span>
            )}
          </div>

          {/* Options list (collapsed view) */}
          {options.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden mb-2">
              <table className="w-full text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Supplier</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Product Name</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Pack</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">UOM</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Price</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">Online</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground">Preferred</th>
                    <th className="px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {options.map((opt, idx) => {
                    const isCheapest = cheapest && options.length > 1 && parseFloat(opt.unit_cost) === parseFloat(cheapest.unit_cost);
                    const isExpanded = expandedOption === idx;
                    return (
                      <>
                        <tr
                          key={idx}
                          className={`hover:bg-muted/30 cursor-pointer ${opt.is_preferred ? 'bg-primary/5' : ''}`}
                          onClick={() => setExpandedOption(isExpanded ? null : idx)}
                        >
                          <td className="px-3 py-2.5 font-medium">{opt.vendor_name || <span className="text-muted-foreground italic">Select vendor</span>}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{opt.product_name || '—'}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{opt.pack_size || '—'}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">{opt.unit_of_measure || form.unit_of_measure || '—'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`font-semibold ${isCheapest ? 'text-green-600' : 'text-foreground'}`}>
                              ${parseFloat(opt.unit_cost || 0).toFixed(2)}
                            </span>
                            {isCheapest && <span className="ml-1 text-xs text-green-600 font-medium">✓ best</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {opt.product_url && (
                              <span className="text-xs text-primary font-medium" title={opt.product_url}>
                                🔗 {opt.product_image_url ? '+ img' : 'link'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={(e) => { e.stopPropagation(); setPreferred(idx); }}
                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mx-auto transition-colors ${opt.is_preferred ? 'bg-primary border-primary' : 'border-border hover:border-primary'}`}
                            >
                              {opt.is_preferred && <Check className="w-3 h-3 text-white" />}
                            </button>
                          </td>
                          <td className="px-2 py-2.5 flex items-center gap-1">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </td>
                        </tr>

                        {/* Expanded edit row */}
                        {isExpanded && (
                          <tr key={`exp-${idx}`} className="bg-muted/20">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label className="text-xs">Supplier *</Label>
                                  <select
                                    className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                                    value={opt.vendor_id}
                                    onChange={e => handleVendorChange(idx, e.target.value)}
                                  >
                                    <option value="">— Select Supplier —</option>
                                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <Label className="text-xs">Product Name (as on invoice)</Label>
                                  <Input className="mt-1" value={opt.product_name} onChange={e => updateOption(idx, 'product_name', e.target.value)} placeholder="e.g. Chicken Breast 40lb" />
                                </div>
                                <div>
                                  <Label className="text-xs">Supplier Product Code</Label>
                                  <Input className="mt-1" value={opt.product_code} onChange={e => updateOption(idx, 'product_code', e.target.value)} placeholder="e.g. SYS-12345" />
                                </div>
                                <div>
                                  <Label className="text-xs">Pack Size</Label>
                                  <Input className="mt-1" value={opt.pack_size} onChange={e => updateOption(idx, 'pack_size', e.target.value)} placeholder="e.g. 4x5lb, 12-pack" />
                                </div>
                                <div>
                                  <Label className="text-xs">Unit Cost ($)</Label>
                                  <Input className="mt-1" type="number" step="0.01" value={opt.unit_cost} onChange={e => updateOption(idx, 'unit_cost', e.target.value)} />
                                </div>
                                <div>
                                  <Label className="text-xs">Ordering UOM (if different)</Label>
                                  <Input className="mt-1" value={opt.unit_of_measure} onChange={e => updateOption(idx, 'unit_of_measure', e.target.value)} placeholder={form.unit_of_measure} />
                                </div>
                                <div className="col-span-2">
                                   <Label className="text-xs">Product URL (for online ordering)</Label>
                                   <div className="mt-1 flex gap-2">
                                     <Input 
                                       value={opt.product_url || ''} 
                                       onChange={e => updateOption(idx, 'product_url', e.target.value)} 
                                       placeholder="e.g. https://amazon.com/..." 
                                       className="flex-1"
                                     />
                                     <Button 
                                       variant="outline" 
                                       size="sm"
                                       onClick={() => scrapeProductImage(idx)}
                                       disabled={!opt.product_url || scrapingIdx === idx}
                                       title="Auto-scrape product image from URL"
                                     >
                                       <Sparkles className={`w-3.5 h-3.5 ${scrapingIdx === idx ? 'animate-spin' : ''}`} />
                                     </Button>
                                   </div>
                                 </div>
                                 <div className="col-span-2">
                                   <Label className="text-xs">Product Image URL</Label>
                                   <Input className="mt-1" value={opt.product_image_url || ''} onChange={e => updateOption(idx, 'product_image_url', e.target.value)} placeholder="Auto-scraped or paste URL..." />
                                   {opt.product_image_url && (
                                     <img src={opt.product_image_url} alt="Preview" className="mt-2 h-20 object-contain rounded border" onError={(e) => e.target.style.display = 'none'} />
                                   )}
                                 </div>
                                 <div className="col-span-2">
                                   <Label className="text-xs">Notes</Label>
                                   <Input className="mt-1" value={opt.notes} onChange={e => updateOption(idx, 'notes', e.target.value)} placeholder="e.g. seasonal pricing, min order qty" />
                                 </div>
                                 {/* Pack size breakdown */}
                                 <div className="col-span-2 border-t border-border pt-3 mt-1">
                                   <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Pack Size Breakdown</p>
                                   <div className="grid grid-cols-3 gap-3">
                                     <div>
                                       <Label className="text-xs">Units per Inner Pack</Label>
                                       <Input className="mt-1" type="number" placeholder={`e.g. 50`} value={opt.inner_pack_units ?? ''} onChange={e => updateOption(idx, 'inner_pack_units', e.target.value)} />
                                     </div>
                                     <div>
                                       <Label className="text-xs">Inner Pack Name</Label>
                                       <Input className="mt-1" placeholder="e.g. Sleeve, Tray" value={opt.inner_pack_name || ''} onChange={e => updateOption(idx, 'inner_pack_name', e.target.value)} />
                                     </div>
                                     <div>
                                       <Label className="text-xs">Packs per Case</Label>
                                       <Input className="mt-1" type="number" placeholder="e.g. 20" value={opt.packs_per_case ?? ''} onChange={e => updateOption(idx, 'packs_per_case', e.target.value)} />
                                     </div>
                                   </div>
                                   {parseFloat(opt.inner_pack_units) > 0 && opt.inner_pack_name && parseFloat(opt.packs_per_case) > 0 && (
                                     <div className="mt-2 p-2 bg-primary/5 rounded-md text-xs text-primary font-medium">
                                       1 Case = {opt.packs_per_case} {opt.inner_pack_name}s × {opt.inner_pack_units} {opt.unit_of_measure || form.unit_of_measure || 'EA'} = {parseFloat(opt.packs_per_case) * parseFloat(opt.inner_pack_units)} {opt.unit_of_measure || form.unit_of_measure || 'EA'} total
                                     </div>
                                   )}
                                 </div>
                                 {/* Location assortment */}
                                 {locations.length > 0 && (
                                   <div className="col-span-2 border-t border-border pt-3 mt-1">
                                     <div className="flex items-center gap-1.5 mb-2">
                                       <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                                       <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location Assortment</p>
                                       <span className="text-xs text-muted-foreground ml-1">(all locations by default)</span>
                                     </div>
                                     <div className="flex flex-wrap gap-2">
                                       {locations.map(loc => {
                                         const allSelected = !opt.location_ids || opt.location_ids.length === 0;
                                         const isSelected = allSelected || opt.location_ids.includes(loc.id);
                                         return (
                                           <button
                                             key={loc.id}
                                             type="button"
                                             onClick={() => {
                                               const currentIds = opt.location_ids?.length > 0 ? opt.location_ids : locations.map(l => l.id);
                                               const next = isSelected
                                                 ? currentIds.filter(id => id !== loc.id)
                                                 : [...currentIds, loc.id];
                                               // If all selected, store null (means "all")
                                               updateOption(idx, 'location_ids', next.length === locations.length ? null : next);
                                             }}
                                             className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${isSelected ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-muted-foreground border-border opacity-50'}`}
                                           >
                                             {isSelected && <Check className="w-2.5 h-2.5 inline mr-1" />}
                                             {loc.name}
                                           </button>
                                         );
                                       })}
                                     </div>
                                   </div>
                                 )}
                                 </div>
                                 <div className="flex justify-end mt-3">
                                 <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeOption(idx)}>
                                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove Option
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={addOption}
            className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Add purchase option
          </button>

          {options.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">Add vendors you can order this item from. Mark one as preferred for default ordering.</p>
          )}
        </div>

        {/* Count Units */}
        {availableCountUnits.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="font-semibold text-sm text-foreground mb-1">Counting Units</h3>
            <p className="text-xs text-muted-foreground mb-3">Choose which units can be used when counting this item during inventory.</p>
            <div className="flex flex-wrap gap-2">
              {availableCountUnits.map(unit => {
                const enabled = enabledCountUnits.some(u => u.label === unit.label);
                return (
                  <button
                    key={unit.label}
                    type="button"
                    onClick={() => toggleCountUnit(unit)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${enabled ? 'bg-primary/10 text-primary border-primary/40' : 'bg-muted text-muted-foreground border-border opacity-50'}`}
                  >
                    {enabled && <Check className="w-3 h-3 inline mr-1.5" />}
                    {unit.label}
                    {unit.multiplier > 1 && <span className="ml-1.5 text-xs opacity-70">× {unit.multiplier}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !form.name || !form.unit_of_measure}>
            {saving ? 'Saving...' : 'Save Item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}