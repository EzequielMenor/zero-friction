# Voice Capture Auto-Send Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After voice transcription completes, show a dynamic countdown (3–10s based on transcription length) with a visual progress ring, then auto-submit. Any user interaction (typing, tapping, touching the textarea) cancels the countdown and switches to manual edit+send mode.

**Current behavior:**
- `CaptureOverlay.tsx` records audio via `MediaRecorder`, sends to `/api/capture?transcribeOnly=true`
- On successful transcription, immediately calls `submit({ triggerProcess: true })` — **zero delay, no countdown, no escape hatch**
- The current `ponytail:` comment at line 204-205 explicitly called this out: "No more manual countdown — the transcription is the input, send it"
- The entire flow is contained within `CaptureOverlay.tsx`

**Spec (§3.2) requirements:**
1. Dynamic countdown: 3s for short notes (1-5 words), 8-10s for long notes (multiple sentences)
2. Visual progress ring indicating remaining time
3. Escape hatch: any touch/keyboard/text interaction cancels auto-send, switches to manual mode

**Architecture:** Single React client component (`CaptureOverlay.tsx`). All state is local (`useState` + `useRef`). No state lib, no animation lib. The timer and progress ring must be self-contained.

---

## Proposed Approach

### Dynamic timer logic

Formula: `max(3, min(10, wordCount * 0.8))` seconds.
- 1-5 words → ~3-4s (rounded to nearest int, clamped to min 3)
- 10 words → 8s
- 12+ words → 10s (clamped)

### Progress ring

SVG circle with `stroke-dasharray` + `stroke-dashoffset` animated via `requestAnimationFrame` or a simple `setInterval` tick. No animation library needed — native CSS `transition: stroke-dashoffset 1s linear` or manual recalculation each tick.

### Escape hatch

Listen on the textarea for `onChange`, `onFocus`, `onKeyDown`. Also listen on the overlay container for `onPointerDown`. Any of these:
1. Clear the timer interval
2. Remove the countdown state
3. Keep the overlay open in edit mode (user can review/fix transcription before manual send)
4. The submit button becomes active for manual send

### State machine

```
IDLE → transcription done → COUNTDOWN (show ring + timer)
                              ↓ user interaction → MANUAL (no ring, edit mode, manual send button)
                              ↓ timer expires → submit() → CLOSED
MANUAL → user clicks send → submit() → CLOSED
```

### Implementation containment

Everything in `CaptureOverlay.tsx` plus a small `ProgressRing` subcomponent (inline SVG, same pattern as existing `Chip`, `Spinner`, `MicIcon`). No new files needed.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `components/CaptureOverlay.tsx` | Modify | Add timer state, progress ring, escape hatch logic |
| (none) | | Everything self-contained in this one file |

---

## Implementation Tasks

### Task 1: Add Timer State and Constants
- [ ] Add state: `countdownActive: boolean`, `countdownRemaining: number`, `countdownTotal: number`
- [ ] Add ref for interval ID: `countdownIntervalRef`
- [ ] Add helper `calcCountdownDuration(text: string): number` — word count → 3-10s clamping

### Task 2: ProgressRing Subcomponent
- [ ] Create inline `ProgressRing` function component (same pattern as existing icons):
  - Props: `size`, `progress` (0-1), `strokeWidth`, `className`
  - SVG circle with `strokeDasharray = circumference`, `strokeDashoffset = circumference * (1 - progress)`
  - CSS transition on `strokeDashoffset` for smooth animation
  - Same styling as the app's design system (stroke: `#A68966` gold)

### Task 3: Countdown Flow (triggered after transcription)
- [ ] In the `onstop` handler of `MediaRecorder` (where transcription result is received), instead of immediately calling `submit()`, start the countdown
- [ ] Calculate duration, set `countdownTotal` and `countdownRemaining`
- [ ] Set `countdownActive: true`
- [ ] Start interval (every 100ms) that decrements remaining time
- [ ] When remaining <= 0: clear interval, call `submit({ triggerProcess: true })`, clear countdown state

### Task 4: Visual Countdown UI
- [ ] When `countdownActive`, show the `ProgressRing` in the action bar (between mic and send buttons)
- [ ] Show remaining seconds as text inside or next to the ring (e.g., "Enviando en 5...")
- [ ] Add a subtle animation: ring color from gold → red as time decreases (optional, can be ponytail'd to single color)
- [ ] Show a "Cancelar" text/button near the ring (tap to cancel)
- [ ] Disable the send button during countdown (auto-mode)

### Task 5: Escape Hatch — Cancel Countdown
- [ ] On textarea `onChange`: if `countdownActive`, clear interval, set `countdownActive: false`, keep overlay open
- [ ] On textarea `onFocus`: same
- [ ] On "Cancelar" tap: same
- [ ] User can now edit transcription freely, then click send manually (manual submit via existing button)
- [ ] The "Send" button becomes active again once countdown is cancelled

### Task 6: Adjust Submit Behavior
- [ ] When countdown is cancelled (user takes control), the submit button should work normally — it already does via existing `submit()` call
- [ ] Add a small visual hint when in manual mode after auto-send was cancelled (e.g., "Envío manual" text)

---

## UX Risk: Accidental Auto-Send

**Risk:** The transcription might be wrong (whisper hallucination, background noise), and auto-send submits garbage.

**Mitigations:**
1. **Escape hatch overrides everything** — any touch/keystroke cancels. The user has the entire countdown duration to react.
2. **Timer is dynamic** — longer transcriptions get more time to review (up to 10s).
3. **"Cancelar" button** — visible escape next to the progress ring.
4. **Post-send recovery** — if auto-sent, the user can always delete from the hub. This is existing behavior.

This risk is acceptable for a personal single-user app. If it becomes a real pain point, add a 1s confirmation delay or an undo toast.

---

## Non-goals / Out of Scope

- ❌ Pause/resume countdown
- ❌ Audio playback of the recording before send
- ❌ Configurable timer durations (hardcode the formula; can expose settings later)
- ❌ Haptic feedback on countdown end
- ❌ Animation library for ring (pure SVG is sufficient)

## Effort: Small (~1 session, ~80-100 lines added to existing file)

| Task | Lines (added to CaptureOverlay.tsx) | Complexity |
|---|---|---|
| Timer state + calc | ~20 | Low |
| ProgressRing component | ~25 | Low |
| Countdown flow in onstop | ~20 | Medium |
| Visual UI changes | ~20 | Low |
| Escape hatch wiring | ~15 | Low |
| **Total** | **~100 lines** | |

## Self-Review

- ✅ Dynamic timer: 3s min, 10s max, proportional to word count
- ✅ SVG progress ring (no animation lib, matches existing pattern)
- ✅ Escape hatch: textarea change/focus, cancel button, any interaction
- ✅ All changes contained in `CaptureOverlay.tsx` (plus `ProgressRing` inline)
- ✅ Zero new dependencies
- ✅ Manual mode after escape: user edits text, clicks send normally
- ⚠️ UX risk of accidental auto-send documented with mitigations
- 🐴 Ponytail: no animation library, no config UI, no settings persistence
