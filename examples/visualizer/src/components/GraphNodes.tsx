import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ConfigNodeData, PublisherNodeData, ServiceNodeData, SubscriberNodeData } from "../lib/types";
import { formatDeliveryOptions, formatPayload } from "../lib/bus";

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function NodeShell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="node-card min-w-[260px] overflow-hidden">
      <div className={`h-1.5 w-full ${tone}`} />
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

export function PublisherNode({ data, selected }: NodeProps<PublisherNodeData>) {
  return (
    <NodeShell tone="bg-cyan-400">
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-0 !bg-cyan-400" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{data.title}</div>
          <div className="text-xs text-cyan-200/80">Publishes a signal</div>
        </div>
        <div className="chip">{data.signalKind}</div>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="label">Address</div>
          <div className="mt-1 break-all rounded-xl bg-white/5 px-3 py-2 font-mono text-xs text-slate-100">
            {data.address}
          </div>
        </div>
        <div>
          <div className="label">Payload</div>
          <pre className="mt-1 max-h-32 overflow-auto rounded-xl bg-black/30 p-3 text-[11px] leading-5 text-slate-200">
            {formatPayload(safeParse(data.payloadText))}
          </pre>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
        <span className="chip">last pulse: {data.lastPulse ? "live" : "idle"}</span>
        {selected ? <span className="chip">selected</span> : null}
      </div>
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-0 !bg-cyan-400/30" />
    </NodeShell>
  );
}

export function SubscriberNode({ data, selected }: NodeProps<SubscriberNodeData>) {
  return (
    <NodeShell tone="bg-emerald-400">
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-0 !bg-emerald-400" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{data.title}</div>
          <div className="text-xs text-emerald-200/80">Receives matching signals</div>
        </div>
        <div className="chip">{data.received.length} received</div>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="label">Expression</div>
          <div className="mt-1 break-all rounded-xl bg-white/5 px-3 py-2 font-mono text-xs text-slate-100">
            {data.expression}
          </div>
        </div>
        <div>
          <div className="label">Delivery</div>
          <div className="mt-1 rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-200">
            {formatDeliveryOptions(data.delivery)}
          </div>
        </div>
        <div>
          <div className="label">Inbox</div>
          <div className="mt-1 space-y-2">
            {data.received.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                Waiting for a matching publish
              </div>
            ) : (
              data.received.slice(0, 2).map((item, index) => (
                <div key={`${item.subscriberNodeId}-${index}`} className="rounded-xl bg-black/30 px-3 py-2 text-[11px] text-slate-200">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    {item.accepted ? "accepted" : "dropped"}
                  </div>
                  <div className="mt-1 break-all font-mono text-[11px] text-slate-100">
                    {formatPayload(item.payload)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
        <span className="chip">queue depth {data.queueDepth}</span>
        {selected ? <span className="chip">selected</span> : null}
      </div>
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-0 !bg-emerald-400/30" />
    </NodeShell>
  );
}

export function ConfigNode({ data, selected }: NodeProps<ConfigNodeData>) {
  return (
    <NodeShell tone="bg-violet-400">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{data.title}</div>
          <div className="text-xs text-violet-200/80">Global delivery mechanics</div>
        </div>
        <div className="chip">bus</div>
      </div>
      <div className="space-y-2 text-sm text-slate-200">
        <div className="rounded-xl bg-white/5 px-3 py-2 text-xs">
          catch-all: <span className="font-semibold">{String(data.allowCatchAll)}</span>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2 text-xs">
          queue depth: <span className="font-semibold">{data.defaultQueueDepth}</span>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2 text-xs">
          recursion: <span className="font-semibold">{data.recursionPolicy.maxCausationDepth}</span>
        </div>
      </div>
      {selected ? <span className="chip">selected</span> : null}
    </NodeShell>
  );
}

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeData>) {
  return (
    <NodeShell tone="bg-fuchsia-400">
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-0 !bg-fuchsia-400" />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{data.title}</div>
          <div className="text-xs text-fuchsia-200/80">Resolved by address</div>
        </div>
        <div className="chip">service</div>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="label">Address</div>
          <div className="mt-1 break-all rounded-xl bg-white/5 px-3 py-2 font-mono text-xs text-slate-100">
            {data.address}
          </div>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-200">{data.serviceName}</div>
      </div>
      {selected ? <span className="chip">selected</span> : null}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-0 !bg-fuchsia-400/30" />
    </NodeShell>
  );
}
