import { useState } from 'react';
import { DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Star, Package } from 'lucide-react';

export default function SplitOptionsDialog({ item, onCancel, onConfirm, splitting }) {
  const [selectedOptions, setSelectedOptions] = useState([]);

  const opts = item?.purchase_options || [];

  const toggleOption = (idx) => {
    setSelectedOptions(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleConfirm = () => {
    if (selectedOptions.length < 2) return;
    onConfirm(selectedOptions);
  };

  return (
    <div className="py-4">
      <div className="mb-4 p-3 bg-muted/50 rounded-lg">
        <p className="text-sm font-medium text-foreground">{item?.name}</p>
        <p className="text-xs text-muted-foreground">
          {opts.length} purchase options • Select at least 2 to split
        </p>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {opts.map((opt, idx) => (
          <label
            key={idx}
            className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
              selectedOptions.includes(idx) ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
            }`}
          >
            <Checkbox
              checked={selectedOptions.includes(idx)}
              onCheckedChange={() => toggleOption(idx)}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground">{opt.vendor_name || 'Unknown Vendor'}</p>
                {opt.is_preferred && (
                  <span className="text-xs text-primary" title="Preferred">
                    <Star className="w-3 h-3 fill-current" />
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>${parseFloat(opt.unit_cost || 0).toFixed(2)}{opt.unit_of_measure ? `/${opt.unit_of_measure}` : ''}</span>
                {opt.product_name && <span>• {opt.product_name}</span>}
                {opt.pack_size && <span>• {opt.pack_size}</span>}
                {opt.inner_pack_units > 0 && opt.inner_pack_name && (
                  <span>• {opt.inner_pack_units} {opt.inner_pack_name}{opt.packs_per_case > 0 ? ` × ${opt.packs_per_case}` : ''}</span>
                )}
              </div>
            </div>
          </label>
        ))}
      </div>

      {selectedOptions.length < 2 && (
        <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1">
          <Package className="w-3 h-3" />
          Select at least 2 options to split
        </p>
      )}

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleConfirm} disabled={splitting || selectedOptions.length < 2}>
          {splitting ? 'Splitting...' : `Split ${selectedOptions.length} Options`}
        </Button>
      </DialogFooter>
    </div>
  );
}