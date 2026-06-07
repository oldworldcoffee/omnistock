import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { UserPlus, Mail, RefreshCw, Trash2, Shield, User, ChevronDown, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const ROLE_PRESETS = {
  admin: {
    label: 'Admin',
    description: 'Full access to everything',
    permissions: { master_catalog: true, hq_reports: true, all_locations: true, location_ids: [] }
  },
  manager: {
    label: 'Manager',
    description: 'Access to specific locations, no catalog management',
    permissions: { master_catalog: false, hq_reports: true, all_locations: false, location_ids: [] }
  },
  staff: {
    label: 'Staff',
    description: 'Limited access to assigned locations only',
    permissions: { master_catalog: false, hq_reports: false, all_locations: false, location_ids: [] }
  }
};

const ROLE_COLORS = {
  admin: 'bg-purple-100 text-purple-700',
  manager: 'bg-blue-100 text-blue-700',
  staff: 'bg-gray-100 text-gray-600'
};

export default function CompanyUsers() {
  const [userPerms, setUserPerms] = useState([]);
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteDialog, setInviteDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(null);
  const [sending, setSending] = useState(false);

  const emptyForm = {
    email: '',
    full_name: '',
    role: 'staff',
    permissions: { master_catalog: false, hq_reports: false, all_locations: false, location_ids: [] }
  };
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [perms, locs, allUsers] = await Promise.all([
      base44.entities.UserPermission.list(),
      base44.entities.Location.filter({ is_active: true }),
      base44.entities.User.list()
    ]);
    setUserPerms(perms);
    setLocations(locs);
    setUsers(allUsers);
    setLoading(false);
  };

  const applyPreset = (role) => {
    const preset = ROLE_PRESETS[role];
    setForm(f => ({ ...f, role, permissions: { ...preset.permissions, location_ids: f.permissions.location_ids || [] } }));
  };

  const toggleLocation = (locId, permObj, setPermObj) => {
    const ids = permObj.location_ids || [];
    const updated = ids.includes(locId) ? ids.filter(id => id !== locId) : [...ids, locId];
    setPermObj(f => ({ ...f, permissions: { ...f.permissions, location_ids: updated } }));
  };

  const sendInvite = async () => {
    setSending(true);
    const invite = await base44.users.inviteUser(form.email, form.role === 'admin' ? 'admin' : 'user');
    await base44.entities.UserPermission.create({
      email: form.email,
      full_name: form.full_name,
      role: form.role,
      status: 'pending',
      permissions: form.permissions,
      invited_at: new Date().toISOString()
    });
    setSending(false);
    setInviteDialog(false);
    setForm(emptyForm);
    await shareInviteLink(invite?.invite_url);
    await load();
  };

  const resendInvite = async (perm) => {
    const invite = await base44.users.inviteUser(perm.email, perm.role === 'admin' ? 'admin' : 'user');
    await base44.entities.UserPermission.update(perm.id, { invited_at: new Date().toISOString() });
    await shareInviteLink(invite?.invite_url);
    await load();
  };

  const shareInviteLink = async (inviteUrl) => {
    if (!inviteUrl) return;
    const fullUrl = `${window.location.origin}${inviteUrl}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success('Invite link copied to clipboard');
    } catch {
      window.prompt('Copy this invite link:', fullUrl);
    }
  };

  const saveEdit = async () => {
    await base44.entities.UserPermission.update(editDialog.id, {
      role: editDialog.role,
      permissions: editDialog.permissions
    });
    setEditDialog(null);
    await load();
  };

  const removeUser = async (perm) => {
    await base44.entities.UserPermission.delete(perm.id);
    await load();
  };

  // Merge users list with perms to get a unified view
  const allEntries = [
    // Active users (matched by email)
    ...users.map(u => {
      const perm = userPerms.find(p => p.email === u.email);
      return { type: 'active', user: u, perm, email: u.email, name: u.full_name, role: perm?.role || u.role };
    }),
    // Pending invites (no matching user yet)
    ...userPerms.filter(p => p.status === 'pending' && !users.find(u => u.email === p.email))
      .map(p => ({ type: 'pending', perm: p, email: p.email, name: p.full_name, role: p.role }))
  ];

  const PermissionEditor = ({ permObj, setPermObj }) => (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-foreground mb-2">Role Preset</p>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => {
                const updated = { ...preset.permissions, location_ids: permObj.permissions?.location_ids || [] };
                setPermObj(f => ({ ...f, role: key, permissions: updated }));
              }}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                permObj.role === key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
              }`}
            >
              <p className="text-xs font-semibold">{preset.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{preset.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border rounded-lg p-3 space-y-3">
        <p className="text-sm font-medium">Permissions</p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={permObj.permissions?.master_catalog || false}
              onCheckedChange={v => setPermObj(f => ({ ...f, permissions: { ...f.permissions, master_catalog: v } }))}
            />
            <div>
              <p className="text-sm font-medium">Master Catalog</p>
              <p className="text-xs text-muted-foreground">Can view and edit the master item catalog</p>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={permObj.permissions?.hq_reports || false}
              onCheckedChange={v => setPermObj(f => ({ ...f, permissions: { ...f.permissions, hq_reports: v } }))}
            />
            <div>
              <p className="text-sm font-medium">HQ Reports</p>
              <p className="text-xs text-muted-foreground">Can view company-wide reports and analytics</p>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={permObj.permissions?.all_locations || false}
              onCheckedChange={v => setPermObj(f => ({ ...f, permissions: { ...f.permissions, all_locations: v } }))}
            />
            <div>
              <p className="text-sm font-medium">All Locations</p>
              <p className="text-xs text-muted-foreground">Access to all current and future locations</p>
            </div>
          </label>
        </div>

        {!permObj.permissions?.all_locations && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Location Access</p>
            <div className="grid grid-cols-2 gap-1.5">
              {locations.map(loc => (
                <label key={loc.id} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-muted/50">
                  <Checkbox
                    checked={(permObj.permissions?.location_ids || []).includes(loc.id)}
                    onCheckedChange={() => toggleLocation(loc.id, permObj, setPermObj)}
                  />
                  <span className="text-xs">{loc.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        title="Company Users"
        subtitle="Manage team members, invites, and permissions"
        actions={
          <Button onClick={() => setInviteDialog(true)}>
            <UserPlus className="w-4 h-4 mr-1" />Invite User
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['User', 'Role', 'Permissions', 'Status', 'Invited', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allEntries.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No users yet. Invite your team!</td></tr>
              ) : allEntries.map((entry, i) => (
                <tr key={i} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{entry.name || '—'}</p>
                        <p className="text-xs text-muted-foreground">{entry.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[entry.role] || 'bg-muted text-muted-foreground'}`}>
                      {entry.role?.charAt(0).toUpperCase() + entry.role?.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {entry.perm ? (
                      <div className="flex flex-wrap gap-1">
                        {entry.perm.permissions?.master_catalog && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">Catalog</span>}
                        {entry.perm.permissions?.hq_reports && <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">Reports</span>}
                        {entry.perm.permissions?.all_locations && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">All Locations</span>}
                        {!entry.perm.permissions?.all_locations && (entry.perm.permissions?.location_ids || []).map(lid => {
                          const loc = locations.find(l => l.id === lid);
                          return loc ? <span key={lid} className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-medium">{loc.name}</span> : null;
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {entry.type === 'pending' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pending</span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {entry.perm?.invited_at ? format(new Date(entry.perm.invited_at), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      {entry.type === 'pending' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Resend invite" onClick={() => resendInvite(entry.perm)}>
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {entry.perm && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit permissions" onClick={() => setEditDialog({ ...entry.perm })}>
                          <Shield className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {entry.perm && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Remove" onClick={() => removeUser(entry.perm)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteDialog} onOpenChange={setInviteDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4" />Invite User</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Full Name</Label>
                <Input className="mt-1" placeholder="Jane Doe" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
              </div>
              <div>
                <Label>Email *</Label>
                <Input className="mt-1" placeholder="jane@company.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <PermissionEditor permObj={form} setPermObj={setForm} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInviteDialog(false); setForm(emptyForm); }}>Cancel</Button>
            <Button onClick={sendInvite} disabled={!form.email || sending}>
              <Mail className="w-4 h-4 mr-1" />{sending ? 'Sending...' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Permissions Dialog */}
      {editDialog && (
        <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Shield className="w-4 h-4" />Edit Permissions — {editDialog.email}</DialogTitle></DialogHeader>
            <div className="py-2">
              <PermissionEditor permObj={editDialog} setPermObj={setEditDialog} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialog(null)}>Cancel</Button>
              <Button onClick={saveEdit}>Save Permissions</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
