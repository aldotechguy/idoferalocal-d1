export interface CustomerPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSettleDebt: boolean;
  canExport: boolean;
  canEditNotes: boolean;
  canEditTags: boolean;
  canBulkTag: boolean;
  canManageSupport: boolean;
}

/**
 * Fine-grained role-based permissions for the Customer Hub.
 * Prepares for Customer Support (read & write CRM access) while keeping
 * destructive deletes and CSV exports appropriately restricted.
 */
export function getCustomerPermissions(role?: string): CustomerPermissions {
  switch (role) {
    case 'Administrator':
      return {
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canSettleDebt: true,
        canExport: true,
        canEditNotes: true,
        canEditTags: true,
        canBulkTag: true,
        canManageSupport: true,
      };
    case 'Store Manager':
      return {
        canCreate: true,
        canEdit: true,
        canDelete: true,
        canSettleDebt: true,
        canExport: false,
        canEditNotes: true,
        canEditTags: true,
        canBulkTag: true,
        canManageSupport: true,
      };
    case 'Customer Support':
      return {
        canCreate: true,
        canEdit: true,
        canDelete: false,
        canSettleDebt: true,
        canExport: false,
        canEditNotes: true,
        canEditTags: true,
        canBulkTag: true,
        canManageSupport: true,
      };
    case 'Accountant':
      return {
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canSettleDebt: true,
        canExport: false,
        canEditNotes: true,
        canEditTags: false,
        canBulkTag: false,
        canManageSupport: true,
      };
    case 'Sales Staff':
    default:
      return {
        canCreate: true,
        canEdit: false,
        canDelete: false,
        canSettleDebt: true,
        canExport: false,
        canEditNotes: true,
        canEditTags: false,
        canBulkTag: false,
        canManageSupport: true,
      };
  }
}
