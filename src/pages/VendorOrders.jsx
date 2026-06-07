import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Plus, ShoppingCart, Send, Eye, Trash2, Search, PackageOpen, RefreshCw, Minus, ChevronRight, Sparkles, TrendingUp, Globe, ShoppingBasket } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';
import MultiVendorCart from '@/components/orders/MultiVendorCart';
import OrderHistory from '@/components/orders/OrderHistory';
import SmartFillDialog from '@/components/orders/SmartFillDialog';
import AIReviewDialog from '@/components/orders/AIReviewDialog';
import OnlineShoppingList from '@/components/orders/OnlineShoppingList';
import InStoreShoppingList from '@/components/orders/InStoreShoppingList';

export default function VendorOrders() {
  const { canAccessLocation, user, companyId } = useAuth();
  const [locations, setLocations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('history'); // 'history' | 'cart' | 'online'
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [carts, setCarts] = useState({}); // {vendorId: [{item, qty, unit_cost, ...}]}
  const [emailDialog, setEmailDialog] = useState(null);
  const [emailBody, setEmailBody] = useState('');
  const [emailDeliveryDate, setEmailDeliveryDate] = useState('');
  const [sending, setSending] = useState(false);
  const [viewDialog, setViewDialog] = useState(null);
  const [editDialog, setEditDialog] = useState(null);
  const [smartFillDialog, setSmartFillDialog] = useState(false);
  const [aiReviewDialog, setAiReviewDialog] = useState(false);
  const [pendingOrderItems, setPendingOrderItems] = useState(null);
  const [pendingVendorId, setPendingVendorId] = useState(null);
  const [pendingOrderType, setPendingOrderType] = useState('vendor');
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sendCancellationEmail, setSendCancellationEmail] = useState(false);

  const load = () => Promise.all([
    base44.entities.Location.filter({ is_active: true, company_id: companyId }),
    base44.entities.Vendor.filter({ is_active: true, company_id: companyId }),
    base44.entities.InventoryItem.filter({ is_active: true, company_id: companyId }),
    base44.entities.LocationInventory.filter({ company_id: companyId }),
    base44.entities.Order.filter({ company_id: companyId }, '-created_date', 50),
  ]).then(([locs, vends, itms, linv, ords]) => {
    const accessibleLocs = locs.filter(l => canAccessLocation(l.id));
    const accessibleLocIds = new Set(accessibleLocs.map(l => l.id));
    setLocations(accessibleLocs);
    setVendors(vends);
    setItems(itms);
    setLocInv(linv);
    setOrders(ords.filter(o => accessibleLocIds.has(o.location_id)));
    setLoading(false);
  });

  useEffect(() => { load(); }, []);

  const getLocInv = (itemId) => locInv.find(l => l.location_id === selectedLocation && l.item_id === itemId);

  const getVendorForItem = (item) => {
    if (selectedVendor) return selectedVendor;
    // If item is a commissary item, use the commissary vendor
    if (item.is_commissary_item && item.commissary_vendor_id) {
      return item.commissary_vendor_id;
    }
    const preferred = (item.purchase_options || []).find(p => p.is_preferred);
    return preferred?.vendor_id || item.vendor_id || null;
  };

  const getUnitCostForItem = (item, vendorId) => {
    // If ordering from commissary vendor, use commissary price
    const vendor = vendors.find(v => v.id === vendorId);
    if (vendor?.is_commissary && item.is_commissary_item) {
      return item.commissary_price || 0;
    }
    // Otherwise use regular vendor pricing
    const preferred = (item.purchase_options || []).find(p => p.vendor_id === vendorId && p.is_preferred) || 
                     (item.purchase_options || []).find(p => p.vendor_id === vendorId);
    return preferred?.unit_cost || item.unit_cost || 0;
  };

  const fillToPars = (useAI = false) => {
    if (!selectedLocation) return;
    
    if (useAI) {
      setSmartFillDialog(true);
      return;
    }
    
    const newCarts = { ...carts };
    
    items.forEach(item => {
      const vendorId = getVendorForItem(item);
      if (!vendorId) return;
      
      const li = getLocInv(item.id);
      const onHand = li?.on_hand_quantity || 0;
      const par = li?.par_level || 0;
      const needed = Math.max(0, par - onHand);
      
      if (needed > 0) {
        if (!newCarts[vendorId]) newCarts[vendorId] = [];
        const existing = newCarts[vendorId].findIndex(c => c.item_id === item.id);
        const unitCost = getUnitCostForItem(item, vendorId);
        
        if (existing >= 0) {
          newCarts[vendorId][existing] = { ...newCarts[vendorId][existing], qty: needed, total_cost: needed * unitCost };
        } else {
          newCarts[vendorId].push({
            item_id: item.id,
            item_name: item.name,
            category: item.category,
            unit_of_measure: item.unit_of_measure,
            unit_cost: unitCost,
            qty: needed,
            total_cost: needed * unitCost,
            on_hand: onHand,
            par_level: par,
          });
        }
      }
    });
    
    setCarts(Object.fromEntries(Object.entries(newCarts).filter(([_, cart]) => cart.filter(c => c.qty > 0).length > 0)));
  };

  const handleSmartFillConfirm = (results) => {
    // Use AI suggested pars instead of manual pars
    if (!selectedLocation) return;
    const newCarts = { ...carts };
    
    items.forEach(item => {
      const vendorId = getVendorForItem(item);
      if (!vendorId) return;
      
      const li = getLocInv(item.id);
      const onHand = li?.on_hand_quantity || 0;
      const aiPar = item.ai_suggested_par || 0;
      const needed = Math.max(0, aiPar - onHand);
      
      if (needed > 0) {
        if (!newCarts[vendorId]) newCarts[vendorId] = [];
        const existing = newCarts[vendorId].findIndex(c => c.item_id === item.id);
        const unitCost = getUnitCostForItem(item, vendorId);
        
        if (existing >= 0) {
          newCarts[vendorId][existing] = { ...newCarts[vendorId][existing], qty: needed, total_cost: needed * unitCost };
        } else {
          newCarts[vendorId].push({
            item_id: item.id,
            item_name: item.name,
            category: item.category,
            unit_of_measure: item.unit_of_measure,
            unit_cost: unitCost,
            qty: needed,
            total_cost: needed * unitCost,
            on_hand: onHand,
            par_level: aiPar,
          });
        }
      }
    });
    
    setCarts(Object.fromEntries(Object.entries(newCarts).filter(([_, cart]) => cart.filter(c => c.qty > 0).length > 0)));
  };

  const addToCart = (item, vendorId) => {
    const targetVendor = vendorId || getVendorForItem(item);
    if (!targetVendor) return;
    
    const newCarts = { ...carts };
    if (!newCarts[targetVendor]) newCarts[targetVendor] = [];
    
    const existing = newCarts[targetVendor].findIndex(c => c.item_id === item.id);
    const unitCost = getUnitCostForItem(item, targetVendor);
    const li = getLocInv(item.id);
    
    if (existing >= 0) {
      const newQty = newCarts[targetVendor][existing].qty + 1;
      newCarts[targetVendor][existing] = { ...newCarts[targetVendor][existing], qty: newQty, total_cost: newQty * unitCost };
    } else {
      newCarts[targetVendor].push({
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        unit_of_measure: item.unit_of_measure,
        unit_cost: unitCost,
        qty: 1,
        total_cost: unitCost,
        on_hand: li?.on_hand_quantity || 0,
        par_level: li?.par_level || 0,
        purchase_options: item.purchase_options || [],
      });
    }
    setCarts(newCarts);
  };

  const updateCartQty = (vendorId, idx, val) => {
    const qty = Math.max(0, parseFloat(val) || 0);
    const newCarts = { ...carts };
    if (!newCarts[vendorId]) return;
    newCarts[vendorId][idx] = { ...newCarts[vendorId][idx], qty, total_cost: qty * newCarts[vendorId][idx].unit_cost };
    setCarts(newCarts);
  };

  const removeFromCart = (vendorId, idx) => {
    const newCarts = { ...carts };
    if (!newCarts[vendorId]) return;
    newCarts[vendorId] = newCarts[vendorId].filter((_, i) => i !== idx);
    if (newCarts[vendorId].length === 0) delete newCarts[vendorId];
    setCarts(newCarts);
  };

  const clearCart = (vendorId) => {
    const newCarts = { ...carts };
    if (vendorId) {
      delete newCarts[vendorId];
    } else {
      Object.keys(newCarts).forEach(key => delete newCarts[key]);
    }
    setCarts(newCarts);
  };

  const editDraftOrder = (order) => {
    const vendorId = order.vendor_id;
    setCarts({
      [vendorId]: (order.items || []).map(i => ({
        item_id: i.item_id,
        item_name: i.item_name,
        category: i.category,
        unit_of_measure: i.unit_of_measure,
        unit_cost: i.unit_cost,
        qty: i.quantity_ordered,
        total_cost: i.total_cost,
        on_hand: 0,
        par_level: 0,
      }))
    });
    setSelectedLocation(order.location_id);
    setSelectedVendor(vendorId);
    setEditDialog(order);
  };

  const updateDraftOrder = async () => {
    const vendorId = editDialog.vendor_id;
    const vendorCart = carts[vendorId] || [];
    const orderItems = vendorCart.filter(i => i.qty > 0).map(i => ({
      item_id: i.item_id,
      item_name: i.item_name,
      unit_of_measure: i.unit_of_measure,
      quantity_ordered: i.qty,
      unit_cost: i.unit_cost,
      total_cost: i.total_cost,
    }));
    const totalAmount = vendorCart.reduce((s, i) => s + i.total_cost, 0);
    await base44.entities.Order.update(editDialog.id, {
      items: orderItems,
      total_amount: totalAmount,
    });
    await load();
    const newCarts = { ...carts };
    delete newCarts[vendorId];
    setCarts(newCarts);
    setEditDialog(null);
    setView('history');
  };

  const getCartTotal = (vendorId) => {
    const vendorCart = carts[vendorId] || [];
    return vendorCart.reduce((s, i) => s + i.total_cost, 0);
  };

  const getAllCartsTotal = () => {
    return Object.values(carts).reduce((total, vendorCart) => total + vendorCart.reduce((s, i) => s + i.total_cost, 0), 0);
  };

  const createOrder = async (vendorId) => {
    const vendorCart = carts[vendorId] || [];
    const orderItems = vendorCart.filter(i => i.qty > 0).map(i => ({
      item_id: i.item_id,
      item_name: i.item_name,
      unit_of_measure: i.unit_of_measure,
      quantity_ordered: i.qty,
      unit_cost: i.unit_cost,
      total_cost: i.total_cost,
    }));
    
    // Determine order type based on vendor
    const vendor = vendors.find(v => v.id === vendorId);
    const orderType = vendor?.is_commissary ? 'commissary' : 'vendor';
    
    // Trigger AI review before creating order
    setPendingOrderItems(orderItems);
    setPendingVendorId(vendorId);
    setPendingOrderType(orderType);
    setAiReviewDialog(true);
  };

  // Given a vendor and location, calculate the next expected delivery date based on cutoff rules.
  // delivery_days entries have: day (e.g. "Thursday"), cutoff_day (e.g. "Wednesday"), cutoff_time (e.g. "5:00 PM")
  const calcNextDeliveryDate = (vendor, locationId) => {
    if (!vendor) return '';
    const locSettings = (vendor.location_settings || []).find(s => s.location_id === locationId);
    const deliveryDays = locSettings?.delivery_days || vendor.default_delivery_days || vendor.delivery_days || [];
    const enabledDays = deliveryDays.filter(d => d.enabled && d.cutoff_day && d.cutoff_time);
    if (enabledDays.length === 0) return '';

    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const now = new Date();

    const parseCutoffTime = (timeStr) => {
      if (!timeStr) return null;
      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!match) return null;
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const ampm = (match[3] || '').toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return { h, m };
    };

    let bestDelivery = null;

    for (const entry of enabledDays) {
      const cutoffDayIdx = DAY_NAMES.indexOf(entry.cutoff_day);
      const deliveryDayIdx = DAY_NAMES.indexOf(entry.day);
      if (cutoffDayIdx === -1 || deliveryDayIdx === -1) continue;

      const cutoffTime = parseCutoffTime(entry.cutoff_time);
      if (!cutoffTime) continue;

      const todayIdx = now.getDay();

      // How many days until the next cutoff day (0 = today)
      let daysUntilCutoff = (cutoffDayIdx - todayIdx + 7) % 7;

      // If today IS the cutoff day, check if we're still before the cutoff time
      if (daysUntilCutoff === 0) {
        const cutoffDate = new Date(now);
        cutoffDate.setHours(cutoffTime.h, cutoffTime.m, 0, 0);
        if (now >= cutoffDate) {
          // Missed today's cutoff — next occurrence is in 7 days
          daysUntilCutoff = 7;
        }
      }

      // The actual cutoff date
      const cutoffDate = new Date(now);
      cutoffDate.setDate(now.getDate() + daysUntilCutoff);
      cutoffDate.setHours(0, 0, 0, 0);

      // Days from cutoff to delivery — if delivery is on or before cutoff weekday, it's the following week
      let daysBetween = (deliveryDayIdx - cutoffDayIdx + 7) % 7;
      if (daysBetween === 0) daysBetween = 7; // same day = next week

      const deliveryDate = new Date(cutoffDate);
      deliveryDate.setDate(cutoffDate.getDate() + daysBetween);

      if (!bestDelivery || deliveryDate < bestDelivery) {
        bestDelivery = deliveryDate;
      }
    }

    if (!bestDelivery) return '';
    return bestDelivery.toISOString().split('T')[0];
  };

  const handleAIReviewConfirm = async () => {
    // User confirmed AI review, proceed with order creation
    if (!pendingOrderItems || !pendingVendorId) return;
    
    const vendorCart = carts[pendingVendorId] || [];
    const totalAmount = vendorCart.reduce((s, i) => s + i.total_cost, 0);
    const order = await base44.entities.Order.create({
      company_id: companyId,
      type: pendingOrderType,
      status: pendingOrderType === 'commissary' ? 'sent' : 'draft',
      location_id: selectedLocation,
      vendor_id: pendingVendorId,
      items: pendingOrderItems,
      total_amount: totalAmount,
      order_number: `${pendingOrderType === 'commissary' ? 'CO' : 'VO'}-${Date.now().toString().slice(-6)}`,
    });
    await load();
    const newCarts = { ...carts };
    delete newCarts[pendingVendorId];
    setCarts(newCarts);
    
    // For commissary orders, create a CommissaryFulfillment record instead of sending email
    if (pendingOrderType === 'commissary') {
      const vendor = vendors.find(v => v.id === pendingVendorId);
      await base44.entities.CommissaryFulfillment.create({
        company_id: companyId,
        order_id: order.id,
        order_number: order.order_number,
        retail_location_id: selectedLocation,
        commissary_location_id: vendor.id,
        items: pendingOrderItems.map(i => ({
          item_id: i.item_id,
          item_name: i.item_name,
          unit_of_measure: i.unit_of_measure,
          quantity_ordered: i.quantity_ordered,
          quantity_fulfilled: i.quantity_ordered,
          unit_cost: i.unit_cost,
          total_cost: i.total_cost,
        })),
        status: 'pending',
        fulfillment_date: new Date().toISOString(),
      });
      toast.success('Commissary order placed! View it in the Commissary dashboard.');
      setView('history');
    } else {
      // For regular vendor orders, show email dialog
      const vendor = vendors.find(v => v.id === pendingVendorId);
      const loc = locations.find(l => l.id === selectedLocation);
      const autoDeliveryDate = calcNextDeliveryDate(vendor, selectedLocation);
      setEmailDeliveryDate(autoDeliveryDate);
      setEmailBody('');
      setEmailDialog({ order, vendor, loc, items: pendingOrderItems, totalAmount });
      setView('history');
    }
    
    // Clear pending state and close AI review dialog
    setPendingOrderItems(null);
    setPendingVendorId(null);
    setPendingOrderType('vendor');
    setAiReviewDialog(false);
  };

  const createAllOrders = async () => {
    for (const vendorId of Object.keys(carts)) {
      await createOrder(vendorId);
    }
    setView('history');
  };

  const buildEmailHtml = (type = 'new') => {
    const { order, vendor, loc, items: orderItems, totalAmount } = emailDialog;
    const sentAt = format(new Date(), 'MM/dd/yyyy, hh:mm aa');
    const deliveryLine = emailDeliveryDate
      ? `<p>Delivery date: <strong>${format(new Date(emailDeliveryDate + 'T12:00:00'), 'MM/dd/yyyy')}</strong></p>`
      : '';
    const notesPart = emailBody.trim() ? `<p><strong>Order comments:</strong> ${emailBody}</p>` : `<p><strong>Order comments:</strong> None</p>`;
    const rows = orderItems.map(i => `
      <tr>
        <td style="border:1px solid #ccc;padding:6px 10px;"></td>
        <td style="border:1px solid #ccc;padding:6px 10px;">${i.item_name}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${i.quantity_ordered}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;">${i.quantity_ordered} Total (${i.unit_of_measure})</td>
        <td style="border:1px solid #ccc;padding:6px 10px;">$${(i.unit_cost || 0).toFixed(2)}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;">$${(i.total_cost || 0).toFixed(2)}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;"></td>
      </tr>`).join('');

    if (type === 'cancellation') {
      return `
<p><strong>CANCELLATION NOTICE</strong></p>
<p>The following order from <strong>${loc?.name}</strong> to <strong>${vendor?.name}</strong> has been CANCELLED.</p>
<p><strong>Order number:</strong> ${order.order_number}</p>
<p><strong>Order cancelled on:</strong> ${sentAt}</p>
<p><strong>Cancelled by:</strong> ${user?.full_name || '—'}</p>
<br/>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Product Name</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:center;">Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Price</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr style="background:#f5f5f5;">
      <td colspan="4" style="border:1px solid #ccc;padding:6px 10px;text-align:right;font-weight:bold;">Sub Total:</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-weight:bold;">$${(totalAmount || 0).toFixed(2)}</td>
    </tr>
  </tfoot>
</table>
<br/>
${notesPart}
<br/>
<p>Customer details:<br/>
Phone: ${loc?.phone || '—'}<br/>
Address: ${loc?.address || '—'}</p>
      `.trim();
    }

    return `
<p>New <strong>Order</strong> from <strong>${loc?.business_name ? loc.business_name + ' - ' : ''}${loc?.name || '—'}</strong> to <strong>${vendor?.name}</strong>.</p>
${deliveryLine}
<p><strong>Order number:</strong> ${order.order_number}</p>
<p><strong>Order placed on:</strong> ${sentAt}</p>
<p><strong>Order placed by:</strong> ${user?.full_name || '—'} from <strong>${loc?.business_name ? loc.business_name + ' - ' : ''}${loc?.name || '—'}</strong></p>
<br/>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Product Code</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Product Name</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:center;">Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Price</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Comments</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<br/>
<p>Sub Total: <strong>$${(totalAmount || 0).toFixed(2)}</strong></p>
<br/>
${notesPart}
<br/>
<p>Customer details:<br/>
Phone: ${loc?.phone || '—'}<br/>
Address: ${loc?.address || '—'}</p>
<br/>
<p style="font-size:12px;color:#888;margin-top:16px;">
  <a href="TRACKING_PLACEHOLDER_CONFIRM" style="color:#2563eb;">✓ Click here to confirm order received</a>
</p>
<img src="TRACKING_PLACEHOLDER_PIXEL" width="1" height="1" style="display:none;" alt="" />
    `.trim();
  };

  const sendEmail = async () => {
    setSending(true);
    const htmlBody = buildEmailHtml();
    const vendor = emailDialog.vendor;

    // Fetch company logo
    const settings = await base44.entities.CompanySettings.list();
    const logoUrl = settings.length > 0 ? settings[0].logo_url : null;

    // Resolve to/cc emails: use location-specific settings if available, else vendor defaults
    const locSettings = (vendor.location_settings || []).find(s => s.location_id === emailDialog.loc?.id);
    const toEmail = locSettings?.order_email || vendor.default_order_email || vendor.email;
    const ccEmail = locSettings?.cc_email || vendor.default_cc_email || '';

    await base44.functions.invoke('sendVendorOrderEmail', {
      orderId: emailDialog.order.id,
      toEmail,
      ccEmail: ccEmail || undefined,
      subject: `Purchase Order — ${emailDialog.order.order_number}`,
      htmlBody,
      logoUrl,
    });

    await load();
    setEmailDialog(null);
    setSending(false);
    toast.success('Order email sent!');
  };

  const deleteOrder = async (sendCancellation = false) => {
    if (!deleteDialog) return;
    setDeleting(true);
    
    if (sendCancellation) {
      // Send cancellation email first
      const vendor = vendors.find(v => v.id === deleteDialog.vendor_id);
      const loc = locations.find(l => l.id === deleteDialog.location_id);
      const locSettings = (vendor?.location_settings || []).find(s => s.location_id === deleteDialog.location_id);
      const toEmail = locSettings?.order_email || vendor?.default_order_email || vendor?.email;
      const ccEmail = locSettings?.cc_email || vendor?.default_cc_email || '';
      
      // Build cancellation email HTML
      const items = deleteDialog.items || [];
      const totalAmount = deleteDialog.total_amount || 0;
      const cancelledAt = format(new Date(), 'MM/dd/yyyy, hh:mm aa');
      const rows = items.map(i => `
        <tr>
          <td style="border:1px solid #ccc;padding:6px 10px;">${i.item_name}</td>
          <td style="border:1px solid #ccc;padding:6px 10px;text-align:center;">${i.quantity_ordered}</td>
          <td style="border:1px solid #ccc;padding:6px 10px;">${i.quantity_ordered} Total (${i.unit_of_measure})</td>
          <td style="border:1px solid #ccc;padding:6px 10px;">$${(i.unit_cost || 0).toFixed(2)}</td>
          <td style="border:1px solid #ccc;padding:6px 10px;">$${(i.total_cost || 0).toFixed(2)}</td>
        </tr>`).join('');
      
      const htmlBody = `
<p><strong>CANCELLATION NOTICE</strong></p>
<p>The following order from <strong>${loc?.business_name ? loc.business_name + ' - ' : ''}${loc?.name}</strong> to <strong>${vendor?.name}</strong> has been CANCELLED.</p>
<p><strong>Order number:</strong> ${deleteDialog.order_number}</p>
<p><strong>Order cancelled on:</strong> ${cancelledAt}</p>
<p><strong>Cancelled by:</strong> ${user?.full_name || '—'}</p>
<br/>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Product Name</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:center;">Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total Qty</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Price</th>
      <th style="border:1px solid #ccc;padding:6px 10px;text-align:left;">Total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
  <tfoot>
    <tr style="background:#f5f5f5;">
      <td colspan="4" style="border:1px solid #ccc;padding:6px 10px;text-align:right;font-weight:bold;">Sub Total:</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-weight:bold;">$${(totalAmount || 0).toFixed(2)}</td>
    </tr>
  </tfoot>
</table>
<br/>
<p>Customer details:<br/>
Phone: ${loc?.phone || '—'}<br/>
Address: ${loc?.address || '—'}</p>
      `.trim();
      
      // Fetch company logo
      const settings = await base44.entities.CompanySettings.list();
      const logoUrl = settings.length > 0 ? settings[0].logo_url : null;
      
      await base44.functions.invoke('cancelVendorOrderEmail', {
        orderId: deleteDialog.id,
        toEmail,
        ccEmail: ccEmail || undefined,
        subject: `CANCELLED: Order ${deleteDialog.order_number}`,
        htmlBody,
        logoUrl,
      });
    }
    
    await base44.entities.Order.delete(deleteDialog.id);
    await load();
    setDeleteDialog(null);
    setDeleting(false);
    toast.success(sendCancellation ? 'Cancellation email sent and order deleted' : 'Order deleted');
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const vendorName = (id) => vendors.find(v => v.id === id)?.name || '—';

  const refreshOrders = async () => {
    const ords = await base44.entities.Order.list('-created_date', 50);
    const accessibleLocIds = new Set(locations.map(l => l.id));
    setOrders(ords.filter(o => accessibleLocIds.has(o.location_id)));
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Vendor Orders"
        subtitle="Browse items and place purchase orders"
        actions={
          <div className="flex gap-2">
            <Button variant={view === 'history' ? 'secondary' : 'outline'} onClick={() => setView('history')}>
              <Eye className="w-4 h-4 mr-1" />Order History
            </Button>
            {vendors.some(v => !v.order_type || v.order_type === 'email') && (
              <Button variant={view === 'cart' ? 'default' : 'outline'} onClick={() => setView('cart')}>
                <ShoppingCart className="w-4 h-4 mr-1" />
                Vendor Order
                {(() => { const count = Object.entries(carts).filter(([vid]) => { const v = vendors.find(v => v.id === vid); return !v?.order_type || v.order_type === 'email'; }).reduce((sum, [, cart]) => sum + cart.length, 0); return count > 0 ? <span className="ml-1 bg-white text-primary rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">{count}</span> : null; })()}
              </Button>
            )}
            {vendors.some(v => v.order_type === 'online') && (
              <Button variant={view === 'online' ? 'default' : 'outline'} onClick={() => setView('online')}>
                <Globe className="w-4 h-4 mr-1" />
                Online Order
                {(() => { const count = Object.entries(carts).filter(([vid]) => vendors.find(v => v.id === vid)?.order_type === 'online').reduce((sum, [, cart]) => sum + cart.length, 0); return count > 0 ? <span className="ml-1 bg-white text-primary rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">{count}</span> : null; })()}
              </Button>
            )}
            {vendors.some(v => v.order_type === 'instore') && (
              <Button variant={view === 'instore' ? 'default' : 'outline'} onClick={() => setView('instore')}>
                <ShoppingBasket className="w-4 h-4 mr-1" />
                In-Store
                {(() => { const count = Object.entries(carts).filter(([vid]) => vendors.find(v => v.id === vid)?.order_type === 'instore').reduce((sum, [, cart]) => sum + cart.length, 0); return count > 0 ? <span className="ml-1 bg-white text-primary rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">{count}</span> : null; })()}
              </Button>
            )}
          </div>
        }
      />

      {view === 'history' ? (
        <OrderHistory 
        orders={orders} 
        locName={locName} 
        vendorName={vendorName} 
        onView={async (order) => {
          const freshOrder = await base44.entities.Order.get(order.id);
          setViewDialog(freshOrder);
        }} 
        onEdit={editDraftOrder} 
        onDelete={setDeleteDialog} 
      />
      ) : view === 'online' ? (
        <OnlineShoppingList
          locations={locations}
          vendors={vendors}
          items={items}
          locInv={locInv}
          selectedLocation={selectedLocation}
          selectedVendor={selectedVendor}
          carts={Object.fromEntries(Object.entries(carts).filter(([vid]) => {
            const v = vendors.find(v => v.id === vid);
            return v?.order_type === 'online';
          }))}
          onSelectLocation={setSelectedLocation}
          onSelectVendor={setSelectedVendor}
          onAddToCart={addToCart}
          onUpdateQty={updateCartQty}
          onRemove={removeFromCart}
          onClearCart={clearCart}
          onFillToPar={fillToPars}
        />
      ) : view === 'instore' ? (
        <InStoreShoppingList
          vendors={vendors}
          carts={Object.fromEntries(Object.entries(carts).filter(([vid]) => {
            const v = vendors.find(v => v.id === vid);
            return v?.order_type === 'instore';
          }))}
          onUpdateQty={updateCartQty}
          onRemove={removeFromCart}
          onClearCart={clearCart}
        />
      ) : (
        <MultiVendorCart
          locations={locations}
          vendors={vendors}
          items={items}
          locInv={locInv}
          selectedLocation={selectedLocation}
          selectedVendor={selectedVendor}
          carts={carts}
          onSelectLocation={setSelectedLocation}
          onSelectVendor={setSelectedVendor}
          onAddToCart={addToCart}
          onUpdateQty={updateCartQty}
          onRemove={removeFromCart}
          onClearCart={clearCart}
          onFillToPar={fillToPars}
          onCreateOrder={createOrder}
          onCreateAllOrders={createAllOrders}
        />
      )}

      {/* Email Draft Dialog */}
      <Dialog open={!!emailDialog} onOpenChange={() => setEmailDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review & Send Order Email</DialogTitle></DialogHeader>
          {emailDialog && (
            <div className="space-y-3 py-2">
              <div className="bg-muted/50 rounded-lg px-3 py-2 text-sm">
                <span className="text-muted-foreground">To: </span>
                <span className="font-medium">{emailDialog.vendor?.email}</span>
              </div>

              {/* Minimum order warning */}
              {(() => {
                const vendor = emailDialog.vendor;
                const locSettings = (vendor?.location_settings || []).find(s => s.location_id === emailDialog.loc?.id);
                const minType = locSettings?.min_order_type || vendor?.default_min_order_type || 'none';
                const minValue = parseFloat(locSettings?.min_order_value || vendor?.default_min_order_value || 0);
                const total = emailDialog.totalAmount || 0;
                const cartItems = emailDialog.items || [];

                if (minType === 'dollar' && minValue > 0 && total < minValue) {
                  return (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm">
                      <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
                      <div>
                        <p className="font-medium text-amber-800">Below minimum order</p>
                        <p className="text-amber-700 text-xs mt-0.5">
                          This order is <strong>${total.toFixed(2)}</strong>, but {vendor?.name} requires a minimum of <strong>${minValue.toFixed(2)}</strong>. You can still send it, but the vendor may reject it.
                        </p>
                      </div>
                    </div>
                  );
                }
                if (minType === 'cases' && minValue > 0 && cartItems.length < minValue) {
                  return (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm">
                      <span className="text-amber-500 text-base leading-none mt-0.5">⚠️</span>
                      <div>
                        <p className="font-medium text-amber-800">Below minimum order</p>
                        <p className="text-amber-700 text-xs mt-0.5">
                          This order has <strong>{cartItems.length} case(s)</strong>, but {vendor?.name} requires a minimum of <strong>{minValue} cases</strong>. You can still send it, but the vendor may reject it.
                        </p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Order summary preview */}
              <div className="border border-border rounded-lg overflow-hidden text-sm">
                <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Order Items</div>
                <table className="w-full">
                  <thead className="bg-muted/20">
                    <tr>
                      {['Product Name', 'Qty', 'Unit Price', 'Total'].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(emailDialog.items || []).map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{item.item_name}</td>
                        <td className="px-3 py-2">{item.quantity_ordered} {item.unit_of_measure}</td>
                        <td className="px-3 py-2">${(item.unit_cost || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 font-medium">${(item.total_cost || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/20 border-t border-border">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-sm font-semibold text-right">Sub Total:</td>
                      <td className="px-3 py-2 font-bold">${(emailDialog.totalAmount || 0).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div>
                <Label>Expected Delivery Date</Label>
                <Input className="mt-1" type="date" value={emailDeliveryDate} onChange={e => setEmailDeliveryDate(e.target.value)} />
                {emailDeliveryDate && (
                  <p className="text-xs text-muted-foreground mt-1">Auto-calculated from vendor delivery schedule. You can adjust if needed.</p>
                )}
              </div>
              <div>
                <Label>Order Comments (optional)</Label>
                <Textarea className="mt-1 h-20 text-sm" placeholder="Any special instructions or comments..." value={emailBody} onChange={e => setEmailBody(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialog(null)}>Save as Draft</Button>
            <Button onClick={sendEmail} disabled={sending}>
              <Send className="w-4 h-4 mr-1" />{sending ? 'Sending...' : 'Send Email'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Order Dialog */}
      <Dialog open={!!viewDialog} onOpenChange={() => setViewDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Order {viewDialog?.order_number}</DialogTitle></DialogHeader>
          {viewDialog && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Location:</span> <span className="font-medium">{locName(viewDialog.location_id)}</span></div>
                <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{vendorName(viewDialog.vendor_id)}</span></div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewDialog.status} /></div>
                <div><span className="text-muted-foreground">Fulfilled:</span> <span className="font-bold text-green-600">${(viewDialog.items || []).reduce((sum, item) => sum + ((item.quantity_received || 0) * (item.unit_cost || 0)), 0).toFixed(2)}</span></div>
              </div>
              {viewDialog.notes && (
                <div className="border border-border rounded-lg p-3 bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{viewDialog.notes}</p>
                </div>
              )}
              {viewDialog.backstock_note && (
                <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
                  <p className="text-xs font-medium text-amber-800 mb-1">Backstock Note</p>
                  <p className="text-sm text-amber-900">{viewDialog.backstock_note}</p>
                </div>
              )}
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {['Item', 'Ordered', 'Received', 'UOM', 'Unit $', 'Total'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {viewDialog.items?.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{item.item_name}</td>
                        <td className="px-3 py-2">{item.quantity_ordered}</td>
                        <td className="px-3 py-2 font-medium text-green-600">{item.quantity_received || 0}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.unit_of_measure}</td>
                        <td className="px-3 py-2">${(item.unit_cost || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 font-medium">${(item.total_cost || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setViewDialog(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Draft Order Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Draft Order {editDialog?.order_number}</DialogTitle>
          </DialogHeader>
          {editDialog && (
            <MultiVendorCart
              locations={locations}
              vendors={vendors}
              items={items}
              locInv={locInv}
              selectedLocation={selectedLocation}
              selectedVendor={selectedVendor}
              carts={carts}
              onSelectLocation={setSelectedLocation}
              onSelectVendor={setSelectedVendor}
              onAddToCart={addToCart}
              onUpdateQty={updateCartQty}
              onRemove={removeFromCart}
              onClearCart={clearCart}
              onFillToPar={fillToPars}
              onCreateOrder={updateDraftOrder}
              onCreateAllOrders={updateDraftOrder}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { 
              if (editDialog?.vendor_id) {
                const newCarts = {...carts}; 
                delete newCarts[editDialog.vendor_id]; 
                setCarts(newCarts);
              }
              setEditDialog(null); 
            }}>Cancel</Button>
            <Button onClick={updateDraftOrder} disabled={!selectedLocation || (carts[editDialog?.vendor_id] || []).filter(c => c.qty > 0).length === 0}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Smart Fill Dialog */}
      <SmartFillDialog
        open={smartFillDialog}
        onOpenChange={setSmartFillDialog}
        locationId={selectedLocation}
        onConfirm={handleSmartFillConfirm}
      />

      {/* AI Review Dialog */}
      <AIReviewDialog
        open={aiReviewDialog}
        onOpenChange={setAiReviewDialog}
        orderItems={pendingOrderItems}
        locationId={selectedLocation}
        onConfirm={handleAIReviewConfirm}
      />

      {/* Delete Order Confirmation Dialog */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Order {deleteDialog?.order_number}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the order and all its items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              id="send-cancellation"
              className="h-4 w-4 rounded border-gray-300 accent-primary"
              onChange={(e) => setSendCancellationEmail(e.target.checked)}
            />
            <label htmlFor="send-cancellation" className="text-sm text-foreground cursor-pointer">
              Send cancellation email to vendor ({vendorName(deleteDialog?.vendor_id)})
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteOrder(sendCancellationEmail)} disabled={deleting}>
              <Trash2 className="w-4 h-4 mr-1" />{deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}