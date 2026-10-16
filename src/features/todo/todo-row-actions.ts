export interface TodoRowActionsProps {
  disabled?: boolean;
  abandoned: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAbandon: () => void;
}
