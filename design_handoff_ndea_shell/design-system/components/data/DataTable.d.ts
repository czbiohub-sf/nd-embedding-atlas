export interface DataColumn {
  key: string;
  label?: string;
  type?: 'text' | 'number' | 'category' | 'label' | 'checkbox';
  /** Provenance. obs = from the AnnData file (no marker); saved = filled dot; unsaved = hollow amber ring. */
  status?: 'obs' | 'saved' | 'unsaved';
}
export interface DataRow {
  id: string;
  /** Category/label cells take {label,color} or a string. */
  cells: Record<string, any>;
  /** Unsaved cells; { old } is shown struck through when showOld is on. */
  dirty?: Record<string, { old?: string }>;
}
export interface DataTableProps {
  columns: DataColumn[];
  rows: DataRow[];
  /** Focused observation, shared with every linked tile. */
  focusId?: string;
  onRowClick?: (row: DataRow, e: React.MouseEvent) => void;
  selectable?: boolean;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  /** Changes view: show old values beside edits. */
  showOld?: boolean;
  /** Optional footer summaries per column key. Off by default; the ndea shell does not show them. */
  summaries?: Record<string, string>;
  style?: React.CSSProperties;
}
/** @startingPoint section="Data" subtitle="Airtable-lite table with provenance" viewport="700x300" */
export declare function DataTable(props: DataTableProps): JSX.Element;
