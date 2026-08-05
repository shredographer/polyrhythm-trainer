"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

const MIN_SUBDIVISION = 1;
const MAX_SUBDIVISION = 16;
const MIN_BPM = 30;
const MAX_BPM = 240;

type RhythmSide = "left" | "right";
type VisualMode = "flash" | "highway";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function playTone(context: AudioContext, frequency: number, volume = 0.22) {
  if (context.state !== "running") return;

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.095);
}

export default function Trainer() {
  const [bpm, setBpm] = useState(90);
  const [left, setLeft] = useState(1);
  const [right, setRight] = useState(1);
  const [soundReady, setSoundReady] = useState(false);
  const [visualMode, setVisualMode] = useState<VisualMode>("flash");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [pulses, setPulses] = useState({ left: 0, right: 0, leftSync: true, rightSync: true });
  const timing = useRef({ origin: 0, leftStep: -1, rightStep: -1 });
  const values = useRef({ bpm, left, right });
  const audio = useRef<AudioContext | null>(null);
  const soundEnabled = useRef(false);

  useEffect(() => {
    values.current = { bpm, left, right };
  }, [bpm, left, right]);

  useEffect(() => {
    const enableSound = () => {
      const context = audio.current ?? new AudioContext();
      audio.current = context;

      void context.resume().then(() => {
        if (soundEnabled.current) return;
        soundEnabled.current = true;
        setSoundReady(true);
        playTone(context, 261.63, 0.28);
      });
    };

    window.addEventListener("pointerdown", enableSound);
    window.addEventListener("keydown", enableSound);
    return () => {
      window.removeEventListener("pointerdown", enableSound);
      window.removeEventListener("keydown", enableSound);
    };
  }, []);

  useEffect(() => {
    timing.current.origin = performance.now();
    let frame = 0;
    let lastVisualUpdate = 0;

    const tick = (now: number) => {
      const current = values.current;
      const beatLength = 60_000 / current.bpm;
      const measureLength = beatLength * 4;
      const elapsed = now - timing.current.origin;
      if (now - lastVisualUpdate > 32) {
        lastVisualUpdate = now;
        setPlayhead(elapsed);
      }
      const leftStep = Math.floor(elapsed / (measureLength / current.left));
      const rightStep = Math.floor(elapsed / (measureLength / current.right));

      if (leftStep !== timing.current.leftStep || rightStep !== timing.current.rightStep) {
        const leftChanged = leftStep !== timing.current.leftStep;
        const rightChanged = rightStep !== timing.current.rightStep;
        const context = audio.current;
        if (context) {
          if (leftChanged && rightChanged) playTone(context, 261.63);
          else if (leftChanged) playTone(context, 329.63);
          else playTone(context, 392);
        }
        timing.current.leftStep = leftStep;
        timing.current.rightStep = rightStep;
        setPulses((previous) => ({
          left: leftChanged ? previous.left + 1 : previous.left,
          right: rightChanged ? previous.right + 1 : previous.right,
          leftSync: leftChanged ? rightChanged : previous.leftSync,
          rightSync: rightChanged ? leftChanged : previous.rightSync,
        }));
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const changeSubdivision = (side: RhythmSide, amount: number) => {
    const update = (value: number) => clamp(value + amount, MIN_SUBDIVISION, MAX_SUBDIVISION);
    if (side === "left") setLeft(update);
    else setRight(update);
  };

  return (
    <main className={`trainer trainer--${visualMode}`}>
      <section className="rhythms" aria-label="Rhythm subdivisions">
        <RhythmPad
          side="left"
          value={left}
          pulse={pulses.left}
          synchronized={pulses.leftSync}
          visualMode={visualMode}
          playhead={playhead}
          bpm={bpm}
          otherValue={right}
          onChange={(amount) => changeSubdivision("left", amount)}
        />
        <RhythmPad
          side="right"
          value={right}
          pulse={pulses.right}
          synchronized={pulses.rightSync}
          visualMode={visualMode}
          playhead={playhead}
          bpm={bpm}
          otherValue={left}
          onChange={(amount) => changeSubdivision("right", amount)}
        />
        <div className="center-line" aria-hidden="true" />
        {visualMode === "highway" && <div className="shared-hit-line" aria-hidden="true" />}
      </section>

      <Options
        open={optionsOpen}
        visualMode={visualMode}
        onToggle={() => setOptionsOpen((open) => !open)}
        onModeChange={(mode) => {
          setVisualMode(mode);
          setOptionsOpen(false);
        }}
      />

      <TempoControl bpm={bpm} soundReady={soundReady} onChange={setBpm} />
    </main>
  );
}

function RhythmPad({
  side,
  value,
  pulse,
  synchronized,
  visualMode,
  playhead,
  bpm,
  otherValue,
  onChange,
}: {
  side: RhythmSide;
  value: number;
  pulse: number;
  synchronized: boolean;
  visualMode: VisualMode;
  playhead: number;
  bpm: number;
  otherValue: number;
  onChange: (amount: number) => void;
}) {
  const drag = useRef({ y: 0, value: 0 });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, value };
    event.currentTarget.classList.add("is-dragging");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = clamp(
      drag.current.value + Math.round((drag.current.y - event.clientY) / 36),
      MIN_SUBDIVISION,
      MAX_SUBDIVISION,
    );
    onChange(next - value);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("is-dragging");
  };

  return (
    <div
      className={`rhythm-pad rhythm-pad--${side}`}
      role="spinbutton"
      tabIndex={0}
      aria-label={`${side} rhythm subdivision`}
      aria-valuemin={MIN_SUBDIVISION}
      aria-valuemax={MAX_SUBDIVISION}
      aria-valuenow={value}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowRight") onChange(1);
        if (event.key === "ArrowDown" || event.key === "ArrowLeft") onChange(-1);
      }}
    >
      {visualMode === "flash" ? (
        <div className={`flash${synchronized ? " flash--sync" : ""}`} key={pulse} aria-hidden="true" />
      ) : (
        <Highway
          side={side}
          value={value}
          otherValue={otherValue}
          bpm={bpm}
          playhead={playhead}
          pulse={pulse}
          synchronized={synchronized}
        />
      )}
      <span className="pad-label">{side}</span>
      <strong className="rhythm-number">{value}</strong>
      <span className="drag-hint">drag up · down</span>
    </div>
  );
}

function Highway({
  side,
  value,
  otherValue,
  bpm,
  playhead,
  pulse,
  synchronized,
}: {
  side: RhythmSide;
  value: number;
  otherValue: number;
  bpm: number;
  playhead: number;
  pulse: number;
  synchronized: boolean;
}) {
  const measureLength = (60_000 / bpm) * 4;
  const interval = measureLength / value;
  const otherInterval = measureLength / otherValue;
  const travelTime = 2400;
  const firstEvent = Math.ceil(playhead / interval);
  const lastEvent = Math.floor((playhead + travelTime) / interval);
  const notes = [];

  for (let event = firstEvent; event <= lastEvent; event += 1) {
    const eventTime = event * interval;
    const timeUntilHit = eventTime - playhead;
    const top = 82 - (timeUntilHit / travelTime) * 72;
    const otherStep = eventTime / otherInterval;
    const isJoint = Math.abs(otherStep - Math.round(otherStep)) < 0.0001;
    notes.push(
      <span
        className={`highway-note${isJoint ? " highway-note--sync" : ""}`}
        key={event}
        style={{ top: `${top}%` }}
      />,
    );
  }

  return (
    <div className={`highway highway--${side}`} aria-hidden="true">
      <div className="lane-rail lane-rail--left" />
      <div className="lane-rail lane-rail--right" />
      {notes}
      <span className={`hit-burst${synchronized ? " hit-burst--sync" : ""}`} key={pulse} />
    </div>
  );
}

function Options({
  open,
  visualMode,
  onToggle,
  onModeChange,
}: {
  open: boolean;
  visualMode: VisualMode;
  onToggle: () => void;
  onModeChange: (mode: VisualMode) => void;
}) {
  return (
    <div className="options">
      <button
        className="options-button"
        type="button"
        aria-label="Visual options"
        aria-expanded={open}
        onClick={onToggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
        </svg>
      </button>
      {open && (
        <div className="options-panel">
          <span className="options-title">Visual mode</span>
          <div className="mode-picker">
            <button
              type="button"
              className={visualMode === "flash" ? "is-selected" : ""}
              onClick={() => onModeChange("flash")}
            >
              Flash
            </button>
            <button
              type="button"
              className={visualMode === "highway" ? "is-selected" : ""}
              onClick={() => onModeChange("highway")}
            >
              Highway
            </button>
          </div>
          <p>Notes arrive at the line when they sound.</p>
        </div>
      )}
    </div>
  );
}

function TempoControl({
  bpm,
  soundReady,
  onChange,
}: {
  bpm: number;
  soundReady: boolean;
  onChange: (bpm: number) => void;
}) {
  const drag = useRef({ x: 0, bpm: 0 });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, bpm };
    event.currentTarget.classList.add("is-dragging");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onChange(clamp(Math.round(drag.current.bpm + (event.clientX - drag.current.x) / 3), MIN_BPM, MAX_BPM));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.classList.remove("is-dragging");
  };

  return (
    <div
      className="tempo"
      role="slider"
      tabIndex={0}
      aria-label="Tempo"
      aria-valuemin={MIN_BPM}
      aria-valuemax={MAX_BPM}
      aria-valuenow={bpm}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") onChange(clamp(bpm + 1, MIN_BPM, MAX_BPM));
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") onChange(clamp(bpm - 1, MIN_BPM, MAX_BPM));
      }}
    >
      <span className="tempo-direction">slower</span>
      <div className="tempo-readout">
        <strong>{bpm}</strong>
        <span>BPM</span>
      </div>
      <span className="tempo-direction">faster</span>
      <span className="sound-status">{soundReady ? "sound on" : "tap to enable sound"}</span>
      <div className="tempo-track" aria-hidden="true">
        <div className="tempo-fill" style={{ width: `${((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 100}%` }} />
      </div>
    </div>
  );
}
