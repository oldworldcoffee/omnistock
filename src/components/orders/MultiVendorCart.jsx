import { useState } from 'react';
import { Search, ShoppingCart, RefreshCw, PackageOpen, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import VendorOptionSelector from './VendorOptionSelector';

export default function MultiVendorCart({
  locations, vendors, items, locInv,
  selectedLocation, selectedVendor,
  carts,
  onSelectLocation, onSelectVendor,
  onAddToCart, onUpdateQty, onRemove, onClearCart,
  onFillToPar, onCreateOrder, onCreateAllOrders,
}) {
  const getUnitCostForDisplay = (item, vendorId) => {
    const location = locations.find(l => l.id === selectedLocation);
    const vendor = vendors.find(v => v.id === vendorId);
    // Only use commissary price if:
    // 1. This is a commissary item
    // 2. The ordering location is NOT a commissary (i.e., it's a retail location)
    // 3. We're ordering from the item's commissary vendor
    if (item.is_commissary_item && 
        location?.type !== 'commissary' && 
        item.commissary_vendor_id === vendorId && 
        item.commissary_price) {
      return item.commissary_price;
    }
    // Otherwise use purchase option price (for commissary ordering from their suppliers)
    const preferred = (item.purchase_options || []).find(p => p.is_preferred && p.vendor_id === vendorId) || 
                     (item.purchase_options || []).find(p => p.vendor_id === vendorId);
    return preferred?.unit_cost || item.unit_cost || 0;
  };
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const getLocInv = (itemId) => locInv.find(l => l.location_id === selectedLocation && l.item_id === itemId);

  // Only show email-order vendors in this cart (not online, instore, or no_orders)
  const emailVendors = vendors.filter(v => !v.order_type || v.order_type === 'email');
  const emailVendorIds = new Set(emailVendors.map(v => v.id));

  const catalogItems = items.filter(item => {
    if (selectedVendor) {
      // For commissary items, show only when their commissary vendor is selected
      if (item.is_commissary_item && item.commissary_vendor_id) {
        if (item.commissary_vendor_id !== selectedVendor) return false;
      } else {
        // Regular items - check if they have this vendor in purchase options
        const hasVendor = item.vendor_id === selectedVendor ||
          (item.purchase_options || []).some(p => p.vendor_id === selectedVendor);
        if (!hasVendor) return false;
      }
    } else {
      // No vendor filter — only show items whose assigned vendor is email-type (or commissary)
      if (item.is_commissary_item && item.commissary_vendor_id) {
        // commissary items always shown
      } else {
        const preferred = (item.purchase_options || []).find(p => p.is_preferred) || (item.purchase_options || [])[0];
        const vendorId = preferred?.vendor_id || item.vendor_id;
        if (vendorId && !emailVendorIds.has(vendorId)) return false;
      }
    }
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !(item.category || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    return true;
  });

  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))];

  const getVendorName = (vendorId) => {
    if (!vendorId) return 'Unassigned';
    return vendors.find(v => v.id === vendorId)?.name || 'Unknown Vendor';
  };

  const canOrder = selectedLocation && Object.keys(carts).length > 0;

  return (
    <div className="flex gap-4 h-[calc(100vh-180px)]">
      {/* LEFT: Catalog */}
      <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
        {/* Filters bar */}
        <div className="p-4 border-b border-border bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Location *</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedLocation}
                onChange={e => onSelectLocation(e.target.value)}
              >
                <option value="">Select location...</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Vendor Filter (optional)</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedVendor}
                onChange={e => onSelectVendor(e.target.value)}
              >
                <option value="">All vendors</option>
                {emailVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder="Search items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onFillToPar(false)}
                disabled={!selectedLocation}
                className="gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Fill to Par
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onFillToPar(true)}
                disabled={!selectedLocation}
                className="gap-1.5 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Smart Fill
              </Button>
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Item grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {catalogItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <PackageOpen className="w-8 h-8 opacity-40" />
              <p className="text-sm">No items match your filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalogItems.filter(item => {
                const preferred = (item.purchase_options || []).find(p => p.is_preferred) || (item.purchase_options || [])[0];
                let vendorId = preferred?.vendor_id || item.vendor_id;
                // For commissary items, use commissary_vendor_id
                if (item.is_commissary_item && item.commissary_vendor_id) {
                  vendorId = item.commissary_vendor_id;
                }
                return vendorId !== null && vendorId !== undefined;
              }).map(item => {
                const li = getLocInv(item.id);
                const onHand = li?.on_hand_quantity ?? null;
                const par = li?.par_level ?? null;
                const preferred = (item.purchase_options || []).find(p => p.is_preferred) || (item.purchase_options || [])[0];
                let vendorId = preferred?.vendor_id || item.vendor_id;
                // For commissary items, use commissary_vendor_id
                if (item.is_commissary_item && item.commissary_vendor_id) {
                  vendorId = item.commissary_vendor_id;
                }
                const cost = getUnitCostForDisplay(item, vendorId);
                const vendorCart = vendorId ? (carts[vendorId] || []) : [];
                const inCart = vendorCart?.some(c => c.item_id === item.id);

                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3 flex flex-col gap-2 transition-all ${
                      inCart ? 'border-primary/50 bg-primary/5' : 'border-border bg-background hover:border-primary/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight truncate">{item.name}</p>
                        {item.category && <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">{getVendorName(vendorId)}</p>
                      </div>
                      {inCart && (
                        <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shrink-0">In cart</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>${cost.toFixed(2)} / {item.unit_of_measure}</span>
                      {selectedLocation && onHand !== null && (
                        <span className={onHand < (par || 0) ? 'text-orange-500 font-medium' : ''}>
                          {onHand} on hand {par ? `/ ${par} par` : ''}
                        </span>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant={inCart ? 'secondary' : 'default'}
                      className="w-full h-7 text-xs"
                      onClick={() => onAddToCart(item, vendorId)}
                    >
                      Add {inCart ? 'more' : 'to order'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Multi-vendor carts */}
      <div className="w-96 flex flex-col gap-3 overflow-y-auto">
        {Object.keys(carts).length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3 bg-card border border-border rounded-xl p-6">
            <ShoppingCart className="w-10 h-10 opacity-20" />
            <div className="text-center">
              <p className="text-sm font-medium">No orders yet</p>
              <p className="text-xs mt-1">Add items to create vendor-specific orders</p>
            </div>
          </div>
        ) : (
          Object.entries(carts || {}).filter(([vendorId]) => vendorId).map(([vendorId, vendorCart]) => {
            const itemsInCart = vendorCart.filter(c => c.qty > 0);
            const total = vendorCart.reduce((s, i) => s + i.total_cost, 0);
            
            return (
              <div key={vendorId} className="flex flex-col bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-3 border-b border-border bg-muted/30">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-sm">{getVendorName(vendorId)}</span>
                      {itemsInCart.length > 0 && (
                        <span className="bg-primary text-primary-foreground rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">
                          {itemsInCart.length}
                        </span>
                      )}
                    </div>
                    <button 
                      onClick={() => onClearCart(vendorId)} 
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto divide-y divide-border">
                  {itemsInCart.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No items</div>
                  ) : (
                    itemsInCart.map((item, idx) => {
                      const originalIdx = vendorCart.findIndex(c => c.item_id === item.item_id);
                      return (
                        <div key={item.item_id} className="p-2 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-tight truncate">{item.item_name}</p>
                              <p className="text-xs text-muted-foreground">${item.unit_cost.toFixed(2)} / {item.unit_of_measure}</p>
                            </div>
                            <button
                              onClick={() => onRemove(vendorId, originalIdx)}
                              className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                            >
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                              </svg>
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => onUpdateQty(vendorId, originalIdx, item.qty - 1)}
                                className="w-5 h-5 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors text-xs"
                              >
                                −
                              </button>
                              <span className="w-8 text-center text-xs">{item.qty}</span>
                              <button
                                onClick={() => onUpdateQty(vendorId, originalIdx, item.qty + 1)}
                                className="w-5 h-5 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors text-xs"
                              >
                                +
                              </button>
                            </div>
                            <span className="text-xs font-semibold text-primary">${item.total_cost.toFixed(2)}</span>
                          </div>

                          <VendorOptionSelector
                            item={items.find(i => i.id === item.item_id)}
                            currentVendorId={vendorId}
                            onSelectVendor={(newVendorId, newCost) => {
                              // Update cart item to use new vendor and cost
                              const cartItem = vendorCart[originalIdx];
                              if (cartItem) {
                                cartItem.vendor_id = newVendorId;
                                cartItem.unit_cost = newCost;
                                cartItem.total_cost = cartItem.qty * newCost;
                                // Trigger re-render by updating state
                                onRemove(vendorId, originalIdx);
                                onAddToCart({
                                  ...cartItem,
                                  vendor_id: newVendorId,
                                  unit_cost: newCost,
                                  total_cost: cartItem.qty * newCost,
                                }, newVendorId);
                              }
                            }}
                            locations={locations}
                            selectedLocation={selectedLocation}
                          />
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="p-3 border-t border-border bg-muted/30 space-y-2">
                  {/* Minimum order warning */}
                  {(() => {
                    const vendor = vendors.find(v => v.id === vendorId);
                    const locSettings = (vendor?.location_settings || []).find(s => s.location_id === selectedLocation);
                    const minType = locSettings?.min_order_type || vendor?.default_min_order_type || 'none';
                    const minValue = parseFloat(locSettings?.min_order_value || vendor?.default_min_order_value || 0);
                    if (minType === 'dollar' && minValue > 0 && total < minValue) {
                      const needed = (minValue - total).toFixed(2);
                      return (
                        <div className="text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-amber-800">
                          ⚠️ Add <strong>${needed}</strong> more to meet the ${minValue.toFixed(2)} minimum
                        </div>
                      );
                    }
                    if (minType === 'cases' && minValue > 0 && itemsInCart.length < minValue) {
                      const needed = minValue - itemsInCart.length;
                      return (
                        <div className="text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-amber-800">
                          ⚠️ Add <strong>{needed}</strong> more case{needed !== 1 ? 's' : ''} to meet the {minValue} case minimum
                        </div>
                      );
                    }
                    return null;
                  })()}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Total</span>
                    <span className="text-sm font-bold text-primary">${total.toFixed(2)}</span>
                  </div>
                  <Button
                    className="w-full h-8 text-xs"
                    disabled={!selectedLocation || itemsInCart.length === 0}
                    onClick={() => onCreateOrder(vendorId)}
                  >
                    Place Order
                  </Button>
                </div>
              </div>
            );
          })
        )}

        {Object.keys(carts).length > 1 && (
          <Button
            className="w-full"
            disabled={!selectedLocation}
            onClick={onCreateAllOrders}
          >
            Place All Orders (${Object.values(carts).reduce((s, cart) => s + cart.reduce((t, i) => t + i.total_cost, 0), 0).toFixed(2)})
          </Button>
        )}
      </div>
    </div>
  );
}