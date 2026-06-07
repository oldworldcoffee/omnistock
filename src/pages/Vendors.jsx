import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Pencil, Trash2, Truck, Warehouse, MapPin, Mail, Globe, ShoppingBag, ShoppingBasket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/layout/PageHeader';
import VendorLocationSettings from '@/components/vendors/VendorLocationSettings';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_OPTIONS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_DELIVERY_DAYS = DAYS.map(day => ({ day, enabled: false, cutoff_day: 'Sunday', cutoff_time: '5:00 PM' }));

const EMPTY = { name: '', order_type: 'email', contact_name: '', email: '', phone: '', address: '', notes: '', is_active: true, is_commissary: false, authorized_location_ids: [], location_settings: [], default_order_email: '', default_cc_email: '', default_min_order_type: 'none', default_min_order_value: null, default_delivery_days: DEFAULT_DELIVERY_DAYS };

const ORDER_TYPE_CONFIG = {
  email: { label: 'Email Order', icon: Mail, color: 'text-blue-600', bg: 'bg-blue-50', description: 'Orders are sent via email' },
  online: { label: 'Online Only', icon: Globe, color: 'text-purple-600', bg: 'bg-purple-50', description: 'Orders placed on vendor website' },
  instore: { label: 'In-Store', icon: ShoppingBasket, color: 'text-orange-600', bg: 'bg-orange-50', description: 'In-store grocery run with a checklist' },
  no_orders: { label: 'Not for Orders', icon: ShoppingBag, color: 'text-gray-500', bg: 'bg-gray-100', description: 'Receipt tracking only (e.g. grocery store)' },
};

export default function Vendors() {
  const { userPermission, canAccessLocation, companyId } = useAuth();
  const isAdmin = userPermission?.role === 'admin';
  const isManagerOrStaff = !isAdmin;
  const isMobile = useIsMobile();

  const [vendors, setVendors] = useState([]);
  const [locations, setLocations] = useState([]);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [activeTab, setActiveTab] = useState('General');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => Promise.all([
    base44.entities.Vendor.filter({ company_id: companyId }),
    base44.entities.Location.filter({ is_active: true, company_id: companyId }),
  ]).then(([v, locs]) => {
    setVendors(v);
    setLocations(locs);
    setLoading(false);
  });

  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ ...EMPTY, authorized_location_ids: locations.map(l => l.id) }); setActiveTab('General'); setDialog(true); };
  const openEdit = (v) => {
    setEditing(v);
    setForm({
      ...v,
      order_type: v.order_type || 'email',
      authorized_location_ids: v.authorized_location_ids?.length > 0 ? v.authorized_location_ids : locations.map(l => l.id),
      location_settings: v.location_settings || [],
      default_order_email: v.default_order_email || '',
      default_cc_email: v.default_cc_email || '',
      default_min_order_type: v.default_min_order_type || 'none',
      default_min_order_value: v.default_min_order_value ?? null,
      default_delivery_days: v.default_delivery_days?.length > 0 ? v.default_delivery_days : DEFAULT_DELIVERY_DAYS,
    });
    // Non-admins go straight to Location Settings
    setActiveTab(isManagerOrStaff ? 'Location Settings' : 'General');
    setDialog(true);
  };

  const save = async () => {
    setSaving(true);
    
    // Propagate general email/min-order updates to location settings (only if location hasn't been manually customized)
    if (editing && form.location_settings) {
      const oldDefaults = {
        order_email: editing.default_order_email || '',
        cc_email: editing.default_cc_email || '',
        min_order_type: editing.default_min_order_type || 'none',
        min_order_value: editing.default_min_order_value || null,
      };
      
      const updatedLocationSettings = form.location_settings.map(ls => {
        const existingSettings = editing.location_settings?.find(s => s.location_id === ls.location_id);
        
        // Check if location email matches OLD default (meaning it was inherited, not manually changed)
        const emailMatchesOldDefault = (existingSettings?.order_email || '') === (oldDefaults.order_email || '');
        const minOrderMatchesOldDefault = 
          (existingSettings?.min_order_type || 'none') === (oldDefaults.min_order_type || 'none') &&
          String(existingSettings?.min_order_value || '') === String(oldDefaults.min_order_value || '');
        
        // Auto-update only if location is still using the old defaults (not manually customized)
        if (emailMatchesOldDefault && minOrderMatchesOldDefault) {
          return {
            ...ls,
            order_email: form.default_order_email || '',
            cc_email: form.default_cc_email || '',
            min_order_type: form.default_min_order_type || 'none',
            min_order_value: form.default_min_order_value || null,
          };
        }
        return ls;
      });
      form.location_settings = updatedLocationSettings;
    }
    
    if (editing) await base44.entities.Vendor.update(editing.id, form);
    else await base44.entities.Vendor.create({ ...form, company_id: companyId });
    await load();
    setDialog(false);
    setSaving(false);
  };

  const remove = async (id) => {
    if (!confirm('Delete this vendor?')) return;
    await base44.entities.Vendor.delete(id);
    setVendors(prev => prev.filter(v => v.id !== id));
  };

  // Helper: get summary of location settings for a vendor card
  const getLocationSettingsSummary = (vendor) => {
    const ls = vendor.location_settings || [];
    const configured = ls.filter(s => s.order_email || s.min_order_type !== 'none' || s.delivery_days?.some(d => d.enabled));
    return configured.length;
  };

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Vendors"
        subtitle="External suppliers with per-location delivery schedules and order settings"
        actions={isAdmin && <Button onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add Vendor</Button>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : vendors.length === 0 ? (
          <div className="col-span-3 text-center text-muted-foreground py-8">No vendors yet. Add your first vendor.</div>
        ) : vendors.map(v => {
          const configuredCount = getLocationSettingsSummary(v);
          const otCfg = ORDER_TYPE_CONFIG[v.order_type || 'email'];
          const OtIcon = otCfg.icon;
          return (
            <div key={v.id} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${v.is_commissary ? 'bg-green-100' : 'bg-primary/10'}`}>
                    {v.is_commissary ? <Warehouse className="w-4 h-4 text-green-600" /> : <Truck className="w-4 h-4 text-primary" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm">{v.name}</p>
                      {v.is_commissary && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Commissary</span>}
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${otCfg.bg} ${otCfg.color}`}>
                        <OtIcon className="w-3 h-3" />{otCfg.label}
                      </span>
                    </div>
                    {v.contact_name && <p className="text-xs text-muted-foreground">{v.contact_name}</p>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)}><Pencil className="w-3.5 h-3.5" /></Button>
                  {isAdmin && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(v.id)}><Trash2 className="w-3.5 h-3.5" /></Button>}
                </div>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {v.email && <p>📧 {v.email}</p>}
                {v.phone && <p>📞 {v.phone}</p>}
                {v.address && <p>📍 {v.address}</p>}
                {v.authorized_location_ids?.length > 0 && v.authorized_location_ids.length < locations.length && (
                  <p className="flex items-center gap-1 text-amber-600 font-medium pt-1">
                    <MapPin className="w-3 h-3" />
                    {v.authorized_location_ids.length} of {locations.length} locations authorized
                  </p>
                )}
                {configuredCount > 0 && (
                  <p className="flex items-center gap-1 text-primary font-medium">
                    <MapPin className="w-3 h-3" />
                    {configuredCount} location{configuredCount > 1 ? 's' : ''} configured
                  </p>
                )}
                {v.notes && <p className="pt-1 border-t border-border text-foreground/60">{v.notes}</p>}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle></DialogHeader>

          {/* Tabs — admins see both, managers/staff see Location Settings only */}
          {isAdmin && (
            <div className="flex border-b border-border -mx-6 px-6 mb-2">
              {['General', 'Location Settings'].map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'General' && (
            <div className="space-y-3 py-2">
              <div><Label>Vendor Name *</Label><Input className="mt-1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>

              {/* Order Type */}
              <div>
                <Label>Order Type</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {Object.entries(ORDER_TYPE_CONFIG).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const selected = (form.order_type || 'email') === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, order_type: key }))}
                        className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 text-center transition-all ${selected ? `border-primary ${cfg.bg} ${cfg.color}` : 'border-border hover:border-muted-foreground/30 text-muted-foreground'}`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-xs font-medium leading-tight">{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{ORDER_TYPE_CONFIG[form.order_type || 'email'].description}</p>
              </div>

              <div><Label>Contact Name</Label><Input className="mt-1" value={form.contact_name || ''} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
              {form.order_type !== 'no_orders' && form.order_type !== 'instore' && (
                <div><Label>Email {form.order_type === 'email' ? '*' : ''}</Label><Input className="mt-1" type="email" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
              )}
              {form.order_type !== 'no_orders' && form.order_type !== 'instore' && (
                <div><Label>Phone</Label><Input className="mt-1" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
              )}
              <div><Label>Address</Label><Input className="mt-1" value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
              <div><Label>Notes</Label><Textarea className="mt-1 h-20" value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>

              {/* Default order settings — used as template for all locations */}
              {form.order_type !== 'no_orders' && form.order_type !== 'instore' && <div className="pt-2 border-t border-border space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Default Order Settings (template for all locations)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Default Order Email</Label>
                    <Input className="mt-1 h-8 text-sm" type="email" placeholder="orders@vendor.com" value={form.default_order_email || ''} onChange={e => setForm(f => ({ ...f, default_order_email: e.target.value }))} />
                  </div>
                  <div>
                    <Label className="text-xs">Default CC Email</Label>
                    <Input className="mt-1 h-8 text-sm" type="email" placeholder="cc@vendor.com" value={form.default_cc_email || ''} onChange={e => setForm(f => ({ ...f, default_cc_email: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Default Minimum Order</Label>
                  <div className="flex gap-2 mt-1 items-center">
                    <select
                      className="border border-input rounded-md px-2 py-1.5 text-sm bg-background"
                      value={form.default_min_order_type || 'none'}
                      onChange={e => setForm(f => ({ ...f, default_min_order_type: e.target.value }))}
                    >
                      <option value="none">No minimum</option>
                      <option value="dollar">Dollar amount ($)</option>
                      <option value="cases">Case count</option>
                    </select>
                    {form.default_min_order_type !== 'none' && (
                      <div className="flex items-center gap-1">
                        {form.default_min_order_type === 'dollar' && <span className="text-sm text-muted-foreground">$</span>}
                        <Input
                          type="number"
                          className="h-8 w-28 text-sm"
                          placeholder={form.default_min_order_type === 'dollar' ? '250' : '20'}
                          value={form.default_min_order_value || ''}
                          onChange={e => setForm(f => ({ ...f, default_min_order_value: e.target.value === '' ? null : parseFloat(e.target.value) }))}
                        />
                        {form.default_min_order_type === 'cases' && <span className="text-sm text-muted-foreground">cases</span>}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Each location inherits these defaults but can override them in the Location Settings tab.</p>
                </div>

                {/* Default Delivery Schedule */}
                <div>
                  <Label className="text-xs">Default Delivery Schedule</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">Set delivery days and cutoff times that all locations inherit by default.</p>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-4 gap-0 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <span>Delivery Day</span>
                      <span>Order By (Day)</span>
                      <span>Cut-off Time</span>
                      <span></span>
                    </div>
                    {(form.default_delivery_days || DEFAULT_DELIVERY_DAYS).map((dd, idx) => (
                      <div
                        key={dd.day}
                        className={`grid grid-cols-4 gap-0 items-center px-3 py-2 border-t border-border text-sm ${!dd.enabled ? 'opacity-50' : ''}`}
                      >
                        <label className="flex items-center gap-2 cursor-pointer font-medium">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 accent-primary"
                            checked={dd.enabled || false}
                            onChange={e => {
                              const days = [...(form.default_delivery_days || DEFAULT_DELIVERY_DAYS)];
                              days[idx] = { ...days[idx], enabled: e.target.checked };
                              setForm(f => ({ ...f, default_delivery_days: days }));
                            }}
                          />
                          {dd.day}
                        </label>
                        <select
                          className="border border-input rounded px-2 py-1 text-xs bg-background disabled:bg-muted"
                          disabled={!dd.enabled}
                          value={dd.cutoff_day || 'Sunday'}
                          onChange={e => {
                            const days = [...(form.default_delivery_days || DEFAULT_DELIVERY_DAYS)];
                            days[idx] = { ...days[idx], cutoff_day: e.target.value };
                            setForm(f => ({ ...f, default_delivery_days: days }));
                          }}
                        >
                          {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <Input
                          className="h-7 text-xs w-24"
                          disabled={!dd.enabled}
                          value={dd.cutoff_time || '5:00 PM'}
                          onChange={e => {
                            const days = [...(form.default_delivery_days || DEFAULT_DELIVERY_DAYS)];
                            days[idx] = { ...days[idx], cutoff_time: e.target.value };
                            setForm(f => ({ ...f, default_delivery_days: days }));
                          }}
                        />
                        <span />
                      </div>
                    ))}
                  </div>
                </div>
              </div>}

              {/* Authorized Locations */}
              <div className="pt-2 border-t border-border space-y-2">
                <div>
                  <Label className="text-sm font-medium">Authorized Locations (Buyers)</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Control which locations can order from this vendor. Uncheck locations to restrict access.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {locations.map(loc => {
                    const authorized = form.authorized_location_ids || [];
                    const isChecked = authorized.includes(loc.id);
                    return (
                      <label key={loc.id} className="flex items-center gap-2 cursor-pointer text-sm p-2 rounded-md hover:bg-muted/50 border border-border">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 accent-primary"
                          checked={isChecked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...authorized, loc.id]
                              : authorized.filter(id => id !== loc.id);
                            setForm(f => ({ ...f, authorized_location_ids: next }));
                          }}
                        />
                        <span>{loc.name}</span>
                      </label>
                    );
                  })}
                </div>
                {(form.authorized_location_ids || []).length === locations.length && (
                  <p className="text-xs text-muted-foreground italic">All locations are authorized.</p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-border">
                <input
                  type="checkbox"
                  id="is_commissary"
                  checked={form.is_commissary || false}
                  onChange={e => setForm(f => ({ ...f, is_commissary: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="is_commissary" className="text-sm font-medium cursor-pointer">
                  This vendor acts as a commissary (fulfills retail location orders)
                </Label>
              </div>
            </div>
          )}

          {(activeTab === 'Location Settings' || isManagerOrStaff) && (
            <div className="py-2">
              {(() => {
                const visibleLocations = isManagerOrStaff
                  ? locations.filter(l => canAccessLocation(l.id))
                  : locations;
                return visibleLocations.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No locations assigned. Contact your admin.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      Configure order email, minimum order requirements, and delivery schedule per location. These override global vendor settings when placing orders.
                    </p>
                    <VendorLocationSettings
                      locations={visibleLocations}
                      locationSettings={form.location_settings || []}
                      defaults={{
                        order_email: form.default_order_email || '',
                        cc_email: form.default_cc_email || '',
                        min_order_type: form.default_min_order_type || 'none',
                        min_order_value: form.default_min_order_value || '',
                        delivery_days: form.default_delivery_days || DEFAULT_DELIVERY_DAYS,
                      }}
                      onChange={(ls) => {
                        // Non-admins: merge their changes with existing settings for other locations
                        if (isManagerOrStaff) {
                          const otherLocSettings = (form.location_settings || []).filter(
                            s => !visibleLocations.find(l => l.id === s.location_id)
                          );
                          setForm(f => ({ ...f, location_settings: [...otherLocSettings, ...ls] }));
                        } else {
                          setForm(f => ({ ...f, location_settings: ls }));
                        }
                      }}
                    />
                  </>
                );
              })()}
            </div>
          )}

          <DialogFooter className="pt-2 border-t border-border mt-2">
            <Button variant="outline" onClick={() => setDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving...' : 'Save Vendor'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}