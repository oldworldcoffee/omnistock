import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Sparkles, MapPin, Check } from 'lucide-react';

const UOM_OPTIONS = ['EA', 'fl-oz', 'oz', 'ml', 'L', 'Qt', 'gal', 'g', 'gr', 'kg', 'lb'];

export default function OptionExpandedFields({ opt, idx, form, vendors, locations, handleVendorChange, updateOption, scrapeProductImage, scrapingIdx, removeOption }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label className="text-xs">Supplier *</Label>
        <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={opt.vendor_id || ''} onChange={e => handleVendorChange(idx, e.target.value)}>
          <option value="">— Select Supplier —</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div>
        <Label className="text-xs">Product Name (as on invoice)</Label>
        <Input className="mt-1" value={opt.product_name || ''} onChange={e => updateOption(idx, 'product_name', e.target.value)} placeholder="e.g. Chicken Breast 40lb" />
      </div>
      <div>
        <Label className="text-xs">Supplier Product Code</Label>
        <Input className="mt-1" value={opt.product_code || ''} onChange={e => updateOption(idx, 'product_code', e.target.value)} placeholder="e.g. SYS-12345" />
      </div>

      {/* Pack Size Breakdown */}
      <div className="col-span-2 border border-border rounded-lg p-3 bg-muted/30">
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Pack Size Breakdown</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Units per Inner Pack</Label>
            <div className="mt-1 flex gap-1.5">
              <Input type="number" placeholder="50" value={opt.inner_pack_units ?? ''} onChange={e => updateOption(idx, 'inner_pack_units', e.target.value)} className="flex-1 min-w-0" />
              <select className="border border-input rounded-md px-2 py-1 text-sm bg-background w-20 shrink-0" value={opt.inner_pack_uom || ''} onChange={e => updateOption(idx, 'inner_pack_uom', e.target.value)}>
                <option value="">UOM</option>
                {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Inner Pack Name</Label>
            <Input className="mt-1" placeholder="e.g. Sleeve, Tray, Bottle" value={opt.inner_pack_name || ''} onChange={e => updateOption(idx, 'inner_pack_name', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Packs per Case</Label>
            <Input className="mt-1" type="number" placeholder="e.g. 4" value={opt.packs_per_case ?? ''} onChange={e => updateOption(idx, 'packs_per_case', e.target.value)} />
          </div>
        </div>
        {parseFloat(opt.inner_pack_units) > 0 && opt.inner_pack_name && (
          <div className="mt-2 p-2 bg-primary/5 rounded-md text-xs text-primary font-medium">
            {(() => {
              const packUom = opt.inner_pack_uom || form.unit_of_measure || 'EA';
              const packUnits = parseFloat(opt.inner_pack_units);
              const packsPerCase = parseFloat(opt.packs_per_case);
              if (packsPerCase > 0) return `${packUnits} ${packUom} × ${packsPerCase} ${opt.inner_pack_name}s = ${packsPerCase * packUnits} ${packUom} per Case`;
              return `${packUnits} ${packUom} per ${opt.inner_pack_name}`;
            })()}
          </div>
        )}
      </div>

      {/* Unit Cost */}
      <div>
        <Label className="text-xs">Unit Cost ($)</Label>
        <div className="mt-1 flex gap-2 items-center">
          <Input type="number" step="0.01" value={opt.unit_cost || ''} onChange={e => updateOption(idx, 'unit_cost', e.target.value)} className="flex-1" />
          <span className="text-sm text-muted-foreground whitespace-nowrap">per</span>
          <select className="border border-input rounded-md px-2 py-1.5 text-sm bg-background" value={opt.unit_of_measure || form.unit_of_measure || ''} onChange={e => updateOption(idx, 'unit_of_measure', e.target.value)}>
            {form.unit_of_measure && <option value={form.unit_of_measure}>{form.unit_of_measure}</option>}
            {opt.inner_pack_name && opt.inner_pack_name !== form.unit_of_measure && <option value={opt.inner_pack_name}>{opt.inner_pack_name}</option>}
            {opt.inner_pack_name && parseFloat(opt.inner_pack_units) > 0 && parseFloat(opt.packs_per_case) > 0 && <option value="Case">Case</option>}
          </select>
        </div>
      </div>

      {/* Product URL */}
      <div className="col-span-2">
        <Label className="text-xs">Product URL (for online ordering)</Label>
        <div className="mt-1 flex gap-2">
          <Input value={opt.product_url || ''} onChange={e => updateOption(idx, 'product_url', e.target.value)} placeholder="e.g. https://amazon.com/..." className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => scrapeProductImage(idx)} disabled={!opt.product_url || scrapingIdx === idx} title="Auto-scrape product image from URL">
            <Sparkles className={`w-3.5 h-3.5 ${scrapingIdx === idx ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Product Image URL */}
      <div className="col-span-2">
        <Label className="text-xs">Product Image URL</Label>
        <Input className="mt-1" value={opt.product_image_url || ''} onChange={e => updateOption(idx, 'product_image_url', e.target.value)} placeholder="Auto-scraped or paste URL..." />
        {opt.product_image_url && <img src={opt.product_image_url} alt="Preview" className="mt-2 h-20 object-contain rounded border" onError={(e) => e.target.style.display = 'none'} />}
      </div>

      {/* Notes */}
      <div className="col-span-2">
        <Label className="text-xs">Notes</Label>
        <Input className="mt-1" value={opt.notes || ''} onChange={e => updateOption(idx, 'notes', e.target.value)} placeholder="e.g. seasonal pricing, min order qty" />
      </div>

      {/* Location Assortment */}
      {locations.length > 0 && (
        <div className="col-span-2 border-t border-border pt-3 mt-1">
          <div className="flex items-center gap-1.5 mb-2">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Location Assortment</p>
            <span className="text-xs text-muted-foreground ml-1">(all by default)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {locations.map(loc => {
              const allSelected = !opt.location_ids || opt.location_ids.length === 0;
              const isSelected = allSelected || opt.location_ids.includes(loc.id);
              return (
                <button key={loc.id} type="button"
                  onClick={() => {
                    const currentIds = opt.location_ids?.length > 0 ? opt.location_ids : locations.map(l => l.id);
                    const next = isSelected ? currentIds.filter(id => id !== loc.id) : [...currentIds, loc.id];
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

      <div className="col-span-2 flex justify-end mt-1">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => removeOption(idx)}>
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove Option
        </Button>
      </div>
    </div>
  );
}