import { useState } from 'react';
import { CheckSquare, Square, Image, Pencil, Trash2, Star, ChevronRight, ChevronDown, ChevronUp, FolderPen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';
import StatusBadge from '@/components/ui/StatusBadge';
import { toast } from 'sonner';

export default function GroupedCatalogRow({ 
  group,
  isGroup,
  isExpanded,
  firstItem,
  selected,
  uniqueVendors,
  allUnitCosts,
  onToggleGroup, 
  onToggleSelect, 
  onEdit, 
  onDelete,
  onRefresh,
  onReorderGroupItems,
  getPreferredOption,
  getCheapestOption,
  getPricePerUOM,
  groupNames
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const displayName = groupNames[group.groupId] || firstItem.name.split(' - ')[0];

  const handleRename = async (newValue) => {
    if (!newValue.trim() || newValue.trim() === displayName) {
      setIsRenaming(false);
      return;
    }
    try {
      const result = await base44.functions.invoke('manageProductGroups', {
        action: 'update',
        groupId: group.groupId,
        name: newValue.trim()
      });
      
      if (result.data?.migrated) {
        toast.success('Group migrated and renamed');
      } else {
        toast.success('Group renamed');
      }
      onRefresh();
      setIsRenaming(false);
    } catch (error) {
      toast.error('Failed to rename group: ' + error.message);
      setRenameValue(displayName);
    }
  };

  return (
    <>
      {/* Group Header Row */}
      <tr className={`hover:bg-muted/30 transition-colors ${isGroup ? 'bg-muted/20' : ''}`}>
        <td className="px-4 py-3">
          {isGroup ? (
            <button onClick={() => onToggleGroup(group.groupId)} className="hover:opacity-70">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <button onClick={() => onToggleSelect(firstItem.id)} className="hover:opacity-70">
              {selected.has(firstItem.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
            </button>
          )}
        </td>
        <td className="px-4 py-3 font-medium text-foreground">
          {isGroup ? (
            <div className="flex items-center gap-2">
              {isRenaming ? (
                <Input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(renameValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleRename(renameValue);
                    } else if (e.key === 'Escape') {
                      setIsRenaming(false);
                      setRenameValue('');
                    }
                  }}
                  className="h-7 text-sm"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="font-semibold">{displayName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(displayName);
                      setIsRenaming(true);
                    }}
                  >
                    <FolderPen className="w-3 h-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground">({group.items.length} sizes)</span>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {(() => {
                const img = firstItem.purchase_options?.find(o => o.product_image_url)?.product_image_url;
                return img ? (
                  <img src={img} alt="" className="w-10 h-10 object-contain rounded border bg-white" onError={(e) => e.target.style.display = 'none'} />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center bg-muted rounded border">
                    <Image className="w-4 h-4 text-muted-foreground" />
                  </div>
                );
              })()}
              <div>
                <div>{firstItem.name}</div>
                {firstItem.purchase_options?.find(o => o.product_image_url) && (
                  <div className="text-xs text-muted-foreground">
                    <a href={firstItem.purchase_options.find(o => o.product_image_url).product_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
                      🔗 {firstItem.purchase_options.find(o => o.product_image_url).vendor_name}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          {isGroup ? (
            <span className="text-muted-foreground">{group.items[0]?.category || '-'}</span>
          ) : (
            firstItem.category
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          {isGroup ? (
            <span className="text-xs">{firstItem.unit_of_measure}</span>
          ) : (
            firstItem.unit_of_measure
          )}
        </td>
        <td className="px-4 py-3">
          {isGroup ? (
            <div className="flex flex-wrap gap-1">
              {uniqueVendors.slice(0, 2).map((v, i) => (
                <span key={i} className="text-xs px-2 py-0.5 bg-muted rounded-full">{v}</span>
              ))}
              {uniqueVendors.length > 2 && (
                <span className="text-xs text-muted-foreground">+{uniqueVendors.length - 2}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {getPreferredOption(firstItem) && (
                <Star className="w-3 h-3 text-primary fill-primary" />
              )}
              <span className="text-muted-foreground">
                {(firstItem.purchase_options || []).length || 0} option{(firstItem.purchase_options || []).length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          {isGroup ? (
            allUnitCosts.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                ${Math.min(...allUnitCosts).toFixed(2)} - ${Math.max(...allUnitCosts).toFixed(2)}
              </div>
            ) : (
              '-'
            )
          ) : (
            firstItem.unit_cost ? (
              <div className="flex items-center gap-1">
                <span>${parseFloat(firstItem.unit_cost).toFixed(2)}</span>
                {getCheapestOption(firstItem) && getPreferredOption(firstItem)?.unit_cost !== getCheapestOption(firstItem).unit_cost && (
                  <span className="text-xs text-success">(${parseFloat(getCheapestOption(firstItem).unit_cost).toFixed(2)})</span>
                )}
              </div>
            ) : (
              '-'
            )
          )}
        </td>
        <td className="px-4 py-3">
          {isGroup ? (
            '-'
          ) : (
            (() => {
              const opt = getPreferredOption(firstItem);
              if (!opt) return '-';
              const ppu = getPricePerUOM(opt, firstItem.unit_of_measure);
              if (!ppu) return '-';
              return (
                <div className="text-xs">
                  <div>${ppu.price}</div>
                  <div className="text-muted-foreground">per {ppu.uom}</div>
                </div>
              );
            })()
          )}
        </td>
        <td className="px-4 py-3">
          {isGroup ? (
            firstItem.is_commissary_item ? (
              <div className="text-xs">
                <div className="font-medium">${parseFloat(firstItem.commissary_price || 0).toFixed(2)}</div>
                <div className="text-muted-foreground">retail price</div>
              </div>
            ) : (
              '-'
            )
          ) : (
            firstItem.is_commissary_item ? (
              <div className="text-xs">
                <div className="font-medium">${parseFloat(firstItem.commissary_price || 0).toFixed(2)}</div>
                <div className="text-muted-foreground">retail price</div>
              </div>
            ) : (
              '-'
            )
          )}
        </td>
        <td className="px-4 py-3">
          {isGroup ? (
            <StatusBadge status={firstItem.is_active ? 'active' : 'archived'} />
          ) : (
            <StatusBadge status={firstItem.is_active ? 'active' : 'archived'} />
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {isGroup ? (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" onClick={() => onEdit(firstItem)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="icon" onClick={() => onEdit(firstItem)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onDelete(firstItem.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          )}
        </td>
      </tr>

      {/* Expanded Group Items */}
      {isGroup && isExpanded && (
        <>
          {group.items.map((item, idx) => (
            <tr
              key={item.id}
              className="hover:bg-muted/20 transition-colors bg-muted/10"
            >
              <td className="px-1 py-1">
                <div className="flex items-center justify-center gap-0.5">
                  <button
                    onClick={() => onReorderGroupItems(group.groupId, idx, idx - 1)}
                    disabled={idx === 0}
                    className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onReorderGroupItems(group.groupId, idx, idx + 1)}
                    disabled={idx === group.items.length - 1}
                    className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1">
                          <button onClick={() => onToggleSelect(item.id)} className="hover:opacity-70">
                            {selected.has(item.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                          </button>
                          <div>
                            <div className="font-medium">{item.name}</div>
                            {item.description && (
                              <div className="text-xs text-muted-foreground truncate max-w-xs">{item.description}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{item.category || '-'}</td>
                      <td className="px-4 py-2 text-muted-foreground">{item.unit_of_measure}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          {getPreferredOption(item) && (
                            <Star className="w-3 h-3 text-primary fill-primary" />
                          )}
                          <span className="text-muted-foreground">
                            {(item.purchase_options || []).length || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {item.unit_cost ? (
                          <div className="flex items-center gap-1">
                            <span>${parseFloat(item.unit_cost).toFixed(2)}</span>
                            {getCheapestOption(item) && getPreferredOption(item)?.unit_cost !== getCheapestOption(item).unit_cost && (
                              <span className="text-xs text-success">(${parseFloat(getCheapestOption(item).unit_cost).toFixed(2)})</span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {(() => {
                          const opt = getPreferredOption(item);
                          if (!opt) return '-';
                          const ppu = getPricePerUOM(opt, item.unit_of_measure);
                          if (!ppu) return '-';
                          return (
                            <div className="text-xs">
                              <div>${ppu.price}</div>
                              <div className="text-muted-foreground">per {ppu.uom}</div>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2">
                        {item.is_commissary_item ? (
                          <div className="text-xs">
                            <div className="font-medium">${parseFloat(item.commissary_price || 0).toFixed(2)}</div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={item.is_active ? 'active' : 'archived'} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => onEdit(item)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => onDelete(item.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                      </tr>
                      ))}
                      </>
                      )}
    </>
  );
}