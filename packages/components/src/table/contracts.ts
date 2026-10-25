export interface TableConfig {
  /** Visible fields in order (the toolbar's Fields menu); null shows every field. */
  columns: string[] | null;
  /** Rows grouped by this field (the toolbar's Group menu). */
  groupBy: string | null;
}
