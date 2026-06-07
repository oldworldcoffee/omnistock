import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Building2, CreditCard, Users, Save, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import PageHeader from '@/components/layout/PageHeader';
import { toast } from 'sonner';
import CompanyUsers from '@/pages/CompanyUsers';

export default function Settings() {
  const { user, companyId } = useAuth();
  const fileInputRef = useRef(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    company_name: '',
    logo_url: '',
    billing_email: '',
    billing_address: '',
    billing_phone: '',
    tax_id: '',
    subscription_plan: 'starter',
    subscription_status: 'trial'
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const allSettings = await base44.entities.CompanySettings.list();
      const existing = allSettings.length > 0 ? allSettings[0] : null;
      
      if (existing) {
        setSettings(existing);
        setForm({
          company_name: existing.company_name || '',
          logo_url: existing.logo_url || '',
          billing_email: existing.billing_email || '',
          billing_address: existing.billing_address || '',
          billing_phone: existing.billing_phone || '',
          tax_id: existing.tax_id || '',
          subscription_plan: existing.subscription_plan || 'starter',
          subscription_status: existing.subscription_status || 'trial'
        });
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
    setLoading(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      if (settings) {
        await base44.entities.CompanySettings.update(settings.id, form);
      } else {
        // Generate company_id on first creation (will use the record's ID)
        const newRecord = await base44.entities.CompanySettings.create({
          ...form,
          company_id: companyId || 'temp_' + Date.now()
        });
        // Update the company_id to match the record ID for consistency
        if (newRecord.id && newRecord.company_id !== newRecord.id) {
          await base44.entities.CompanySettings.update(newRecord.id, { company_id: newRecord.id });
        }
      }
      toast.success('Settings saved successfully');
      loadSettings();
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    }
    setSaving(false);
  };

  const isAdmin = user?.role === 'admin';

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader title="Settings" subtitle="Company settings and configuration" />
        <Card className="mt-6">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Only administrators can access company settings.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader 
        title="Settings" 
        subtitle="Manage company settings, billing, and users" 
      />

      <Tabs defaultValue="company" className="mt-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="company" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Company
          </TabsTrigger>
          <TabsTrigger value="billing" className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Billing
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Users
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
              <CardDescription>Default company name and details used across the platform</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Company Name</Label>
                <Input 
                  className="mt-1" 
                  value={form.company_name} 
                  onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                  placeholder="e.g., Old World Coffee Roasters"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This name will appear on orders, emails, and reports
                </p>
              </div>

              <div>
                <Label>Company Logo</Label>
                <div className="mt-1 flex items-start gap-4">
                  <div className="flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        
                        setUploadingLogo(true);
                        try {
                          const { file_url } = await base44.integrations.Core.UploadFile({ file });
                          setForm(f => ({ ...f, logo_url: file_url }));
                          toast({
                            title: 'Logo uploaded',
                            description: 'Your logo has been uploaded successfully',
                          });
                        } catch (error) {
                          toast({
                            title: 'Upload failed',
                            description: 'Failed to upload logo. Please try again.',
                            variant: 'destructive',
                          });
                        } finally {
                          setUploadingLogo(false);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingLogo}
                      className="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Upload PNG, JPG, or SVG (max 5MB)
                    </p>
                  </div>
                  {form.logo_url && (
                    <div className="w-32 h-32 border rounded-lg bg-muted/50 flex items-center justify-center p-2">
                      <img src={form.logo_url} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                </div>
                {form.logo_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-destructive"
                    onClick={() => setForm(f => ({ ...f, logo_url: '' }))}
                  >
                    Remove Logo
                  </Button>
                )}
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={saveSettings} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Billing Information</CardTitle>
              <CardDescription>Manage your billing details and subscription</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Billing Email</Label>
                  <Input 
                    className="mt-1" 
                    type="email"
                    value={form.billing_email} 
                    onChange={e => setForm(f => ({ ...f, billing_email: e.target.value }))}
                    placeholder="billing@company.com"
                  />
                </div>
                <div>
                  <Label>Billing Phone</Label>
                  <Input 
                    className="mt-1" 
                    value={form.billing_phone} 
                    onChange={e => setForm(f => ({ ...f, billing_phone: e.target.value }))}
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              <div>
                <Label>Billing Address</Label>
                <Input 
                  className="mt-1" 
                  value={form.billing_address} 
                  onChange={e => setForm(f => ({ ...f, billing_address: e.target.value }))}
                  placeholder="123 Main St, City, State 12345"
                />
              </div>

              <div>
                <Label>Tax ID / EIN</Label>
                <Input 
                  className="mt-1" 
                  value={form.tax_id} 
                  onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))}
                  placeholder="XX-XXXXXXX"
                />
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Current Plan</p>
                    <p className="text-sm text-muted-foreground capitalize">{form.subscription_plan}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">Status</p>
                    <p className="text-sm text-muted-foreground capitalize">{form.subscription_status}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button onClick={saveSettings} disabled={saving}>
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-6">
          <CompanyUsers />
        </TabsContent>
      </Tabs>
    </div>
  );
}