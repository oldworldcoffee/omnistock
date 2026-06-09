import React, { useState } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Search, ShoppingCart, RefreshCw, PackageOpen, Sparkles, ChevronRight, ChevronDown, X, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import VendorOptionSelector from './VendorOptionSelector';
import VariantSelectionDialog from './VariantSelectionDialog';

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

  // Include vendors that can receive orders: email, online, instore, AND commissary vendors (even if order_type is no_orders)
  // Also filter by authorized_location_ids if specified
  let orderableVendors = vendors.filter(v => v.is_active !== false && (v.order_type !== 'no_orders' || v.is_commissary));
  
  // Filter by authorized locations if selected location exists
  if (selectedLocation) {
    orderableVendors = orderableVendors.filter(v => {
      // If authorized_location_ids is null/empty, all locations can order
      if (!v.authorized_location_ids || v.authorized_location_ids.length === 0) {
        return true;
      }
      // Otherwise, location must be in the authorized list
      return v.authorized_location_ids.includes(selectedLocation);
    });
  }
  
  const orderableVendorIds = new Set(orderableVendors.map(v => v.id));

  // Group items by product_group_id
  const groupedCatalogItems = items.reduce((acc, item) => {
    const selectedLoc = locations.find(l => l.id === selectedLocation);
    const isCommissaryLocation = selectedLoc?.type === 'commissary';
    
    // Filter by selected vendor if one is chosen
    if (selectedVendor) {
      const hasVendor = item.vendor_id === selectedVendor ||
        (item.purchase_options || []).some(p => p.vendor_id === selectedVendor) ||
        (item.is_commissary_item && item.commissary_vendor_id === selectedVendor);
      if (!hasVendor) return acc;
    }
    
    // CRITICAL: Filter items based on location type
    if (selectedLocation && !isCommissaryLocation && item.is_commissary_item) {
      if (!item.commissary_vendor_id) return acc;
    }
    
    if (selectedLocation && isCommissaryLocation) {
      const commissaryVendor = vendors.find(v => v.commissioned_location_id === selectedLocation);
      if (commissaryVendor && item.is_commissary_item && item.commissary_vendor_id !== commissaryVendor.id) {
        return acc;
      }
    }
    
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !(item.category || '').toLowerCase().includes(search.toLowerCase())) return acc;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return acc;
    
    acc.push(item);
    return acc;
  }, []);

  // Group by product_group_id
  const itemsWithGroups = groupedCatalogItems.reduce((acc, item) => {
    if (item.product_group_id) {
      if (!acc.groups[item.product_group_id]) {
        acc.groups[item.product_group_id] = {
          group_id: item.product_group_id,
          name: item.name.split(' - ').slice(0, -1).join(' - ') || item.name,
          items: [],
        };
      }
      acc.groups[item.product_group_id].items.push(item);
    } else {
      acc.standalone.push(item);
    }
    return acc;
  }, { groups: {}, standalone: [] });



  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))];

  const getVendorName = (vendorId) => {
    if (!vendorId) return 'Unassigned';
    return vendors.find(v => v.id === vendorId)?.name || 'Unknown Vendor';
  };

  const isMobile = useIsMobile();
  const [expandedCarts, setExpandedCarts] = useState({});
  const [catalogCollapsed, setCatalogCollapsed] = useState(false);
  const canOrder = selectedLocation && Object.keys(carts).length > 0;

  const toggleCart = (vendorId) => setExpandedCarts(prev => ({ ...prev, [vendorId]: !prev[vendorId] }));

  const [variantDialog, setVariantDialog] = useState(null);
  const [pendingAddItem, setPendingAddItem] = useState(null);

  const handleAddToCart = (item) => {
    // Check if item has variants (is part of a group)
    const groupItems = itemsWithGroups.groups[item.product_group_id]?.items || [];
    if (groupItems.length > 1) {
      // Show variant selection dialog
      setPendingAddItem(item);
      setVariantDialog(itemsWithGroups.groups[item.product_group_id]);
    } else {
      // Direct add for standalone items or groups with 1 item
      onAddToCart(item, item.is_commissary_item && item.commissary_vendor_id ? item.commissary_vendor_id : ((item.purchase_options || []).find(p => p.is_preferred)?.vendor_id || item.vendor_id));
    }
  };

  const handleVariantConfirm = (selectedItems) => {
    if (!pendingAddItem) return;
    const vendorId = pendingAddItem.is_commissary_item && pendingAddItem.commissary_vendor_id 
      ? pendingAddItem.commissary_vendor_id 
      : ((pendingAddItem.purchase_options || []).find(p => p.is_preferred)?.vendor_id || pendingAddItem.vendor_id);
    
    // Add each variant sequentially with small delays to allow state updates
    selectedItems.forEach((selected, index) => {
      setTimeout(() => {
        const fullItem = items.find(i => i.id === selected.item_id);
        if (fullItem) {
          onAddToCart(fullItem, vendorId, selected.qty || 1);
        }
      }, index * 50);
    });
    
    setTimeout(() => {
      setVariantDialog(null);
      setPendingAddItem(null);
    }, selectedItems.length * 50 + 100);
  };

  // Shared cart panel renderer
  const renderCartPanels = (collapsed = false) => {
    if (Object.keys(carts).length === 0) return null;
    return (
      <div className={collapsed ? "space-y-2" : "w-96 flex flex-col gap-3 overflow-y-auto"}>
        {Object.entries(carts || {}).filter(([vendorId]) => vendorId).map(([vendorId, vendorCart]) => {
          const itemsInCart = vendorCart.filter(c => c.qty > 0);
          const total = vendorCart.reduce((s, i) => s + i.total_cost, 0);
          const isExpanded = !collapsed || expandedCarts[vendorId];

          return (
            <div key={vendorId} className="flex flex-col bg-card border border-border rounded-xl overflow-hidden">
              <button
                className="p-3 border-b border-border bg-muted/30 w-full text-left"
                onClick={() => collapsed && toggleCart(vendorId)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-sm">{getVendorName(vendorId)}</span>
                    {itemsInCart.length > 0 && (
                      <span className="bg-primary text-primary-foreground rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">{itemsInCart.length}</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-1">${total.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {collapsed && <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                    <button onClick={(e) => { e.stopPropagation(); onClearCart(vendorId); }} className="text-xs text-muted-foreground hover:text-destructive transition-colors">Clear</button>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <>
                  <div className="max-h-48 overflow-y-auto divide-y divide-border">
                    {itemsInCart.length === 0 ? (
                      <div className="p-4 text-center text-xs text-muted-foreground">No items</div>
                    ) : itemsInCart.map((item) => {
                      const originalIdx = vendorCart.findIndex(c => c.item_id === item.item_id);
                      return (
                        <div key={item.item_id} className="p-2 flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-tight truncate">{item.item_name}</p>
                              <p className="text-xs text-muted-foreground">${item.unit_cost.toFixed(2)} / {item.unit_of_measure}</p>
                            </div>
                            <button onClick={() => onRemove(vendorId, originalIdx)} className="text-muted-foreground hover:text-destructive transition-colors p-0.5">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-0.5">
                              <button onClick={() => onUpdateQty(vendorId, originalIdx, item.qty - 1)} className="w-5 h-5 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors text-xs">−</button>
                              <span className="w-8 text-center text-xs">{item.qty}</span>
                              <button onClick={() => onUpdateQty(vendorId, originalIdx, item.qty + 1)} className="w-5 h-5 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors text-xs">+</button>
                            </div>
                            <span className="text-xs font-semibold text-primary">${item.total_cost.toFixed(2)}</span>
                          </div>
                          <VendorOptionSelector
                            item={items.find(i => i.id === item.item_id)}
                            currentVendorId={vendorId}
                            onSelectVendor={(newVendorId, newCost) => {
                              const cartItem = vendorCart[originalIdx];
                              if (cartItem) {
                                onRemove(vendorId, originalIdx);
                                onAddToCart({ ...cartItem, vendor_id: newVendorId, unit_cost: newCost, total_cost: cartItem.qty * newCost }, newVendorId);
                              }
                            }}
                            locations={locations}
                            selectedLocation={selectedLocation}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="p-3 border-t border-border bg-muted/30 space-y-2">
                    {(() => {
                      const vendor = vendors.find(v => v.id === vendorId);
                      const locSettings = (vendor?.location_settings || []).find(s => s.location_id === selectedLocation);
                      const minType = locSettings?.min_order_type || vendor?.default_min_order_type || 'none';
                      const minValue = parseFloat(locSettings?.min_order_value || vendor?.default_min_order_value || 0);
                      if (minType === 'dollar' && minValue > 0 && total < minValue) {
                        return <div className="text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-amber-800">⚠️ Add <strong>${(minValue - total).toFixed(2)}</strong> more to meet the ${minValue.toFixed(2)} minimum</div>;
                      }
                      if (minType === 'cases' && minValue > 0 && itemsInCart.length < minValue) {
                        return <div className="text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 text-amber-800">⚠️ Add <strong>{minValue - itemsInCart.length}</strong> more case(s) to meet minimum</div>;
                      }
                      return null;
                    })()}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Total</span>
                      <span className="text-sm font-bold text-primary">${total.toFixed(2)}</span>
                    </div>
                    <Button className="w-full h-8 text-xs" disabled={!selectedLocation || itemsInCart.length === 0} onClick={() => onCreateOrder(vendorId)}>Place Order</Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {Object.keys(carts).length > 1 && (
          <Button className="w-full" disabled={!selectedLocation} onClick={onCreateAllOrders}>
            Place All Orders (${Object.values(carts).reduce((s, cart) => s + cart.reduce((t, i) => t + i.total_cost, 0), 0).toFixed(2)})
          </Button>
        )}
      </div>
    );
  };

  if (isMobile) {
    return (
      <div className="flex flex-col gap-4">
        {/* Catalog */}
        <div className="flex flex-col bg-card border border-border rounded-xl overflow-hidden">
          {/* Filters */}
          <div className="p-3 border-b border-border bg-muted/30 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Catalog</span>
              <button
                onClick={() => setCatalogCollapsed(c => !c)}
                className="flex items-center gap-1 text-xs text-primary font-medium"
              >
                {catalogCollapsed ? <><ChevronDown className="w-3.5 h-3.5" /> Show</> : <><ChevronDown className="w-3.5 h-3.5 rotate-180" /> Hide</>}
              </button>
            </div>
            {!catalogCollapsed && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Location *</Label>
                  <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={selectedLocation} onChange={e => onSelectLocation(e.target.value)}>
                    <option value="">Select location...</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Vendor (optional)</Label>
                  <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={selectedVendor} onChange={e => onSelectVendor(e.target.value)}>
                    <option value="">All vendors</option>
                    {orderableVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
              </div>
            )}
            {!catalogCollapsed && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input className="pl-8 h-8 text-sm" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <Button variant="outline" size="sm" onClick={() => onFillToPar(false)} disabled={!selectedLocation} className="gap-1 whitespace-nowrap">
                  <RefreshCw className="w-3.5 h-3.5" />Fill
                </Button>
                <Button variant="outline" size="sm" onClick={() => onFillToPar(true)} disabled={!selectedLocation} className="gap-1 whitespace-nowrap">
                  <Sparkles className="w-3.5 h-3.5" />Smart
                </Button>
              </div>
            )}
            {!catalogCollapsed && (
              <div className="flex gap-1.5 flex-wrap">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${categoryFilter === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                    {cat === 'all' ? 'All' : cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Item grid */}
          {!catalogCollapsed && <div className="p-3">
            {Object.keys(itemsWithGroups.groups).length === 0 && itemsWithGroups.standalone.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                <PackageOpen className="w-8 h-8 opacity-40" />
                <p className="text-sm">No items match your filters</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {Object.values(itemsWithGroups.groups).map(group => {
                  const firstItem = group.items[0];
                  const selectedLoc = locations.find(l => l.id === selectedLocation);
                  const isCommissaryLocation = selectedLoc?.type === 'commissary';
                  const vendorId = isCommissaryLocation
                    ? ((firstItem.purchase_options || []).find(p => p.is_preferred)?.vendor_id || firstItem.vendor_id)
                    : (firstItem.is_commissary_item && firstItem.commissary_vendor_id ? firstItem.commissary_vendor_id : ((firstItem.purchase_options || []).find(p => p.is_preferred)?.vendor_id || firstItem.vendor_id));
                  if (!vendorId) return null;
                  const li = getLocInv(firstItem.id);
                  const onHand = li?.on_hand_quantity ?? null;
                  const par = li?.par_level ?? null;
                  const cost = getUnitCostForDisplay(firstItem, vendorId);
                  const inCart = (carts[vendorId] || []).some(c => group.items.some(gi => gi.id === c.item_id));
                  return (
                    <div key={group.group_id} className={`rounded-lg border p-2.5 flex flex-col gap-1.5 ${inCart ? 'border-primary/50 bg-primary/5' : 'border-border bg-background'}`}>
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-medium leading-tight flex-1">{group.name}</p>
                        {inCart && <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shrink-0">✓</span>}
                      </div>
                      <p className="text-[10px] text-muted-foreground">{group.items.length} variants · ${cost.toFixed(2)}</p>
                      {selectedLocation && onHand !== null && (
                        <p className={`text-[10px] ${onHand < (par || 0) ? 'text-orange-500 font-medium' : 'text-muted-foreground'}`}>{onHand} on hand{par ? ` / ${par} par` : ''}</p>
                      )}
                      <Button size="sm" variant={inCart ? 'secondary' : 'default'} className="w-full h-7 text-xs mt-auto" onClick={() => handleAddToCart(firstItem)}>
                        {inCart ? 'Add more' : 'Add'}
                      </Button>
                    </div>
                  );
                })}
                {itemsWithGroups.standalone.map(item => {
                  const selectedLoc = locations.find(l => l.id === selectedLocation);
                  const isCommissaryLocation = selectedLoc?.type === 'commissary';
                  const vendorId = isCommissaryLocation
                    ? ((item.purchase_options || []).find(p => p.is_preferred)?.vendor_id || item.vendor_id)
                    : (item.is_commissary_item && item.commissary_vendor_id ? item.commissary_vendor_id : ((item.purchase_options || []).find(p => p.is_preferred)?.vendor_id || item.vendor_id));
                  if (!vendorId) return null;
                  const li = getLocInv(item.id);
                  const onHand = li?.on_hand_quantity ?? null;
                  const par = li?.par_level ?? null;
                  const cost = getUnitCostForDisplay(item, vendorId);
                  const inCart = (carts[vendorId] || []).some(c => c.item_id === item.id);
                  return (
                    <div key={item.id} className={`rounded-lg border p-2.5 flex flex-col gap-1.5 ${inCart ? 'border-primary/50 bg-primary/5' : 'border-border bg-background'}`}>
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-medium leading-tight flex-1">{item.name}</p>
                        {inCart && <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shrink-0">✓</span>}
                      </div>
                      <p className="text-[10px] text-muted-foreground">${cost.toFixed(2)} / {item.unit_of_measure}</p>
                      {selectedLocation && onHand !== null && (
                        <p className={`text-[10px] ${onHand < (par || 0) ? 'text-orange-500 font-medium' : 'text-muted-foreground'}`}>{onHand} on hand{par ? ` / ${par} par` : ''}</p>
                      )}
                      <Button size="sm" variant={inCart ? 'secondary' : 'default'} className="w-full h-7 text-xs mt-auto" onClick={() => handleAddToCart(item)}>
                        {inCart ? 'Add more' : 'Add'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>}
        </div>

        {/* Carts — collapsed by default on mobile */}
        {Object.keys(carts).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Your Orders</p>
            {renderCartPanels(true)}
          </div>
        )}

        <VariantSelectionDialog
          open={!!variantDialog}
          onOpenChange={(open) => { if (!open) { setVariantDialog(null); setPendingAddItem(null); } }}
          group={variantDialog}
          items={variantDialog?.items || []}
          onConfirm={handleVariantConfirm}
        />
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-180px)]">
      {/* LEFT: Catalog */}
      <div className={`flex flex-col bg-card border border-border rounded-xl overflow-hidden transition-all ${catalogCollapsed ? 'w-12' : 'flex-1'}`}>
        {/* Filters bar */}
        <div className="p-4 border-b border-border bg-muted/30 space-y-3">
          <div className="flex items-center justify-between mb-1">
            {!catalogCollapsed && <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Catalog</span>}
            <button
              onClick={() => setCatalogCollapsed(c => !c)}
              className="flex items-center gap-1 text-xs text-primary font-medium ml-auto"
              title={catalogCollapsed ? 'Expand catalog' : 'Collapse catalog'}
            >
              {catalogCollapsed ? <ChevronRight className="w-4 h-4" /> : <><ChevronDown className="w-3.5 h-3.5 rotate-180" />Hide</>}
            </button>
          </div>
          {!catalogCollapsed && <div className="grid grid-cols-2 gap-3">
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
                {orderableVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>}
          {!catalogCollapsed && <div className="flex gap-2">
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
          </div>}
          {!catalogCollapsed && <div className="flex gap-1.5 flex-wrap">
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
          </div>}

        </div>

        {/* Item grid */}
        {!catalogCollapsed && <div className="flex-1 overflow-y-auto p-4">
          {Object.keys(itemsWithGroups.groups).length === 0 && itemsWithGroups.standalone.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <PackageOpen className="w-8 h-8 opacity-40" />
              <p className="text-sm">No items match your filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Render grouped items */}
              {Object.values(itemsWithGroups.groups).map(group => {
                const firstItem = group.items[0];
                const selectedLoc = locations.find(l => l.id === selectedLocation);
                const isCommissaryLocation = selectedLoc?.type === 'commissary';
                
                let vendorId;
                if (isCommissaryLocation) {
                  vendorId = (firstItem.purchase_options || []).find(p => p.is_preferred)?.vendor_id || firstItem.vendor_id;
                } else {
                  vendorId = firstItem.is_commissary_item && firstItem.commissary_vendor_id 
                    ? firstItem.commissary_vendor_id 
                    : ((firstItem.purchase_options || []).find(p => p.is_preferred)?.vendor_id || firstItem.vendor_id);
                }
                
                if (!vendorId) return null;
                
                const li = getLocInv(firstItem.id);
                const onHand = li?.on_hand_quantity ?? null;
                const par = li?.par_level ?? null;
                const cost = getUnitCostForDisplay(firstItem, vendorId);
                
                // Check if any variant is in cart
                const vendorCart = vendorId ? (carts[vendorId] || []) : [];
                const inCart = vendorCart?.some(c => group.items.some(gi => gi.id === c.item_id));

                return (
                  <div
                    key={group.group_id}
                    className={`rounded-lg border p-3 flex flex-col gap-2 transition-all ${
                      inCart ? 'border-primary/50 bg-primary/5' : 'border-border bg-background hover:border-primary/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight truncate">{group.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{group.items.length} variants</p>
                        {firstItem.category && <p className="text-xs text-muted-foreground mt-0.5">{firstItem.category}</p>}
                        <p className="text-xs text-muted-foreground mt-0.5">{getVendorName(vendorId)}</p>
                      </div>
                      {inCart && (
                        <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shrink-0">In cart</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span>${cost.toFixed(2)} / {firstItem.unit_of_measure}</span>
                      {selectedLocation && onHand !== null && (
                        <span className={onHand < (par || 0) ? 'text-orange-500 font-medium' : ''}>
                          {onHand} on hand {par ? `/ ${par} par` : ''}
                        </span>
                      )}
                      {group.items.length > 1 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {group.items.map(v => {
                            const vli = getLocInv(v.id);
                            const vOnHand = vli?.on_hand_quantity ?? 0;
                            return (
                              <span key={v.id} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                                {v.variant_name || v.name}: {vOnHand}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant={inCart ? 'secondary' : 'default'}
                      className="w-full h-7 text-xs"
                      onClick={() => handleAddToCart(firstItem)}
                    >
                      Add {inCart ? 'more' : 'to order'}
                    </Button>
                  </div>
                );
              })}

              {/* Render standalone items */}
              {itemsWithGroups.standalone.map(item => {
                const selectedLoc = locations.find(l => l.id === selectedLocation);
                const isCommissaryLocation = selectedLoc?.type === 'commissary';

                let vendorId;
                if (isCommissaryLocation) {
                  vendorId = (item.purchase_options || []).find(p => p.is_preferred)?.vendor_id || item.vendor_id;
                } else {
                  vendorId = item.is_commissary_item && item.commissary_vendor_id 
                    ? item.commissary_vendor_id 
                    : ((item.purchase_options || []).find(p => p.is_preferred)?.vendor_id || item.vendor_id);
                }
                
                if (!vendorId) return null;
                
                const li = getLocInv(item.id);
                const onHand = li?.on_hand_quantity ?? null;
                const par = li?.par_level ?? null;
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
                      onClick={() => handleAddToCart(item)}
                    >
                      Add {inCart ? 'more' : 'to order'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>}
      </div>

      {/* RIGHT: Multi-vendor carts */}
      {Object.keys(carts).length === 0 ? (
        <div className="w-96 flex-col items-center justify-center text-muted-foreground gap-3 bg-card border border-border rounded-xl p-6 flex">
          <ShoppingCart className="w-10 h-10 opacity-20" />
          <div className="text-center">
            <p className="text-sm font-medium">No orders yet</p>
            <p className="text-xs mt-1">Add items to create vendor-specific orders</p>
          </div>
        </div>
      ) : renderCartPanels(false)}

      {/* Variant Selection Dialog */}
      <VariantSelectionDialog
        open={!!variantDialog}
        onOpenChange={(open) => { if (!open) { setVariantDialog(null); setPendingAddItem(null); } }}
        group={variantDialog}
        items={variantDialog?.items || []}
        onConfirm={handleVariantConfirm}
      />
    </div>
  );
}