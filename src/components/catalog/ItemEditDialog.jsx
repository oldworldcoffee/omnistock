import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, ChevronDown, ChevronUp, Check, Sparkles, Shirt, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useIsMobile } from '@/hooks/useIsMobile';
import OptionExpandedFields from './OptionExpandedFields';

const UOM_OPTIONS = ['EA', 'fl-oz', 'oz', 'ml', 'L', 'Qt', 'gal', 'g', 'gr', 'kg', 'lb'];
const EMPTY_OPTION = { vendor_id: '', vendor_name: '', product_name: '', product_code: '', unit_cost: '', unit_of_measure: '', inner_pack_uom: '', inner_pack_units: '', inner_pack_name: '', packs_per_case: '', is_preferred: false, notes: '', location_ids: null };

export default function ItemEditDialog({ open, onOpenChange, initialForm, onSave, saving, vendors, locations = [], categories }) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState(initialForm || {});
  const [expandedOption, setExpandedOption] = useState(null);
  const [scrapingIdx, setScrapingIdx] = useState(null);
  const [variants, setVariants] = useState([]);
  const [loadingVariants, setLoadingVariants] = useState(false);

  const initialFormRef = useRef(initialForm);
  useEffect(() => { initialFormRef.current = initialForm; });

  useEffect(() => {
    if (open && initialForm?.id) {
      setLoadingVariants(true);
      base44.entities.ItemVariant.filter({ item_id: initialForm.id }).then((loaded) => {
        setVariants(loaded.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
      }).finally(() => setLoadingVariants(false));
    } else if (open) {
      setVariants([]);
    }
  }, [open, initialForm?.id]);

  useEffect(() => {
    if (open) {
      const f = initialFormRef.current;
      setForm(f ? { ...f, purchase_options: (f.purchase_options || []).map(o => ({ ...o })) } : {});
      setExpandedOption(null);
    }
  }, [open]);

  const scrapeProductImage = async (idx) => {
    const opt = (form.purchase_options || [])[idx];
    if (!opt.product_url) return;
    setScrapingIdx(idx);
    try {
      const response = await base44.functions.invoke('scrapeProductImage', { productUrl: opt.product_url });
      const imageUrl = response.data?.image_url;
      const price = response.data?.price;
      if (imageUrl) updateOption(idx, 'product_image_url', imageUrl);
      if (price) updateOption(idx, 'unit_cost', price.toString());
      toast.success(imageUrl && price ? 'Image & price scraped!' : imageUrl ? 'Image scraped!' : price ? 'Price scraped!' : 'Nothing found');
    } catch (error) {
      toast.error('Failed to scrape: ' + error.message);
    } finally {
      setScrapingIdx(null);
    }
  };

  const addOption = () => {
    const opts = [...(form.purchase_options || []), { ...EMPTY_OPTION }];
    setForm(f => ({ ...f, purchase_options: opts }));
    setExpandedOption(opts.length - 1);
  };

  const removeOption = (idx) => {
    setForm(f => ({ ...f, purchase_options: (f.purchase_options || []).filter((_, i) => i !== idx) }));
    if (expandedOption === idx) setExpandedOption(null);
  };

  const addVariant = () => {
    const nextNum = variants.length + 1;
    const defaultPrice = preferredOption?.unit_cost || form.unit_cost || '';
    setVariants([...variants, { variant_name: `Variant ${nextNum}`, sort_order: nextNum, unit_cost: defaultPrice, sku: '' }]);
  };

  const removeVariant = (idx) => setVariants(variants.filter((_, i) => i !== idx));

  const updateVariant = (idx, field, value) => setVariants(variants.map((v, i) => i === idx ? { ...v, [field]: value } : v));

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = Array.from(variants);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setVariants(reordered.map((v, i) => ({ ...v, sort_order: i })));
  };

  const updateOption = (idx, field, value) => {
    setForm(f => ({ ...f, purchase_options: (f.purchase_options || []).map((o, i) => i === idx ? { ...o, [field]: value } : o) }));
  };

  const setPreferred = (idx) => {
    setForm(f => {
      const opts = (f.purchase_options || []).map((o, i) => ({ ...o, is_preferred: i === idx }));
      const opt = opts[idx];
      return { ...f, purchase_options: opts, unit_cost: opt.unit_cost || f.unit_cost, vendor_id: opt.vendor_id || f.vendor_id };
    });
  };

  const handleVendorChange = (idx, vendorId) => {
    const vendor = vendors.find(v => v.id === vendorId);
    setForm(f => ({ ...f, purchase_options: (f.purchase_options || []).map((o, i) => i === idx ? { ...o, vendor_id: vendorId, vendor_name: vendor?.name || '' } : o) }));
  };

  const options = form.purchase_options || [];
  const preferredOption = options.find(o => o.is_preferred);
  const cheapest = options.length > 1 ? options.reduce((a, b) => (parseFloat(a.unit_cost) || 0) < (parseFloat(b.unit_cost) || 0) ? a : b) : null;

  const deriveAvailableCountUnits = () => {
    const baseUOM = form.unit_of_measure || 'EA';
    const all = [{ label: baseUOM, multiplier: 1 }];
    const seen = new Set([baseUOM]);
    for (const opt of options) {
      const packUnits = parseFloat(opt.inner_pack_units);
      const packName = opt.inner_pack_name?.trim();
      const packsPerCase = parseFloat(opt.packs_per_case);
      if (packName && packUnits > 0 && !seen.has(packName)) { all.push({ label: packName, multiplier: packUnits }); seen.add(packName); }
      if (packName && packUnits > 0 && packsPerCase > 0 && !seen.has('Case')) { all.push({ label: 'Case', multiplier: packUnits * packsPerCase }); seen.add('Case'); }
    }
    if (variants.length > 0) {
      for (const v of variants) {
        if (v.variant_name && !seen.has(v.variant_name)) { all.push({ label: v.variant_name, multiplier: 1 }); seen.add(v.variant_name); }
      }
    }
    return all;
  };

  const availableCountUnits = deriveAvailableCountUnits();
  const enabledCountUnits = form.count_units ?? availableCountUnits;

  const toggleCountUnit = (unit) => {
    const isEnabled = enabledCountUnits.some(u => u.label === unit.label);
    const next = isEnabled ? enabledCountUnits.filter(u => u.label !== unit.label) : [...enabledCountUnits, unit];
    setForm(f => ({ ...f, count_units: next }));
  };

  const handleSave = async () => {
    const filledForm = {
      ...form,
      purchase_options: (form.purchase_options || []).map(o => ({ ...o, unit_of_measure: o.unit_of_measure || form.unit_of_measure || '' })),
    };
    await onSave(filledForm, variants);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isMobile
        ? "max-w-full w-full h-[100dvh] max-h-[100dvh] rounded-none overflow-y-auto flex flex-col p-0"
        : "max-w-2xl max-h-[90vh] overflow-y-auto"
      }>
        <div className={isMobile ? "p-4 flex-1" : ""}>
          <DialogHeader className={isMobile ? "mb-4" : ""}>
            <DialogTitle>{form.id ? 'Edit Item' : 'Add Item'}</DialogTitle>
          </DialogHeader>

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Item Name *</Label>
              <Input className="mt-1" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Category</Label>
              <Input className="mt-1" value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} list="cats-dlg" />
              <datalist id="cats-dlg">{(categories || []).map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <Label>Unit of Measure *</Label>
              <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.unit_of_measure || ''} onChange={e => setForm(f => ({ ...f, unit_of_measure: e.target.value }))}>
                <option value="">— Select UOM —</option>
                {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <Label>SKU / Internal Code</Label>
              <Input className="mt-1" value={form.sku || ''} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
            </div>
            <div>
              <Label>Description</Label>
              <Input className="mt-1" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            {/* Switches */}
            <div className={`col-span-2 ${isMobile ? 'flex flex-col gap-3' : 'flex items-center gap-6'}`}>
              <div className="flex items-center gap-2">
                <Switch checked={!!form.is_commissary_item} onCheckedChange={v => setForm(f => ({ ...f, is_commissary_item: v }))} />
                <Label>Commissary Item</Label>
              </div>
              {form.is_commissary_item && (
                <div className={isMobile ? 'grid grid-cols-2 gap-2' : 'flex items-center gap-4'}>
                  <div>
                    <Label className="text-xs text-muted-foreground">Price $</Label>
                    <Input className="mt-1 w-full" type="number" step="0.01" value={form.commissary_price || ''} onChange={e => setForm(f => ({ ...f, commissary_price: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Commissary Vendor</Label>
                    <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={form.commissary_vendor_id || ''} onChange={e => setForm(f => ({ ...f, commissary_vendor_id: e.target.value }))}>
                      <option value="">Select commissary...</option>
                      {vendors.filter(v => v.is_commissary).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className={`flex items-center gap-2 ${!isMobile ? 'ml-auto' : ''}`}>
                <Switch checked={form.is_active !== false} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
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

            {options.length > 0 && (
              <div className="mb-2">
                {isMobile ? (
                  /* Mobile: card list */
                  <div className="space-y-2">
                    {options.map((opt, idx) => {
                      const isCheapest = cheapest && options.length > 1 && parseFloat(opt.unit_cost) === parseFloat(cheapest.unit_cost);
                      const isExpanded = expandedOption === idx;
                      return (
                        <div key={idx} className={`border rounded-lg overflow-hidden ${opt.is_preferred ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'}`}>
                          <button className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left" onClick={() => setExpandedOption(isExpanded ? null : idx)}>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{opt.vendor_name || <span className="text-muted-foreground italic">Select vendor</span>}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className={`text-xs font-semibold ${isCheapest ? 'text-green-600' : 'text-foreground'}`}>
                                  ${parseFloat(opt.unit_cost || 0).toFixed(2)}/{opt.unit_of_measure || form.unit_of_measure || 'UOM'}
                                </span>
                                {isCheapest && <span className="text-xs text-green-600">✓ best</span>}
                                {opt.is_preferred && <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5">Preferred</span>}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={(e) => { e.stopPropagation(); setPreferred(idx); }} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${opt.is_preferred ? 'bg-primary border-primary' : 'border-border hover:border-primary'}`}>
                                {opt.is_preferred && <Check className="w-3 h-3 text-white" />}
                              </button>
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-border px-3 py-3 bg-muted/20">
                              <OptionExpandedFields opt={opt} idx={idx} form={form} vendors={vendors} locations={locations} handleVendorChange={handleVendorChange} updateOption={updateOption} scrapeProductImage={scrapeProductImage} scrapingIdx={scrapingIdx} removeOption={removeOption} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Desktop: table */
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Supplier</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Product Name</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Pack</th>
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
                              <tr key={idx} className={`hover:bg-muted/30 cursor-pointer ${opt.is_preferred ? 'bg-primary/5' : ''}`} onClick={() => setExpandedOption(isExpanded ? null : idx)}>
                                <td className="px-3 py-2.5 font-medium">{opt.vendor_name || <span className="text-muted-foreground italic">Select vendor</span>}</td>
                                <td className="px-3 py-2.5 text-muted-foreground">{opt.product_name || '—'}</td>
                                <td className="px-3 py-2.5 text-muted-foreground text-xs">
                                  {parseFloat(opt.inner_pack_units) > 0 && opt.inner_pack_name ? `${opt.inner_pack_units} ${opt.inner_pack_uom || form.unit_of_measure || ''}${opt.packs_per_case > 0 ? ` × ${opt.packs_per_case} ${opt.inner_pack_name}s` : ''}` : '—'}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`font-semibold ${isCheapest ? 'text-green-600' : 'text-foreground'}`}>${parseFloat(opt.unit_cost || 0).toFixed(2)}</span>
                                  <span className="text-xs text-muted-foreground ml-0.5">/{opt.unit_of_measure || form.unit_of_measure || 'UOM'}</span>
                                  {isCheapest && <span className="ml-1 text-xs text-green-600 font-medium">✓ best</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center">{opt.product_url && <span className="text-xs text-primary font-medium">🔗 {opt.product_image_url ? '+ img' : 'link'}</span>}</td>
                                <td className="px-3 py-2.5 text-center">
                                  <button onClick={(e) => { e.stopPropagation(); setPreferred(idx); }} className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mx-auto transition-colors ${opt.is_preferred ? 'bg-primary border-primary' : 'border-border hover:border-primary'}`}>
                                    {opt.is_preferred && <Check className="w-3 h-3 text-white" />}
                                  </button>
                                </td>
                                <td className="px-2 py-2.5 flex items-center gap-1">
                                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`exp-${idx}`} className="bg-muted/20">
                                  <td colSpan={7} className="px-4 py-4">
                                    <OptionExpandedFields opt={opt} idx={idx} form={form} vendors={vendors} locations={locations} handleVendorChange={handleVendorChange} updateOption={updateOption} scrapeProductImage={scrapeProductImage} scrapingIdx={scrapingIdx} removeOption={removeOption} />
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
              </div>
            )}

            <button onClick={addOption} className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors">
              <Plus className="w-4 h-4" /> Add purchase option
            </button>
            {options.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Add vendors you can order this item from. Mark one as preferred for default ordering.</p>
            )}
          </div>

          {/* Variants Section */}
          {variants.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shirt className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm text-foreground">Variants (Sizes/Colors)</h3>
                </div>
                <Button variant="outline" size="sm" onClick={addVariant}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Variant
                </Button>
              </div>

              {loadingVariants ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              ) : (
                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable droppableId="variants">
                    {(provided) => (
                      <div className="border border-border rounded-lg overflow-hidden" {...provided.droppableProps} ref={provided.innerRef}>
                        {isMobile ? (
                          variants.map((v, idx) => (
                            <Draggable key={`variant-${idx}`} draggableId={`variant-${idx}`} index={idx}>
                              {(provided) => (
                                <div ref={provided.innerRef} {...provided.draggableProps} className="p-3 border-b border-border last:border-b-0 bg-background">
                                  <div className="flex items-center gap-2 mb-2">
                                    <div {...provided.dragHandleProps} className="cursor-grab"><GripVertical className="w-4 h-4 text-muted-foreground" /></div>
                                    <span className="text-xs text-muted-foreground font-medium">Variant {idx + 1}</span>
                                    <Button variant="ghost" size="icon" className="ml-auto h-6 w-6 text-destructive" onClick={() => removeVariant(idx)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-xs">Name</Label>
                                      <Input className="mt-1" value={v.variant_name || ''} onChange={e => updateVariant(idx, 'variant_name', e.target.value)} placeholder="e.g. Small" />
                                    </div>
                                    <div>
                                      <Label className="text-xs">Price</Label>
                                      <Input className="mt-1" type="number" step="0.01" value={v.unit_cost || ''} onChange={e => updateVariant(idx, 'unit_cost', e.target.value)} placeholder="0.00" />
                                    </div>
                                    <div className="col-span-2">
                                      <Label className="text-xs">SKU</Label>
                                      <Input className="mt-1" value={v.sku || ''} onChange={e => updateVariant(idx, 'sku', e.target.value)} placeholder="SKU" />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="bg-muted/60">
                              <tr>
                                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-10"></th>
                                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Variant</th>
                                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">SKU</th>
                                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Price</th>
                                <th className="px-2 py-2"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {variants.map((v, idx) => (
                                <Draggable key={`variant-${idx}`} draggableId={`variant-${idx}`} index={idx}>
                                  {(provided) => (
                                    <tr ref={provided.innerRef} {...provided.draggableProps} className="hover:bg-muted/30">
                                      <td className="px-3 py-2"><div {...provided.dragHandleProps} className="cursor-grab"><GripVertical className="w-4 h-4 text-muted-foreground" /></div></td>
                                      <td className="px-3 py-2"><Input value={v.variant_name || ''} onChange={e => updateVariant(idx, 'variant_name', e.target.value)} placeholder="e.g. Small, Medium" className="w-full" /></td>
                                      <td className="px-3 py-2"><Input value={v.sku || ''} onChange={e => updateVariant(idx, 'sku', e.target.value)} placeholder="SKU" className="w-full" /></td>
                                      <td className="px-3 py-2"><Input type="number" step="0.01" value={v.unit_cost || ''} onChange={e => updateVariant(idx, 'unit_cost', e.target.value)} placeholder="0.00" className="w-24" /></td>
                                      <td className="px-2 py-2"><Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeVariant(idx)}><Trash2 className="w-4 h-4" /></Button></td>
                                    </tr>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            </tbody>
                          </table>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>
          )}

          {/* Count Units */}
          {availableCountUnits.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <h3 className="font-semibold text-sm text-foreground mb-1">Counting Units</h3>
              <p className="text-xs text-muted-foreground mb-3">Choose which units can be used when counting this item during inventory.</p>
              <div className="flex flex-wrap gap-2">
                {availableCountUnits.map(unit => {
                  const enabled = enabledCountUnits.some(u => u.label === unit.label);
                  return (
                    <button key={unit.label} type="button" onClick={() => toggleCountUnit(unit)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${enabled ? 'bg-primary/10 text-primary border-primary/40' : 'bg-muted text-muted-foreground border-border opacity-50'}`}>
                      {enabled && <Check className="w-3 h-3 inline mr-1.5" />}
                      {unit.label}
                      {unit.multiplier > 1 && <span className="ml-1.5 text-xs opacity-70">× {unit.multiplier}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.unit_of_measure}>
              {saving ? 'Saving...' : 'Save Item'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}