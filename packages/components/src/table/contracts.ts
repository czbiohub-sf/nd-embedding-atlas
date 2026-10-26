export interface TableConfig {
  /** Visible fields in order (the toolbar's Fields menu); null shows every field. */
  columns: string[] | null;
  /** Group fields, outermost first (the toolbar's Group builder); empty lists rows flat. */
  groupBy: string[];
  /** Px width of each field the user resized; the others size to their content. */
  widths: Record<string, number>;
}
