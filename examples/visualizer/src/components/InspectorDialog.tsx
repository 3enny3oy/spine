import {
  Dialog,
  DialogDismiss,
  DialogHeading,
  useDialogStore,
} from "@ariakit/react";
import type { ConfigNodeData, DemoNodeData, PublisherNodeData, ServiceNodeData, SubscriberNodeData } from "../lib/types";

interface InspectorDialogProps {
  open: boolean;
  node: DemoNodeData | null;
  onClose: () => void;
  onUpdateNode: (node: DemoNodeData) => void;
  onUpdateConfig: (patch: Partial<ConfigNodeData>) => void;
  onPromotePublisher: (nodeId: string) => void;
}

export function InspectorDialog({
  open,
  node,
  onClose,
  onUpdateNode,
  onUpdateConfig,
  onPromotePublisher,
}: InspectorDialogProps) {
  const store = useDialogStore({ open, setOpen: (next) => { if (!next) onClose(); } });

  return (
    <Dialog
      store={store}
      className="fixed right-4 top-4 z-50 w-[420px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 p-0 text-slate-100 shadow-[0_30px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogHeading className="text-lg font-semibold text-white">
              {node ? `Edit ${node.title}` : "Edit node"}
            </DialogHeading>
            <p className="mt-1 text-sm text-slate-400">
              Adjust routing, delivery, and payload values in real time.
            </p>
          </div>
          <DialogDismiss className="glass-button">Close</DialogDismiss>
        </div>
      </div>

      <div className="max-h-[calc(100vh-7rem)] space-y-5 overflow-y-auto px-5 py-5">
        {!node ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-400">
            Select a node on the canvas to inspect and edit it.
          </div>
        ) : null}

        {node?.kind === "publisher" ? (
          <PublisherEditor
            node={node}
            onUpdateNode={onUpdateNode}
            onPromotePublisher={onPromotePublisher}
          />
        ) : null}

        {node?.kind === "subscriber" ? (
          <SubscriberEditor node={node} onUpdateNode={onUpdateNode} />
        ) : null}

        {node?.kind === "config" ? (
          <ConfigEditor node={node} onUpdateConfig={onUpdateConfig} />
        ) : null}

        {node?.kind === "service" ? (
          <ServiceEditor node={node} onUpdateNode={onUpdateNode} />
        ) : null}
      </div>
    </Dialog>
  );
}

function PublisherEditor({
  node,
  onUpdateNode,
  onPromotePublisher,
}: {
  node: PublisherNodeData;
  onUpdateNode: (node: DemoNodeData) => void;
  onPromotePublisher: (nodeId: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="grid gap-3">
        <Field
          label="Title"
          value={node.title}
          onChange={(title) => onUpdateNode({ ...node, title })}
        />
        <Field
          label="Address"
          value={node.address}
          onChange={(address) => onUpdateNode({ ...node, address })}
        />
        <Field
          label="Payload"
          asTextarea
          value={node.payloadText}
          onChange={(payloadText) => onUpdateNode({ ...node, payloadText })}
          rows={10}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Signal kind"
            value={node.signalKind}
            onChange={(signalKind) =>
              onUpdateNode({
                ...node,
                signalKind: signalKind as PublisherNodeData["signalKind"],
              })
            }
          />
          <Field
            label="Custom kind"
            value={node.customSignalKind}
            onChange={(customSignalKind) => onUpdateNode({ ...node, customSignalKind })}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="accent-button" onClick={() => onPromotePublisher(node.id)}>
          Publish now
        </button>
      </div>
    </section>
  );
}

function SubscriberEditor({
  node,
  onUpdateNode,
}: {
  node: SubscriberNodeData;
  onUpdateNode: (node: DemoNodeData) => void;
}) {
  return (
    <section className="space-y-4">
      <Field label="Title" value={node.title} onChange={(title) => onUpdateNode({ ...node, title })} />
      <Field
        label="Expression"
        value={node.expression}
        onChange={(expression) => onUpdateNode({ ...node, expression })}
      />
      <Field label="Schema ID" value={node.schemaId} onChange={(schemaId) => onUpdateNode({ ...node, schemaId })} />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Queue depth"
          value={String(node.queueDepth)}
          onChange={(queueDepth) =>
            onUpdateNode({
              ...node,
              queueDepth: Number(queueDepth) || 1,
              delivery: {
                ...node.delivery,
                queue: {
                  ...node.delivery.queue,
                  maxDepth: Number(queueDepth) || 1,
                },
              },
            })
          }
        />
        <Field
          label="Overflow"
          value={node.delivery.queue.overflow}
          onChange={(overflow) =>
            onUpdateNode({
              ...node,
              delivery: {
                ...node.delivery,
                queue: { ...node.delivery.queue, overflow: overflow as SubscriberNodeData["delivery"]["queue"]["overflow"] },
              },
            })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Delivery mode"
          value={node.delivery.mode}
          onChange={(mode) =>
            onUpdateNode({
              ...node,
              delivery: { ...node.delivery, mode: mode as SubscriberNodeData["delivery"]["mode"] },
            })
          }
        />
        <Field
          label="Payload strategy"
          value={node.delivery.payloadStrategy}
          onChange={(payloadStrategy) =>
            onUpdateNode({
              ...node,
              delivery: {
                ...node.delivery,
                payloadStrategy: payloadStrategy as SubscriberNodeData["delivery"]["payloadStrategy"],
              },
            })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Debounce ms"
          value={String(node.delivery.timing.debounceMs ?? "")}
          onChange={(debounceMs) =>
            onUpdateNode({
              ...node,
              delivery: {
                ...node.delivery,
                timing: {
                  ...node.delivery.timing,
                  debounceMs: debounceMs ? Number(debounceMs) : null,
                },
              },
            })
          }
        />
        <Field
          label="Throttle ms"
          value={String(node.delivery.timing.throttleMs ?? "")}
          onChange={(throttleMs) =>
            onUpdateNode({
              ...node,
              delivery: {
                ...node.delivery,
                timing: {
                  ...node.delivery.timing,
                  throttleMs: throttleMs ? Number(throttleMs) : null,
                },
              },
            })
          }
        />
      </div>
      <Field
        label="Configuration expression"
        value={node.configurationExpression}
        onChange={(configurationExpression) => onUpdateNode({ ...node, configurationExpression })}
      />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300">
        <div className="label mb-2">Recent deliveries</div>
        <div className="space-y-2">
          {node.received.length === 0 ? (
            <div className="text-slate-400">No messages yet.</div>
          ) : (
            node.received.slice(0, 4).map((entry, index) => (
              <div key={`${entry.subscriberNodeId}-${index}`} className="rounded-xl bg-black/30 px-3 py-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                  {entry.accepted ? "accepted" : "dropped"}
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-100">{JSON.stringify(entry.payload)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function ConfigEditor({
  node,
  onUpdateConfig,
}: {
  node: ConfigNodeData;
  onUpdateConfig: (patch: Partial<ConfigNodeData>) => void;
}) {
  return (
    <section className="space-y-4">
      <Field
        label="Title"
        value={node.title}
        onChange={(title) => onUpdateConfig({ title })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Allow catch-all"
          value={String(node.allowCatchAll)}
          onChange={(allowCatchAll) => onUpdateConfig({ allowCatchAll: allowCatchAll === "true" })}
        />
        <Field
          label="Default queue depth"
          value={String(node.defaultQueueDepth)}
          onChange={(defaultQueueDepth) => onUpdateConfig({ defaultQueueDepth: Number(defaultQueueDepth) || 1 })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Recursion depth"
          value={String(node.recursionPolicy.maxCausationDepth)}
          onChange={(maxCausationDepth) =>
            onUpdateConfig({
              recursionPolicy: {
                ...node.recursionPolicy,
                maxCausationDepth: Number(maxCausationDepth) || 1,
              },
            })
          }
        />
        <Field
          label="On exceeded"
          value={node.recursionPolicy.onExceeded}
          onChange={(onExceeded) =>
            onUpdateConfig({
              recursionPolicy: {
                ...node.recursionPolicy,
                onExceeded: onExceeded as ConfigNodeData["recursionPolicy"]["onExceeded"],
              },
            })
          }
        />
      </div>
    </section>
  );
}

function ServiceEditor({
  node,
  onUpdateNode,
}: {
  node: ServiceNodeData;
  onUpdateNode: (node: DemoNodeData) => void;
}) {
  return (
    <section className="space-y-4">
      <Field label="Title" value={node.title} onChange={(title) => onUpdateNode({ ...node, title })} />
      <Field label="Address" value={node.address} onChange={(address) => onUpdateNode({ ...node, address })} />
      <Field
        label="Service name"
        value={node.serviceName}
        onChange={(serviceName) => onUpdateNode({ ...node, serviceName })}
      />
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  asTextarea,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  asTextarea?: boolean;
  rows?: number;
}) {
  return (
    <label className="space-y-1.5">
      <div className="label">{label}</div>
      {asTextarea ? (
        <textarea className="field min-h-[88px] resize-y" value={value} rows={rows ?? 4} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className="field" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}
