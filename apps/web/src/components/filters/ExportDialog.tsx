/**
 * ExportDialog (Component Inventory · Forms and filters): carries the current filters, shows the
 * matching count, then streams the CSV. Used by the six exportable list screens.
 */
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Overlay';
import { toast } from '@/components/ui/toast';
import { exportCsv, type ExportEntity } from '@/features/imports/api';
import type { Query } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';

export function ExportDialog({
  open,
  onOpenChange,
  entity,
  filters,
  estimatedCount,
  filterSummary,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entity: ExportEntity;
  filters: Query;
  estimatedCount?: number;
  filterSummary?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Export ${entity}`}
      width={440}
      dismissable={!busy}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Download}
            loading={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await exportCsv(entity, filters);
                  onOpenChange(false);
                } catch (e) {
                  toast({ tone: 'danger', title: 'Export failed', description: errorMessage(e) });
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Download CSV
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-base">
        <p className="text-muted">
          The export uses the filters on screen, so what you see is what you get. UTF-8 with a
          byte-order mark, so Excel opens it correctly.
        </p>
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 rounded-md border border-border bg-surface p-3">
          <dt className="text-sm text-muted">Rows</dt>
          <dd className="tnum">
            {estimatedCount === undefined
              ? 'All matching rows'
              : estimatedCount.toLocaleString('en-KE')}
          </dd>
          <dt className="text-sm text-muted">Filters</dt>
          <dd className="min-w-0 break-words">{filterSummary ?? 'None'}</dd>
        </dl>
        <p className="mono text-xs text-faint">GET /exports/{entity}?format=csv</p>
      </div>
    </Dialog>
  );
}
