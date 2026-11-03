# AA55 Frame Rate Statistics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement real-time frame rate (Hz) statistics for AA55 mission payload frames, partitioned by outer payload ID (0xC0~0xC6) and sub-divided for 0xC4 bus sensor devices, displayed in a popover chip on the deicing monitoring panel.

**Architecture:** A sliding 1000ms window tracker in Rust records timestamps of valid AA55 outer frames and 0xC4 sub-device frames, calculating Hz per category. The calculated rates are embedded in `MissionPayloadAggregate` pushed via `mission-payload-event` to the frontend `payloadStore` and rendered in `DeicePanel.vue`.

**Tech Stack:** Rust (Tauri v2), Vue 3, Pinia, TypeScript, Naive UI.

---

### Task 1: Data Model & `PayloadRateTracker` Unit Implementation (TDD)

**Files:**
- Create: `src-tauri/src/protocol/payload/rate_tracker.rs`
- Modify: `src-tauri/src/protocol/payload/mod.rs`
- Test: `src-tauri/src/protocol/payload/rate_tracker.rs` (inline test module)

**Step 1: Write tests for rate calculation and decay**
Verify that adding timestamps computes accurate Hz within 1 second, and decays to 0 after 1 second.

**Step 2: Implement `PayloadFrameRates`, `C4DeviceRates`, and `PayloadRateTracker`**

**Step 3: Run cargo test to verify**
Run: `cargo test --package app --lib protocol::payload::rate_tracker`

---

### Task 2: Integrate `PayloadRateTracker` into Link Manager & Emitter

**Files:**
- Modify: `src-tauri/src/protocol/payload/mod.rs`
- Modify: `src-tauri/src/router/link_manager.rs`
- Modify: `src-tauri/src/router/emitter.rs` (if necessary for tick-level snapshotting)

**Step 1: Record outer frame arrival in `process_payload_frame`**
Call `record_outer(outer.payload_id, now_ms)`.

**Step 2: Record 0xC4 sub-device arrivals in `feed_payload`**
Call `record_c4(dev_id, now_ms)` for valid frames 0x01~0x07.

**Step 3: Snapshot rates into `MissionPayloadAggregate` before push**

**Step 4: Verify with integration tests**
Run: `cargo test --package app`

---

### Task 3: Update Frontend Pinia Store & TypeScript Types

**Files:**
- Modify: `src/store/payloadStore.ts`
- Modify: `src/composables/useDeiceMonitor.ts` (if relevant)

**Step 1: Define `PayloadFrameRates` and `C4DeviceRates` interfaces**

**Step 2: Expose computed getters in `payloadStore`**
- `aa55TotalRate`: Formatted string for total Hz.
- `aa55Rates`: Raw/formatted breakdown for popover.

---

### Task 4: Implement DeicePanel UI Top Bar Popover & Chip

**Files:**
- Modify: `src/components/DeicePanel.vue`
- Modify: `src/components/deice/dashboard.css`

**Step 1: Add AA55 frame rate chip in `header-chips`**
Show `AA55 帧频 · X.X Hz`.

**Step 2: Attach `n-popover` with styled breakdown table**
Show outer payload items (0xC0~0xC6) and indented 0xC4 device items (0x01~0x07) with realtime Hz.

---

### Task 5: End-to-End Verification

**Step 1: Run Rust unit and integration tests**
`cargo test`

**Step 2: Run frontend type checks and tests**
`pnpm run test` or `pnpm exec vue-tsc --noEmit`
