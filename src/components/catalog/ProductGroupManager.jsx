import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Pencil, Trash2, MoreVertical, Package } from "lucide-react";
import { toast } from "sonner";

export default function ProductGroupManager({ open, onOpenChange, onGroupSelect }) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [formData, setFormData] = useState({ name: "", description: "" });

  const queryClient = useQueryClient();

  const { data: groups, isLoading } = useQuery({
    queryKey: ['productGroups'],
    queryFn: () => base44.entities.ProductGroup.list(),
    enabled: open,
  });

  const { data: items } = useQuery({
    queryKey: ['inventoryItems'],
    queryFn: () => base44.entities.InventoryItem.list(),
    enabled: open,
  });

  const manageGroupsMutation = useMutation({
    mutationFn: (payload) => base44.functions.invoke('manageProductGroups', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productGroups'] });
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] });
      setShowCreateDialog(false);
      setShowEditDialog(false);
      setSelectedGroup(null);
    },
  });

  const handleCreate = () => {
    if (!formData.name.trim()) {
      toast.error("Group name is required");
      return;
    }
    manageGroupsMutation.mutate({
      action: 'create',
      name: formData.name.trim(),
      description: formData.description.trim(),
    });
  };

  const handleEdit = () => {
    if (!formData.name.trim()) {
      toast.error("Group name is required");
      return;
    }
    manageGroupsMutation.mutate({
      action: 'update',
      groupId: selectedGroup.id,
      name: formData.name.trim(),
      description: formData.description.trim(),
    });
  };

  const handleDelete = (group) => {
    if (!confirm(`Delete group "${group.name}"? Items will be ungrouped but not deleted.`)) {
      return;
    }
    manageGroupsMutation.mutate({
      action: 'delete',
      groupId: group.id,
    });
  };

  const openEditDialog = (group) => {
    setSelectedGroup(group);
    setFormData({ name: group.name, description: group.description || "" });
    setShowEditDialog(true);
  };

  const groupedItemsCount = (groupId) => {
    return items?.filter(item => item.product_group_id === groupId).length || 0;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Product Groups</DialogTitle>
            <DialogDescription>
              Create, edit, and organize product groups. Items in the same group are displayed together in the catalog.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-medium">Product Groups</h3>
              <Button
                size="sm"
                onClick={() => {
                  setFormData({ name: "", description: "" });
                  setShowCreateDialog(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1" />
                New Group
              </Button>
            </div>

            <div className="border rounded-md divide-y max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
              ) : groups?.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  No product groups yet. Create one to organize your catalog.
                </div>
              ) : (
                groups?.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                        <Package className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{group.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {groupedItemsCount(group.id)} item{groupedItemsCount(group.id) !== 1 ? 's' : ''}
                          {group.description && ` • ${group.description.substring(0, 50)}${group.description.length > 50 ? '...' : ''}`}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(group)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit Group
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDelete(group)}>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Group Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Product Group</DialogTitle>
            <DialogDescription>
              Create a new group to organize related products.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                placeholder="e.g., Coffee, Soda, Snacks"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="groupDescription">Description (optional)</Label>
              <Textarea
                id="groupDescription"
                placeholder="Brief description of this product group"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={manageGroupsMutation.isPending}>
              {manageGroupsMutation.isPending ? "Creating..." : "Create Group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product Group</DialogTitle>
            <DialogDescription>
              Update the group details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editGroupName">Group Name</Label>
              <Input
                id="editGroupName"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editGroupDescription">Description (optional)</Label>
              <Textarea
                id="editGroupDescription"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={manageGroupsMutation.isPending}>
              {manageGroupsMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}