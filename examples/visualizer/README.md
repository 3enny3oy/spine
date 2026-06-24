# SPINE Visualizer

This example is a standalone Vite app that demonstrates SPINE-style routing semantics with a live canvas.

## Run

```bash
cd examples/visualizer
pnpm install
pnpm dev
```

## What it shows

- A publisher node that emits a payload to an address
- Subscriber nodes with configurable expressions and delivery options
- A bus config node with catch-all and recursion controls
- React Flow routes that appear when a publisher address matches a subscriber expression
- A live trace panel showing payloads accepted or dropped per subscriber

The example is browser-local and does not require a Rust backend.

