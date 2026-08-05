"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

const MIN_SUBDIVISION = 1;
const MAX_SUBDIVISION = 16;
const MIN_BPM = 30;
const MAX_BPM = 240;

type RhythmSide = "left" | "right";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function Trainer() {
  const [bpm, setBpm] = useState(90);
  const [left, setLeft] = useState(1);
  const [right, setRight] = useState(1);
  const [soundReady, setSoundReady] = useState(false);
  const [pulses, setPulses] = useState({ left: 0, right: 0, leftSync: true, rightSync: true });
  const timing = useRef({ origin: 0, leftStep: -1, rightStep: -1 });
  const values = useRef({ bpm, left, right });
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    values.current = { bpm, left, right };
  }, [bpm, left, right]);

  useEffect(() => {
    const enableSound = () => {
      if (!audio.current) audio.current = new AudioContext();
      void audio.current.resume();
      setSoundReady(true);
    };

    window.addEventListener("pointerdown", enableSound, { once: true });
    window.addEventListener("keydown", enableSound, { once: true });
    return () => {
      window.removeEventListener("pointerdown", enableSound);
      window.removeEventListener("keydown", enableSound);
    };
  }, []);

  const playNote = (frequency: number) => {
    const context = audio.current;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.095);
  };

  useEffect(() => {
    timing.current.origin = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const current = values.current;
      const beatLength = 60_000 / current.bpm;
      const measureLength = beatLength * 4;
      const elapsed = now - timing.current.origin;
      const leftStep = Math.floor(elapsed / (measureLength / current.left));
      const rightStep = Math.floor(elapsed / (measureLength / current.right));

      if (leftStep !== timing.current.leftStep || rightStep !== timing.current.rightStep) {
        const leftChanged = leftStep !== timing.current.leftStep;
        const rightChanged = rightStep !== timing.current.rightStep;
        if (leftChanged && rightChanged) playNote(261.63);
        else if (leftChanged) playNote(329.63);
        else playNote(392);
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
    <main className="trainer">
      <section className="rhythms" aria-label="Rhythm subdivisions">
        <RhythmPad
          side="left"
          value={left}
          pulse={pulses.left}
          synchronized={pulses.leftSync}
          onChange={(amount) => changeSubdivision("left", amount)}
        />
        <RhythmPad
          side="right"
          value={right}
          pulse={pulses.right}
          synchronized={pulses.rightSync}
          onChange={(amount) => changeSubdivision("right", amount)}
        />
        <div className="center-line" aria-hidden="true" />
      </section>

      <TempoControl bpm={bpm} soundReady={soundReady} onChange={setBpm} />
    </main>
  );
}

function RhythmPad({
  side,
  value,
  pulse,
  synchronized,
  onChange,
}: {
  side: RhythmSide;
  value: number;
  pulse: number;
  synchronized: boolean;
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
      <div className={`flash${synchronized ? " flash--sync" : ""}`} key={pulse} aria-hidden="true" />
      <span className="pad-label">{side}</span>
      <strong className="rhythm-number">{value}</strong>
      <span className="drag-hint">drag up · down</span>
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
