import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Package, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function MobileCountDialog({ 
  open, 
  onOpenChange, 
  item, 
  previousQuantity, 
  countUnits, 
  currentInputs,
  onSave,
  onNext,
  isSubmitted,
  itemValue
}) {
  const [localInputs, setLocalInputs] = useState({});
  const [activeUnitIdx, setActiveUnitIdx] = useState(0);
  const [expandedVariants, setExpandedVariants] = useState(new Set());

  useEffect(() => {
    if (!open) return;
    // Always restore from currentInputs when dialog opens — even if it has values
    const inputs = (currentInputs && Object.keys(currentInputs).length > 0) ? { ...currentInputs } : {};
    setLocalInputs(inputs);
    setActiveUnitIdx(0);
    setExpandedVariants(new Set());
  }, [open, item?.item_id]);

  const activeUnit = (Array.isArray(countUnits) && countUnits[activeUnitIdx]) || (Array.isArray(countUnits) && countUnits[0]) || { label: 'EA', multiplier: 1 };

  const handleIncrement = (amount = 1) => {
    const currentVal = parseFloat(localInputs[activeUnit.label]) || 0;
    const newInputs = { ...localInputs, [activeUnit.label]: currentVal + amount };
    setLocalInputs(newInputs);
    onSave?.(newInputs);
  };

  const handleDecrement = (amount = 1) => {
    const currentVal = parseFloat(localInputs[activeUnit.label]) || 0;
    if (currentVal > 0) {
      const newInputs = { ...localInputs, [activeUnit.label]: Math.max(0, currentVal - amount) };
      setLocalInputs(newInputs);
      onSave?.(newInputs);
    }
  };

  const handleVariantIncrement = (variantLabel, amount = 1) => {
    const currentVal = parseFloat(localInputs[variantLabel]) || 0;
    const newInputs = { ...localInputs, [variantLabel]: currentVal + amount };
    setLocalInputs(newInputs);
    onSave?.(newInputs);
  };

  const handleVariantDecrement = (variantLabel, amount = 1) => {
    const currentVal = parseFloat(localInputs[variantLabel]) || 0;
    if (currentVal > 0) {
      const newInputs = { ...localInputs, [variantLabel]: Math.max(0, currentVal - amount) };
      setLocalInputs(newInputs);
      onSave?.(newInputs);
    }
  };

  const handleToggleVariant = (variantId) => {
    setExpandedVariants(prev => {
      const next = new Set(prev);
      if (next.has(variantId)) {
        next.delete(variantId);
      } else {
        next.add(variantId);
      }
      return next;
    });
  };

  const getTotalQty = () => {
    if (isGroupParent) {
      // For group items, sum all variant quantities
      return item?.grouped_items?.reduce((sum, v) => {
        return sum + (parseFloat(localInputs[v.variant_name]) || 0);
      }, 0) || 0;
    }
    return countUnits?.reduce((sum, u) => {
      return sum + (parseFloat(localInputs[u.label]) || 0) * u.multiplier;
    }, 0) || 0;
  };

  const isGroupParent = item?.has_variants && item?.grouped_items?.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-full h-[95vh] max-h-[95vh] p-0 flex flex-col z-[9999]">
        <DialogHeader className="px-4 py-3 border-b border-border bg-muted/40">
          <div className="flex items-center gap-3">
            <button onClick={() => onOpenChange(false)} className="p-1 hover:bg-muted rounded-lg">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <DialogTitle className="text-base font-semibold">{item?.item_name || item?.name}</DialogTitle>
              {item?.category && (
                <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>
              )}
            </div>
            {(() => {
              const img = item?.purchase_options?.find(o => o.product_image_url)?.product_image_url;
              return img ? (
                <img src={img} alt="" className="w-12 h-12 object-contain rounded border bg-white" />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center bg-muted rounded border">
                  <Package className="w-5 h-5 text-muted-foreground" />
                </div>
              );
            })()}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          <div className="bg-muted/30 rounded-lg p-3 border border-border">
            <p className="text-xs text-muted-foreground">Previous Quantity</p>
            <p className="text-lg font-semibold mt-1">{previousQuantity || 0} {item?.unit_of_measure}</p>
          </div>

          {isSubmitted ? (
            <div className="text-center py-8">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-3" />
              <p className="text-lg font-semibold">Count Submitted</p>
              <p className="text-3xl font-bold text-primary mt-2">
                {getTotalQty()} {item?.unit_of_measure}
              </p>
              {itemValue !== undefined && (
                <p className="text-sm text-muted-foreground mt-1">
                  Value: ${itemValue.toFixed(2)}
                </p>
              )}
            </div>
          ) : isGroupParent ? (
            <div className="space-y-4">
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Total Counted</p>
                  <p className="text-2xl font-bold text-primary mt-0.5">{getTotalQty()} {item?.unit_of_measure}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Value</p>
                  <p className="text-lg font-bold text-green-700">${itemValue?.toFixed(2) || '0.00'}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Count each size:</p>
              {item?.grouped_items?.map((variant) => {
                const variantLabel = variant.variant_name;
                const variantQty = parseFloat(localInputs[variantLabel]) || 0;
                const isExpanded = expandedVariants.has(variant.item_id);
                
                return (
                  <div key={variant.item_id} className="border border-border rounded-lg overflow-hidden">
                    <button
                      onClick={() => handleToggleVariant(variant.item_id)}
                      className="w-full px-4 py-3 bg-muted/40 flex items-center justify-between"
                    >
                      <div className="text-left">
                        <p className="font-medium text-primary">{variantLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {variantQty > 0 ? `${variantQty} counted` : 'Tap to count'}
                        </p>
                      </div>
                      {isExpanded ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                    </button>
                    
                    {isExpanded && (
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-center gap-3">
                          <Button type="button" variant="outline" onClick={() => handleVariantDecrement(variantLabel, 1)} className="h-12 w-12 text-xl font-bold">−</Button>
                          <Input type="number" value={localInputs[variantLabel] || ''} onChange={(e) => { const newInputs = { ...localInputs, [variantLabel]: e.target.value }; setLocalInputs(newInputs); onSave?.(newInputs); }} className="h-12 text-xl font-bold text-center w-24" placeholder="0" />
                          <Button type="button" variant="outline" onClick={() => handleVariantIncrement(variantLabel, 1)} className="h-12 w-12 text-xl font-bold">+</Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[1, 5, 10].map(amt => (
                            <Button key={amt} type="button" variant="outline" onClick={() => handleVariantIncrement(variantLabel, amt)} className="h-10 text-sm font-medium">+{amt}</Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {Array.isArray(countUnits) && countUnits.length > 1 && (
                <div>
                  <Label className="text-sm font-medium">Count Unit</Label>
                  <div className="flex gap-2 mt-2 overflow-x-auto pb-2">
                    {countUnits.map((unit, idx) => (
                      <button key={unit.label} onClick={() => setActiveUnitIdx(idx)} className={cn("px-4 py-2 rounded-lg border text-sm font-medium whitespace-nowrap transition-colors", activeUnitIdx === idx ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:bg-muted")}>{unit.label}</button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <Label className="text-sm font-medium">Enter Quantity ({activeUnit.label})</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 5, 10, 25].map(amt => (
                    <Button key={amt} type="button" variant="outline" onClick={() => handleIncrement(amt)} className="h-12 text-lg font-semibold">+{amt}</Button>
                  ))}
                </div>
                <div className="flex items-center justify-center gap-4">
                  <Button type="button" variant="outline" onClick={() => handleDecrement(1)} className="h-14 w-14 text-2xl font-bold">−</Button>
                  <Input type="number" value={localInputs[activeUnit.label] || ''} onChange={(e) => { const newInputs = { ...localInputs, [activeUnit.label]: e.target.value }; setLocalInputs(newInputs); onSave?.(newInputs); }} className="h-14 text-2xl font-bold text-center w-32" placeholder="0" />
                  <Button type="button" variant="outline" onClick={() => handleIncrement(1)} className="h-14 w-14 text-2xl font-bold">+</Button>
                </div>
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">Total Counted</p>
                  <p className="text-2xl font-bold text-primary mt-1">{getTotalQty()} {item?.unit_of_measure}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {!isSubmitted && (
          <DialogFooter className="px-4 py-3 border-t border-border bg-muted/40">
            <div className="flex items-center justify-between w-full gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Estimated Value</p>
                <p className="text-lg font-bold text-green-700">${itemValue?.toFixed(2) || '0.00'}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} className="h-12 px-4">Done</Button>
                {onNext && (
                  <Button onClick={onNext} className="h-12 px-6 text-base">
                    Next Item <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}