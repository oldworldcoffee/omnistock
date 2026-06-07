import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export default function VendorOptionSelector({ item, currentVendorId, onSelectVendor, locations, selectedLocation }) {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!item || !item.purchase_options) return null;
  
  const purchaseOptions = item.purchase_options || [];
  const location = locations.find(l => l.id === selectedLocation);
  
  // Get all unique vendor options for this item
  const allOptions = [];
  
  // Add primary vendor if exists
  if (item.vendor_id && purchaseOptions.length > 0 && !purchaseOptions.find(p => p.vendor_id === item.vendor_id)) {
    allOptions.push({
      vendor_id: item.vendor_id,
      vendor_name: item.vendor_name || 'Primary Vendor',
      unit_cost: item.unit_cost || 0,
      product_name: item.name,
      product_code: item.sku || '',
      pack_size: '',
      unit_of_measure: item.unit_of_measure,
      is_preferred: item.is_preferred || false,
    });
  }
  
  // Add purchase options
  purchaseOptions.forEach(opt => {
    // Filter by location if location_ids is specified
    if (opt.location_ids && !opt.location_ids.includes(selectedLocation)) {
      return;
    }
    allOptions.push(opt);
  });
  
  // For commissary items, add commissary option
  if (item.is_commissary_item && item.commissary_vendor_id && location?.type !== 'commissary') {
    const commissaryOption = allOptions.find(o => o.vendor_id === item.commissary_vendor_id);
    if (!commissaryOption) {
      allOptions.push({
        vendor_id: item.commissary_vendor_id,
        vendor_name: 'Commissary',
        unit_cost: item.commissary_price || 0,
        product_name: item.name,
        product_code: item.sku || '',
        pack_size: '',
        unit_of_measure: item.unit_of_measure,
        is_preferred: false,
      });
    }
  }
  
  if (allOptions.length <= 1) {
    return null;
  }
  
  const currentOption = allOptions.find(o => o.vendor_id === currentVendorId) || allOptions[0];
  const minPrice = Math.min(...allOptions.map(o => o.unit_cost));
  
  return (
    <div className="mt-2 border border-border rounded-lg overflow-hidden bg-background">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {allOptions.length - 1} other option{allOptions.length - 1 !== 1 ? 's' : ''}
          </span>
        </div>
        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      
      {isOpen && (
        <div className="border-t border-border divide-y divide-border max-h-48 overflow-y-auto">
          {allOptions.map((option) => {
            const isCurrent = option.vendor_id === currentVendorId;
            const isCheapest = option.unit_cost === minPrice;
            const priceDiff = option.unit_cost - currentOption.unit_cost;
            const isCurrentCheaper = priceDiff < 0;
            const isCurrentMoreExpensive = priceDiff > 0;
            
            return (
              <div
                key={option.vendor_id}
                className={`p-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                  isCurrent ? 'bg-primary/5' : 'hover:bg-muted/50'
                }`}
                onClick={() => {
                  onSelectVendor(option.vendor_id, option.unit_cost);
                  setIsOpen(false);
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium truncate">
                      {option.vendor_name || 'Unknown Vendor'}
                    </span>
                    {option.is_preferred && (
                      <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded">Preferred</span>
                    )}
                    {isCheapest && (
                      <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">Best Price</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      ${option.unit_cost.toFixed(2)} / {option.unit_of_measure}
                    </span>
                    {option.product_code && (
                      <span className="text-[10px] text-muted-foreground">{option.product_code}</span>
                    )}
                  </div>
                </div>
                
                <div className="text-right">
                  {!isCurrent && (
                    <div className={`text-xs font-medium ${
                      isCurrentCheaper ? 'text-green-600' : isCurrentMoreExpensive ? 'text-red-600' : 'text-muted-foreground'
                    }`}>
                      {priceDiff !== 0 && (
                        <span>
                          {priceDiff < 0 ? 'Save ' : 'Pay '}
                          ${Math.abs(priceDiff).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  {isCurrent && (
                    <span className="text-xs text-primary font-medium">Selected</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}