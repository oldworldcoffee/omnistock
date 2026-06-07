import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_OPTIONS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function defaultLocationSetting(locationId, defaultDeliveryDays) {
  return {
    location_id: locationId,
    order_email: '',
    cc_email: '',
    min_order_type: 'none',
    min_order_value: '',
    delivery_days: defaultDeliveryDays || DAYS.map(day => ({
      day,
      enabled: false,
      cutoff_day: DAY_OPTIONS[0],
      cutoff_time: '5:00 PM',
    })),
  };
}

export default function VendorLocationSettings({ locations, locationSettings = [], defaults = {}, onChange }) {
  const defaultDeliveryDays = defaults.delivery_days?.length > 0
    ? defaults.delivery_days
    : DAYS.map(day => ({ day, enabled: false, cutoff_day: 'Sunday', cutoff_time: '5:00 PM' }));
  const [openLocation, setOpenLocation] = useState(null);

  const getSettings = (locationId) => {
    const existing = locationSettings.find(s => s.location_id === locationId);
    if (existing) return existing;
    // Pre-populate from defaults
    return {
      ...defaultLocationSetting(locationId, defaultDeliveryDays),
      order_email: defaults.order_email || '',
      cc_email: defaults.cc_email || '',
      min_order_type: defaults.min_order_type || 'none',
      min_order_value: defaults.min_order_value || '',
    };
  };

  const updateSettings = (locationId, updates) => {
    const current = getSettings(locationId);
    const updated = { ...current, ...updates };
    const rest = locationSettings.filter(s => s.location_id !== locationId);
    onChange([...rest, updated]);
  };

  const updateDeliveryDay = (locationId, dayIndex, field, value) => {
    const current = getSettings(locationId);
    const days = [...(current.delivery_days || DAYS.map(day => ({ day, enabled: false, cutoff_day: 'Sunday', cutoff_time: '5:00 PM' })))];
    days[dayIndex] = { ...days[dayIndex], [field]: value };
    updateSettings(locationId, { delivery_days: days });
  };

  const resetToDefaults = (locationId) => {
    const current = getSettings(locationId);
    const updated = {
      ...current,
      order_email: defaults.order_email || '',
      cc_email: defaults.cc_email || '',
      min_order_type: defaults.min_order_type || 'none',
      min_order_value: defaults.min_order_value || '',
    };
    const rest = locationSettings.filter(s => s.location_id !== locationId);
    onChange([...rest, updated]);
  };

  const isUsingDefaults = (settings) => {
    return (
      (settings.order_email || '') === (defaults.order_email || '') &&
      (settings.cc_email || '') === (defaults.cc_email || '') &&
      (settings.min_order_type || 'none') === (defaults.min_order_type || 'none') &&
      String(settings.min_order_value || '') === String(defaults.min_order_value || '')
    );
  };

  return (
    <div className="space-y-2">
      {locations.map(loc => {
        const settings = getSettings(loc.id);
        const isOpen = openLocation === loc.id;
        const usingDefaults = isUsingDefaults(settings);
        const hasSettings = locationSettings.some(s => s.location_id === loc.id && (s.order_email || s.min_order_type !== 'none' || s.delivery_days?.some(d => d.enabled)));

        return (
          <div key={loc.id} className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-sm font-medium"
              onClick={() => setOpenLocation(isOpen ? null : loc.id)}
            >
              <span className="flex items-center gap-2">
                {loc.name}
                {usingDefaults && (defaults.order_email || defaults.min_order_type !== 'none')
                  ? <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Using defaults</span>
                  : hasSettings
                    ? <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Overridden</span>
                    : null}
              </span>
              {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pt-3 space-y-4 bg-background">
                {/* Reset to defaults */}
                {!usingDefaults && (defaults.order_email || defaults.min_order_type !== 'none') && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                    <span>This location has custom email/min-order settings.</span>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-primary hover:underline font-medium"
                      onClick={() => resetToDefaults(loc.id)}
                    >
                      <RotateCcw className="w-3 h-3" /> Reset to defaults
                    </button>
                  </div>
                )}
                {/* Order Emails */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Order Email</Label>
                    <Input
                      className="mt-1 h-8 text-sm"
                      type="email"
                      placeholder={defaults.order_email || 'vendor@example.com'}
                      value={settings.order_email || ''}
                      onChange={e => updateSettings(loc.id, { order_email: e.target.value })}
                    />
                    {defaults.order_email && !settings.order_email && <p className="text-xs text-muted-foreground mt-0.5">Default: {defaults.order_email}</p>}
                  </div>
                  <div>
                    <Label className="text-xs">CC Email</Label>
                    <Input
                      className="mt-1 h-8 text-sm"
                      type="email"
                      placeholder={defaults.cc_email || 'cc@example.com'}
                      value={settings.cc_email || ''}
                      onChange={e => updateSettings(loc.id, { cc_email: e.target.value })}
                    />
                    {defaults.cc_email && !settings.cc_email && <p className="text-xs text-muted-foreground mt-0.5">Default: {defaults.cc_email}</p>}
                  </div>
                </div>

                {/* Minimum Order */}
                <div>
                  <Label className="text-xs">Minimum Order</Label>
                  <div className="flex gap-2 mt-1 items-center">
                    <select
                      className="border border-input rounded-md px-2 py-1.5 text-sm bg-background"
                      value={settings.min_order_type || 'none'}
                      onChange={e => updateSettings(loc.id, { min_order_type: e.target.value })}
                    >
                      <option value="none">No minimum</option>
                      <option value="dollar">Dollar amount ($)</option>
                      <option value="cases">Case count</option>
                    </select>
                    {settings.min_order_type !== 'none' && (
                      <div className="flex items-center gap-1">
                        {settings.min_order_type === 'dollar' && <span className="text-sm text-muted-foreground">$</span>}
                        <Input
                          type="number"
                          className="h-8 w-28 text-sm"
                          placeholder={settings.min_order_type === 'dollar' ? '250' : '20'}
                          value={settings.min_order_value || ''}
                          onChange={e => updateSettings(loc.id, { min_order_value: parseFloat(e.target.value) || '' })}
                        />
                        {settings.min_order_type === 'cases' && <span className="text-sm text-muted-foreground">cases</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Delivery Schedule */}
                <div>
                  <Label className="text-xs mb-2 block">Delivery Schedule</Label>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="grid grid-cols-4 gap-0 bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                      <span>Delivery Day</span>
                      <span>Order By (Day)</span>
                      <span>Cut-off Time</span>
                      <span></span>
                    </div>
                    {(settings.delivery_days || DAYS.map(day => ({ day, enabled: false, cutoff_day: 'Sunday', cutoff_time: '5:00 PM' }))).map((dd, idx) => (
                      <div
                        key={dd.day}
                        className={`grid grid-cols-4 gap-0 items-center px-3 py-2 border-t border-border text-sm ${!dd.enabled ? 'opacity-50' : ''}`}
                      >
                        <label className="flex items-center gap-2 cursor-pointer font-medium">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 accent-primary"
                            checked={dd.enabled || false}
                            onChange={e => updateDeliveryDay(loc.id, idx, 'enabled', e.target.checked)}
                          />
                          {dd.day}
                        </label>
                        <select
                          className="border border-input rounded px-2 py-1 text-xs bg-background disabled:bg-muted"
                          disabled={!dd.enabled}
                          value={dd.cutoff_day || 'Sunday'}
                          onChange={e => updateDeliveryDay(loc.id, idx, 'cutoff_day', e.target.value)}
                        >
                          {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <Input
                          className="h-7 text-xs w-24"
                          disabled={!dd.enabled}
                          value={dd.cutoff_time || '5:00 PM'}
                          onChange={e => updateDeliveryDay(loc.id, idx, 'cutoff_time', e.target.value)}
                        />
                        <span />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}