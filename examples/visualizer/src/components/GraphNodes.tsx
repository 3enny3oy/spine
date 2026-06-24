import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ConfigNodeData, PublisherNodeData, ServiceNodeData, SubscriberNodeData } from "../lib/types";
import { formatDeliveryOptions } from "../lib/bus";

const VISIBLE_SOURCE_HANDLE = "!h-3 !w-3 !border-0 !bg-cyan-400";
const VISIBLE_TARGET_HANDLE = "!h-3 !w-3 !border-0 !bg-cyan-400/30";
const VISIBLE_SUBSCRIBER_TARGET = "!h-3 !w-3 !border-0 !bg-emerald-400";
const VISIBLE_SUBSCRIBER_SOURCE = "!h-3 !w-3 !border-0 !bg-emerald-400/30";
const VISIBLE_SERVICE_TARGET = "!h-3 !w-3 !border-0 !bg-fuchsia-400";
const VISIBLE_SERVICE_SOURCE = "!h-3 !w-3 !border-0 !bg-fuchsia-400/30";
const AUX_HANDLE = "!h-3 !w-3 !border-0 !bg-transparent opacity-0";

function NodeShell({
  children,
  tone,
  active,
}: {
  children: React.ReactNode;
  tone: string;
  active?: boolean;
}) {
  return (
    <div className={`node-card w-[250px] overflow-hidden ${active ? "ring-2 ring-cyan-300/60 shadow-cyan-400/20" : ""}`}>
      <div className={`h-1.5 w-full ${tone}`} />
      <div className="space-y-2 p-3">{children}</div>
    </div>
  );
}

function ActivityPreview({
  label,
  value,
  tone,
}: {
  label?: string;
  value?: string;
  tone?: "sent" | "received" | "service" | "dropped";
}) {
  if (!label) {
    return null;
  }

  const accent =
    tone === "received"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "service"
        ? "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100"
        : tone === "dropped"
          ? "border-rose-400/20 bg-rose-400/10 text-rose-100"
          : "border-cyan-400/20 bg-cyan-400/10 text-cyan-100";

  return (
    <div className={`rounded-xl border px-3 py-2 ${accent}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-80">{label}</div>
      {value ? <div className="mt-1 text-[11px] leading-5">{value}</div> : null}
    </div>
  );
}

function QueueSummary({
  label,
  items,
}: {
  label?: string;
  items?: string[];
}) {
  if (!label) {
    return null;
  }

  const count = items?.length ?? 0;
  const latest = count ? items?.[count - 1] : null;

  return (
    <div className="rounded-xl border border-white/6 bg-black/20 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="label">{label}</div>
        {count ? (
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : (
          <span className="chip">0</span>
        )}
      </div>
      {latest ? (
        <div className="mt-2 truncate text-[11px] text-slate-100" title={latest}>
          {latest}
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-slate-400">No items waiting</div>
      )}
    </div>
  );
}

export function PublisherNode({ data, selected }: NodeProps<PublisherNodeData>) {
  return (
    <NodeShell tone="bg-cyan-400" active={data.isActive}>
      <Handle id="right" type="source" position={Position.Right} className={VISIBLE_SOURCE_HANDLE} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={AUX_HANDLE} />
      <Handle id="left" type="target" position={Position.Left} className={VISIBLE_TARGET_HANDLE} />
      <Handle id="top" type="target" position={Position.Top} className={AUX_HANDLE} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-5 text-white">{data.title}</div>
          <div className="text-xs text-cyan-200/80">Publishes a signal</div>
        </div>
        <div className="chip">{data.signalKind}</div>
      </div>
      {data.note ? <div className="rounded-xl bg-white/5 px-3 py-2 text-xs leading-5 text-slate-300">{data.note}</div> : null}
      <div>
        <div className="label">Address</div>
        <div className="mt-1 truncate rounded-xl bg-white/5 px-3 py-2 font-mono text-xs text-slate-100" title={data.address}>
          {data.address}
        </div>
      </div>
      <ActivityPreview label={data.activityLabel} value={data.activityValue} tone={data.activityTone} />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
        <span className="chip">last pulse: {data.lastPulse ? "live" : "idle"}</span>
        {selected ? <span className="chip">selected</span> : null}
      </div>
    </NodeShell>
  );
}

export function SubscriberNode({ data, selected }: NodeProps<SubscriberNodeData>) {
  return (
    <NodeShell tone="bg-emerald-400" active={data.isActive}>
      <Handle id="left" type="target" position={Position.Left} className={VISIBLE_SUBSCRIBER_TARGET} />
      <Handle id="top" type="target" position={Position.Top} className={AUX_HANDLE} />
      <Handle id="right" type="source" position={Position.Right} className={VISIBLE_SUBSCRIBER_SOURCE} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={AUX_HANDLE} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-5 text-white">{data.title}</div>
          <div className="text-xs text-emerald-200/80">Receives matching signals</div>
        </div>
        <div className="chip">{data.received.length} received</div>
      </div>
      {data.note ? <div className="rounded-xl bg-white/5 px-3 py-2 text-xs leading-5 text-slate-300">{data.note}</div> : null}
      <div>
        <div className="label">Expression</div>
        <div className="mt-1 truncate rounded-xl bg-white/5 px-3 py-2 font-mono text-xs text-slate-100" title={data.expression}>
          {data.expression}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-slate-300">
        <span className="chip">delivery: {formatDeliveryOptions(data.delivery).split(" • ")[0]}</span>
        <span className="chip">queue depth {data.queueDepth}</span>
      </div>
      <ActivityPreview label={data.activityLabel} value={data.activityValue} tone={data.activityTone} />
      <QueueSummary label={data.queueLabel} items={data.queueItems} />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
        <span className="chip">inbox {data.received.length}</span>
        {selected ? <span className="chip">selected</span> : null}
      </div>
    </NodeShell>
  );
}

export function ConfigNode({ data, selected }: NodeProps<ConfigNodeData>) {
  return (
    <NodeShell tone="bg-violet-400" active={data.isActive}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-5 text-white">{data.title}</div>
          <div className="text-xs text-violet-200/80">Global delivery mechanics</div>
        </div>
        <div className="chip">bus</div>
      </div>
      {data.note ? <div className="rounded-xl bg-white/5 px-3 py-2 text-xs leading-5 text-slate-300">{data.note}</div> : null}
      <div className="grid grid-cols-1 gap-2 text-xs text-slate-200">
        <div className="rounded-xl bg-white/5 px-3 py-2">
          catch-all: <span className="font-semibold">{String(data.allowCatchAll)}</span>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2">
          queue depth: <span className="font-semibold">{data.defaultQueueDepth}</span>
        </div>
        <div className="rounded-xl bg-white/5 px-3 py-2">
          recursion: <span className="font-semibold">{data.recursionPolicy.maxCausationDepth}</span>
        </div>
      </div>
      {selected ? <span className="chip">selected</span> : null}
    </NodeShell>
  );
}

export function ServiceNode({ data, selected }: NodeProps<ServiceNodeData>) {
  return (
    <NodeShell tone="bg-fuchsia-400" active={data.isActive}>
      <Handle id="left" type="target" position={Position.Left} className={VISIBLE_SERVICE_TARGET} />
      <Handle id="top" type="target" position={Position.Top} className={AUX_HANDLE} />
      <Handle id="right" type="source" position={Position.Right} className={VISIBLE_SERVICE_SOURCE} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={AUX_HANDLE} />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-5 text-white">{data.title}</div>
          <div className="text-xs text-fuchsia-200/80">Resolved by address</div>
        </div>
        <div className="chip">service</div>
      </div>
      {data.note ? <div className="rounded-xl bg-white/5 px-3 py-2 text-xs leading-5 text-slate-300">{data.note}</div> : null}
      <div>
        <div className="label">Address</div>
        <div className="mt-1 truncate rounded-xl bg-white/5 px-3 py-2 font-mono text-xs text-slate-100" title={data.address}>
          {data.address}
        </div>
      </div>
      <div className="rounded-xl bg-white/5 px-3 py-2 text-xs text-slate-200">
        {data.serviceName}
      </div>
      <ActivityPreview label={data.activityLabel} value={data.activityValue} tone={data.activityTone} />
      <QueueSummary label={data.queueLabel} items={data.queueItems} />
      {selected ? <span className="chip">selected</span> : null}
    </NodeShell>
  );
}
