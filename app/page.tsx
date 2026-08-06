"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";

const MIN_SUBDIVISION = 1;
const MAX_SUBDIVISION = 16;
const MIN_BPM = 30;
const MAX_BPM = 240;
const SETTINGS_KEY = "polyrhythm-trainer-settings";

type RhythmSide = "left" | "right";
type Screen = "live" | "pattern";
type PatternStep = { id: string; left: number; right: number; measures: number };
type PatternPreset = { name: string; steps: Omit<PatternStep, "id">[] };
type VisualMode =
  | "flash"
  | "highway"
  | "orbit"
  | "rings"
  | "grid"
  | "pendulums"
  | "ripples"
  | "radial"
  | "particles"
  | "blocks"
  | "lissajous"
  | "metaballs";

const VISUAL_MODES: { id: VisualMode; label: string; group: "Learn" | "Follow" | "Feel" }[] = [
  { id: "grid", label: "Step grid", group: "Learn" },
  { id: "blocks", label: "Blocks", group: "Learn" },
  { id: "flash", label: "Flash", group: "Follow" },
  { id: "highway", label: "Highway", group: "Follow" },
  { id: "pendulums", label: "Pendulums", group: "Follow" },
  { id: "orbit", label: "Orbit", group: "Feel" },
  { id: "rings", label: "Pulse rings", group: "Feel" },
  { id: "ripples", label: "Ripples", group: "Feel" },
  { id: "radial", label: "Radial clock", group: "Feel" },
  { id: "particles", label: "Particles", group: "Feel" },
  { id: "lissajous", label: "Lissajous", group: "Feel" },
  { id: "metaballs", label: "Metaballs", group: "Feel" },
];

const PATTERN_PRESETS: PatternPreset[] = [
  {
    name: "Foundations",
    steps: [
      { left: 2, right: 3, measures: 2 },
      { left: 3, right: 4, measures: 2 },
      { left: 4, right: 5, measures: 2 },
    ],
  },
  {
    name: "Odd ladder",
    steps: [
      { left: 3, right: 2, measures: 1 },
      { left: 5, right: 4, measures: 1 },
      { left: 7, right: 4, measures: 1 },
      { left: 9, right: 8, measures: 1 },
    ],
  },
  {
    name: "Mirror",
    steps: [
      { left: 3, right: 4, measures: 2 },
      { left: 4, right: 3, measures: 2 },
      { left: 5, right: 6, measures: 2 },
      { left: 6, right: 5, measures: 2 },
    ],
  },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createStepId() {
  return crypto.randomUUID();
}

function randomInteger(minimum: number, maximum: number) {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] / 4_294_967_296;
  return minimum + Math.floor(value * (maximum - minimum + 1));
}

function createRandomPattern(): PatternStep[] {
  return Array.from({ length: randomInteger(3, 6) }, () => {
    const left = randomInteger(2, 9);
    let right = randomInteger(2, 9);
    if (right === left) right = right === 9 ? 2 : right + 1;
    return { id: createStepId(), left, right, measures: randomInteger(1, 2) };
  });
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
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [visualMode, setVisualMode] = useState<VisualMode>("flash");
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>("live");
  const [pattern, setPattern] = useState<PatternStep[]>([
    { id: "step-1", left: 7, right: 4, measures: 1 },
    { id: "step-2", left: 3, right: 2, measures: 2 },
    { id: "step-3", left: 6, right: 8, measures: 1 },
  ]);
  const [patternPlaying, setPatternPlaying] = useState(false);
  const [loopPattern, setLoopPattern] = useState(true);
  const [haptics, setHaptics] = useState(false);
  const [beatReference, setBeatReference] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [activeMeasure, setActiveMeasure] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [pulses, setPulses] = useState({ left: 0, right: 0, leftSync: true, rightSync: true });
  const timing = useRef({ origin: 0, leftStep: -1, rightStep: -1, referenceStep: -1, measureIndex: -1 });
  const values = useRef({ bpm, left, right });
  const patternRef = useRef(pattern);
  const patternPlayingRef = useRef(false);
  const loopPatternRef = useRef(loopPattern);
  const screenRef = useRef<Screen>(screen);
  const hapticsRef = useRef(haptics);
  const beatReferenceRef = useRef(beatReference);
  const audio = useRef<AudioContext | null>(null);
  const soundEnabled = useRef(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
          const settings = JSON.parse(saved) as Partial<{
            bpm: number;
            left: number;
            right: number;
            visualMode: VisualMode;
            pattern: PatternStep[];
            loopPattern: boolean;
            haptics: boolean;
            beatReference: boolean;
          }>;
          if (typeof settings.bpm === "number") setBpm(clamp(Math.round(settings.bpm), MIN_BPM, MAX_BPM));
          if (typeof settings.left === "number") {
            setLeft(clamp(Math.round(settings.left), MIN_SUBDIVISION, MAX_SUBDIVISION));
          }
          if (typeof settings.right === "number") {
            setRight(clamp(Math.round(settings.right), MIN_SUBDIVISION, MAX_SUBDIVISION));
          }
          if (VISUAL_MODES.some((mode) => mode.id === settings.visualMode)) {
            setVisualMode(settings.visualMode as VisualMode);
          }
          if (Array.isArray(settings.pattern)) {
            const validPattern = settings.pattern
              .filter((step) => step && typeof step === "object")
              .map((step, index) => ({
                id: typeof step.id === "string" ? step.id : `step-${index + 1}`,
                left: clamp(Math.round(Number(step.left) || 1), MIN_SUBDIVISION, MAX_SUBDIVISION),
                right: clamp(Math.round(Number(step.right) || 1), MIN_SUBDIVISION, MAX_SUBDIVISION),
                measures: clamp(Math.round(Number(step.measures) || 1), 1, 16),
              }));
            if (validPattern.length) setPattern(validPattern);
          }
          if (typeof settings.loopPattern === "boolean") setLoopPattern(settings.loopPattern);
          if (typeof settings.haptics === "boolean") setHaptics(settings.haptics);
          if (typeof settings.beatReference === "boolean") setBeatReference(settings.beatReference);
        }
      } catch {
        localStorage.removeItem(SETTINGS_KEY);
      } finally {
        setSettingsLoaded(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ bpm, left, right, visualMode, pattern, loopPattern, haptics, beatReference }),
    );
  }, [bpm, left, right, visualMode, pattern, loopPattern, haptics, beatReference, settingsLoaded]);

  useEffect(() => {
    const step = pattern[activeStep];
    values.current = {
      bpm,
      left: patternPlaying && step ? step.left : left,
      right: patternPlaying && step ? step.right : right,
    };
    patternRef.current = pattern;
    patternPlayingRef.current = patternPlaying;
    loopPatternRef.current = loopPattern;
    screenRef.current = screen;
    hapticsRef.current = haptics;
    beatReferenceRef.current = beatReference;
  }, [bpm, left, right, pattern, patternPlaying, loopPattern, screen, activeStep, haptics, beatReference]);

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
      let current = values.current;
      const beatLength = 60_000 / current.bpm;
      const measureLength = beatLength * 4;
      const elapsed = now - timing.current.origin;
      const measureIndex = Math.floor(elapsed / measureLength);

      if (patternPlayingRef.current && measureIndex !== timing.current.measureIndex) {
        timing.current.measureIndex = measureIndex;
        const sequence = patternRef.current;
        const totalMeasures = sequence.reduce((total, step) => total + step.measures, 0);
        if (!loopPatternRef.current && measureIndex >= totalMeasures) {
          patternPlayingRef.current = false;
          setPatternPlaying(false);
        } else {
          let remaining = totalMeasures ? measureIndex % totalMeasures : 0;
          let nextStep = 0;
          while (nextStep < sequence.length - 1 && remaining >= sequence[nextStep].measures) {
            remaining -= sequence[nextStep].measures;
            nextStep += 1;
          }
          const step = sequence[nextStep];
          if (step) {
            setActiveStep(nextStep);
            setActiveMeasure(remaining);
            current = { bpm: current.bpm, left: step.left, right: step.right };
            values.current = current;
          }
        }
      }
      if (now - lastVisualUpdate > 32) {
        lastVisualUpdate = now;
        setPlayhead(elapsed);
      }
      const leftStep = Math.floor(elapsed / (measureLength / current.left));
      const rightStep = Math.floor(elapsed / (measureLength / current.right));
      const referenceStep = Math.floor(elapsed / beatLength);
      const rhythmActive = screenRef.current === "live" || patternPlayingRef.current;

      if (rhythmActive && beatReferenceRef.current && referenceStep !== timing.current.referenceStep) {
        timing.current.referenceStep = referenceStep;
        const context = audio.current;
        if (context) playTone(context, 196, 0.07);
      }

      if (rhythmActive && (leftStep !== timing.current.leftStep || rightStep !== timing.current.rightStep)) {
        const leftChanged = leftStep !== timing.current.leftStep;
        const rightChanged = rightStep !== timing.current.rightStep;
        const context = audio.current;
        if (context) {
          if (leftChanged && rightChanged) playTone(context, 261.63);
          else if (leftChanged) playTone(context, 329.63);
          else playTone(context, 392);
        }
        if (hapticsRef.current && "vibrate" in navigator) {
          navigator.vibrate(leftChanged && rightChanged ? 22 : 12);
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

  const startPattern = () => {
    if (!pattern.length) return;
    const first = pattern[0];
    patternPlayingRef.current = true;
    values.current = { bpm, left: first.left, right: first.right };
    timing.current = {
      origin: performance.now(),
      leftStep: -1,
      rightStep: -1,
      referenceStep: -1,
      measureIndex: -1,
    };
    setPlayhead(0);
    setActiveStep(0);
    setActiveMeasure(0);
    setPatternPlaying(true);
  };

  const stopPattern = () => {
    patternPlayingRef.current = false;
    setPatternPlaying(false);
  };

  const displayStep = pattern[activeStep];
  const displayLeft = patternPlaying && displayStep ? displayStep.left : left;
  const displayRight = patternPlaying && displayStep ? displayStep.right : right;

  return (
    <main className={`trainer trainer--${visualMode}`}>
      <ScreenSwitch
        screen={screen}
        onChange={(next) => {
          if (next === "live") stopPattern();
          setScreen(next);
        }}
      />
      {screen === "pattern" && !patternPlaying ? (
        <PatternBuilder
          pattern={pattern}
          loop={loopPattern}
          onPatternChange={setPattern}
          onLoopChange={setLoopPattern}
          onPlay={startPattern}
        />
      ) : (
      <section className="rhythms" aria-label="Rhythm subdivisions">
        <RhythmPad
          side="left"
          value={displayLeft}
          pulse={pulses.left}
          synchronized={pulses.leftSync}
          visualMode={visualMode}
          playhead={playhead}
          bpm={bpm}
          otherValue={displayRight}
          onChange={(amount) => !patternPlaying && changeSubdivision("left", amount)}
        />
        <RhythmPad
          side="right"
          value={displayRight}
          pulse={pulses.right}
          synchronized={pulses.rightSync}
          visualMode={visualMode}
          playhead={playhead}
          bpm={bpm}
          otherValue={displayLeft}
          onChange={(amount) => !patternPlaying && changeSubdivision("right", amount)}
        />
        <div className="center-line" aria-hidden="true" />
        {visualMode === "highway" && <div className="shared-hit-line" aria-hidden="true" />}
        {!(["flash", "highway"] as VisualMode[]).includes(visualMode) && (
          <VisualStage
            mode={visualMode}
            left={displayLeft}
            right={displayRight}
            bpm={bpm}
            playhead={playhead}
            pulses={pulses}
          />
        )}
        {patternPlaying && displayStep && (
          <PatternNowPlaying
            pattern={pattern}
            activeStep={activeStep}
            activeMeasure={activeMeasure}
            onStop={stopPattern}
          />
        )}
      </section>
      )}

      <Options
        open={optionsOpen}
        visualMode={visualMode}
        haptics={haptics}
        beatReference={beatReference}
        onToggle={() => setOptionsOpen((open) => !open)}
        onModeChange={(mode) => {
          setVisualMode(mode);
          setOptionsOpen(false);
        }}
        onHapticsChange={setHaptics}
        onBeatReferenceChange={setBeatReference}
      />

      <TempoControl bpm={bpm} soundReady={soundReady} onChange={setBpm} />
    </main>
  );
}

function ScreenSwitch({ screen, onChange }: { screen: Screen; onChange: (screen: Screen) => void }) {
  return (
    <nav className="screen-switch" aria-label="Trainer screen">
      <button type="button" className={screen === "live" ? "is-active" : ""} onClick={() => onChange("live")}>Live</button>
      <button type="button" className={screen === "pattern" ? "is-active" : ""} onClick={() => onChange("pattern")}>Pattern</button>
    </nav>
  );
}

function PatternBuilder({
  pattern,
  loop,
  onPatternChange,
  onLoopChange,
  onPlay,
}: {
  pattern: PatternStep[];
  loop: boolean;
  onPatternChange: React.Dispatch<React.SetStateAction<PatternStep[]>>;
  onLoopChange: (loop: boolean) => void;
  onPlay: () => void;
}) {
  const draggedStep = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateStep = (index: number, field: "left" | "right" | "measures", amount: number) => {
    onPatternChange(pattern.map((step, stepIndex) => {
      if (stepIndex !== index) return step;
      const maximum = field === "measures" ? 16 : MAX_SUBDIVISION;
      return { ...step, [field]: clamp(step[field] + amount, 1, maximum) };
    }));
  };

  const startReorder = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedStep.current = id;
    setDraggingId(id);
  };

  const reorderAtPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const sourceId = draggedStep.current;
    if (!sourceId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-step-id]");
    const targetId = target?.dataset.stepId;
    if (!targetId || targetId === sourceId) return;
    onPatternChange((current) => {
      const sourceIndex = current.findIndex((step) => step.id === sourceId);
      const targetIndex = current.findIndex((step) => step.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const endReorder = () => {
    draggedStep.current = null;
    setDraggingId(null);
  };

  const applyPreset = (preset: PatternPreset) => {
    onPatternChange(preset.steps.map((step) => ({ ...step, id: createStepId() })));
  };

  const randomize = () => {
    onPatternChange(createRandomPattern());
  };

  return (
    <section className="pattern-builder" aria-label="Pattern builder">
      <header className="builder-header">
        <div>
          <span>Sequence</span>
          <h1>Build a pattern</h1>
        </div>
        <button className="play-pattern" type="button" onClick={onPlay} disabled={!pattern.length}>
          <span>▶</span> Play
        </button>
      </header>

      <div className="pattern-tools">
        <span>Presets</span>
        <div>
          {PATTERN_PRESETS.map((preset) => (
            <button type="button" key={preset.name} onClick={() => applyPreset(preset)}>{preset.name}</button>
          ))}
          <button className="random-pattern" type="button" onClick={randomize}>↝ Random</button>
        </div>
      </div>

      <div className="pattern-list">
        {pattern.map((step, index) => (
          <article
            className={`pattern-card${draggingId === step.id ? " is-reordering" : ""}`}
            data-step-id={step.id}
            key={step.id}
          >
            <span className="step-index">{String(index + 1).padStart(2, "0")}</span>
            <RatioEditor label="Left" value={step.left} onChange={(amount) => updateStep(index, "left", amount)} />
            <span className="ratio-colon">:</span>
            <RatioEditor label="Right" value={step.right} onChange={(amount) => updateStep(index, "right", amount)} />
            <div className="measure-editor">
              <span>{step.measures === 1 ? "measure" : "measures"}</span>
              <div>
                <button type="button" aria-label="Remove a measure" onClick={() => updateStep(index, "measures", -1)}>−</button>
                <strong>{step.measures}</strong>
                <button type="button" aria-label="Add a measure" onClick={() => updateStep(index, "measures", 1)}>+</button>
              </div>
            </div>
            <div className="step-actions">
              <button
                className="drag-handle"
                type="button"
                aria-label="Drag to reorder step"
                onPointerDown={(event) => startReorder(event, step.id)}
                onPointerMove={reorderAtPointer}
                onPointerUp={endReorder}
                onPointerCancel={endReorder}
              >⠿</button>
              <button
                type="button"
                aria-label="Duplicate step"
                onClick={() => onPatternChange([
                  ...pattern.slice(0, index + 1),
                  { ...step, id: createStepId() },
                  ...pattern.slice(index + 1),
                ])}
              >⧉</button>
              <button type="button" aria-label="Delete step" disabled={pattern.length === 1} onClick={() => onPatternChange(pattern.filter((_, item) => item !== index))}>×</button>
            </div>
          </article>
        ))}
      </div>

      <footer className="builder-footer">
        <button
          className="add-step"
          type="button"
          onClick={() => onPatternChange([...pattern, { id: createStepId(), left: 3, right: 4, measures: 1 }])}
        >
          + Add rhythm
        </button>
        <label className="loop-control">
          <input type="checkbox" checked={loop} onChange={(event) => onLoopChange(event.target.checked)} />
          <span>Loop pattern</span>
        </label>
      </footer>
    </section>
  );
}

function RatioEditor({ label, value, onChange }: { label: string; value: number; onChange: (amount: number) => void }) {
  return (
    <div className="ratio-editor">
      <span>{label}</span>
      <div>
        <button type="button" aria-label={`Decrease ${label}`} onClick={() => onChange(-1)}>−</button>
        <strong>{value}</strong>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => onChange(1)}>+</button>
      </div>
    </div>
  );
}

function PatternNowPlaying({
  pattern,
  activeStep,
  activeMeasure,
  onStop,
}: {
  pattern: PatternStep[];
  activeStep: number;
  activeMeasure: number;
  onStop: () => void;
}) {
  return (
    <div className="pattern-now-playing">
      <button type="button" onClick={onStop} aria-label="Stop pattern">■</button>
      <div className="sequence-strip">
        {pattern.map((step, index) => (
          <span className={index === activeStep ? "is-active" : index < activeStep ? "is-complete" : ""} key={step.id}>
            {step.left}:{step.right}
            {index === activeStep && <small>{activeMeasure + 1}/{step.measures}</small>}
          </span>
        ))}
      </div>
    </div>
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
      ) : visualMode === "highway" ? (
        <Highway
          side={side}
          value={value}
          otherValue={otherValue}
          bpm={bpm}
          playhead={playhead}
          pulse={pulse}
          synchronized={synchronized}
        />
      ) : null}
      <span className="pad-label">{side}</span>
      <strong className="rhythm-number">{value}</strong>
      <span className="drag-hint">drag up · down</span>
    </div>
  );
}

function VisualStage({
  mode,
  left,
  right,
  bpm,
  playhead,
  pulses,
}: {
  mode: VisualMode;
  left: number;
  right: number;
  bpm: number;
  playhead: number;
  pulses: { left: number; right: number; leftSync: boolean; rightSync: boolean };
}) {
  const measureLength = (60_000 / bpm) * 4;
  const phase = (playhead % measureLength) / measureLength;
  const leftStep = Math.floor(phase * left);
  const rightStep = Math.floor(phase * right);
  const leftMarks = Array.from({ length: left });
  const rightMarks = Array.from({ length: right });

  return (
    <div className={`visual-stage visual-stage--${mode}`} aria-hidden="true">
      <div className="measure-progress" style={{ transform: `scaleX(${phase})` }} />

      {mode === "orbit" && (
        <div className="orbit-system">
          <div className="orbit orbit--left">
            <span style={{ transform: `rotate(${phase * left * 360}deg)` }}><i /></span>
          </div>
          <div className="orbit orbit--right">
            <span style={{ transform: `rotate(${phase * right * 360}deg)` }}><i /></span>
          </div>
          <b className="orbit-marker" />
        </div>
      )}

      {mode === "rings" && (
        <div className="split-effect">
          <span className={`pulse-ring pulse-ring--left${pulses.leftSync ? " is-sync" : ""}`} key={`l${pulses.left}`} />
          <span className={`pulse-ring pulse-ring--right${pulses.rightSync ? " is-sync" : ""}`} key={`r${pulses.right}`} />
        </div>
      )}

      {mode === "grid" && (
        <div className="step-grid">
          <MarkerRow marks={leftMarks} active={leftStep} side="left" />
          <MarkerRow marks={rightMarks} active={rightStep} side="right" />
          <span className="grid-playhead" style={{ left: `${phase * 100}%` }} />
        </div>
      )}

      {mode === "pendulums" && (
        <div className="pendulum-system">
          <Pendulum side="left" angle={Math.sin(phase * left * Math.PI * 2) * 38} pulse={pulses.left} />
          <Pendulum side="right" angle={Math.sin(phase * right * Math.PI * 2) * 38} pulse={pulses.right} />
        </div>
      )}

      {mode === "ripples" && (
        <div className="split-effect ripple-field">
          <span className={`ripple ripple--left${pulses.leftSync ? " is-sync" : ""}`} key={`l${pulses.left}`} />
          <span className={`ripple ripple--right${pulses.rightSync ? " is-sync" : ""}`} key={`r${pulses.right}`} />
        </div>
      )}

      {mode === "radial" && (
        <div className="radial-clock">
          {[...leftMarks, ...rightMarks].map((_, index) => {
            const isLeft = index < left;
            const count = isLeft ? left : right;
            const item = isLeft ? index : index - left;
            return (
              <i
                className={isLeft ? "radial-mark radial-mark--left" : "radial-mark radial-mark--right"}
                key={`${isLeft ? "l" : "r"}${item}`}
                style={{
                  transform: `rotate(${(item / count) * 360}deg) translateY(${
                    isLeft ? "calc(-1 * min(17vh, 17vw))" : "calc(-1 * min(22vh, 22vw))"
                  })`,
                }}
              />
            );
          })}
          <span className="clock-hand" style={{ transform: `rotate(${phase * 360}deg)` }} />
          <b />
        </div>
      )}

      {mode === "particles" && (
        <div className="split-effect particle-field">
          <ParticleBurst side="left" pulse={pulses.left} sync={pulses.leftSync} />
          <ParticleBurst side="right" pulse={pulses.right} sync={pulses.rightSync} />
        </div>
      )}

      {mode === "blocks" && (
        <div className="block-system">
          <BlockRow marks={leftMarks} active={leftStep} side="left" />
          <BlockRow marks={rightMarks} active={rightStep} side="right" />
        </div>
      )}

      {mode === "lissajous" && <Lissajous left={left} right={right} phase={phase} />}

      {mode === "metaballs" && (
        <div className="metaball-field">
          <span className="metaball metaball--left" style={{ transform: `translate(${Math.sin(phase * left * Math.PI * 2) * 22}vw, ${Math.cos(phase * left * Math.PI * 2) * 14}vh)` }} />
          <span className="metaball metaball--right" style={{ transform: `translate(${Math.sin(phase * right * Math.PI * 2) * -22}vw, ${Math.cos(phase * right * Math.PI * 2) * -14}vh)` }} />
        </div>
      )}
    </div>
  );
}

function MarkerRow({ marks, active, side }: { marks: unknown[]; active: number; side: RhythmSide }) {
  return (
    <div className={`marker-row marker-row--${side}`}>
      {marks.map((_, index) => <span className={index === active ? "is-active" : ""} key={index}>{index + 1}</span>)}
    </div>
  );
}

function BlockRow({ marks, active, side }: { marks: unknown[]; active: number; side: RhythmSide }) {
  return (
    <div className={`block-row block-row--${side}`}>
      {marks.map((_, index) => <span className={index === active ? "is-active" : ""} key={index} />)}
    </div>
  );
}

function Pendulum({ side, angle, pulse }: { side: RhythmSide; angle: number; pulse: number }) {
  return (
    <div className={`pendulum pendulum--${side}`} style={{ transform: `rotate(${angle}deg)` }}>
      <span /><i key={pulse} />
    </div>
  );
}

function ParticleBurst({ side, pulse, sync }: { side: RhythmSide; pulse: number; sync: boolean }) {
  return (
    <div className={`particles particles--${side}${sync ? " is-sync" : ""}`} key={pulse}>
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} style={{ "--particle": index } as React.CSSProperties} />
      ))}
    </div>
  );
}

function Lissajous({ left, right, phase }: { left: number; right: number; phase: number }) {
  const points = Array.from({ length: 181 }, (_, index) => {
    const t = (index / 180) * Math.PI * 2;
    return `${50 + Math.sin(left * t) * 39},${50 + Math.sin(right * t + Math.PI / 2) * 39}`;
  }).join(" ");
  const angle = phase * Math.PI * 2;
  const x = 50 + Math.sin(left * angle) * 39;
  const y = 50 + Math.sin(right * angle + Math.PI / 2) * 39;
  return (
    <svg className="lissajous" viewBox="0 0 100 100">
      <polyline points={points} />
      <circle cx={x} cy={y} r="2.2" />
    </svg>
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
  haptics,
  beatReference,
  onToggle,
  onModeChange,
  onHapticsChange,
  onBeatReferenceChange,
}: {
  open: boolean;
  visualMode: VisualMode;
  haptics: boolean;
  beatReference: boolean;
  onToggle: () => void;
  onModeChange: (mode: VisualMode) => void;
  onHapticsChange: (enabled: boolean) => void;
  onBeatReferenceChange: (enabled: boolean) => void;
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
          {(["Learn", "Follow", "Feel"] as const).map((group) => (
            <div className="mode-group" key={group}>
              <span>{group}</span>
              <div className="mode-picker">
                {VISUAL_MODES.filter((mode) => mode.group === group).map((mode) => (
                  <button
                    type="button"
                    className={visualMode === mode.id ? "is-selected" : ""}
                    onClick={() => onModeChange(mode.id)}
                    key={mode.id}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="practice-options">
            <span>Practice</span>
            <label>
              <span>Beat reference</span>
              <input type="checkbox" checked={beatReference} onChange={(event) => onBeatReferenceChange(event.target.checked)} />
            </label>
            <label>
              <span>Haptics</span>
              <input type="checkbox" checked={haptics} onChange={(event) => onHapticsChange(event.target.checked)} />
            </label>
          </div>
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
  const drag = useRef({ x: 0, bpm: 0, moved: false });
  const taps = useRef<number[]>([]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, bpm, moved: false };
    event.currentTarget.classList.add("is-dragging");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (Math.abs(event.clientX - drag.current.x) > 6) drag.current.moved = true;
    if (!drag.current.moved) return;
    onChange(clamp(Math.round(drag.current.bpm + (event.clientX - drag.current.x) / 3), MIN_BPM, MAX_BPM));
  };

  const tapTempo = () => {
    const now = performance.now();
    const previousTap = taps.current.at(-1);
    if (!previousTap || now - previousTap > 2_000) taps.current = [now];
    else taps.current = [...taps.current.slice(-5), now];
    if (taps.current.length < 2) return;

    const intervals = taps.current.slice(1).map((tap, index) => tap - taps.current[index]);
    const averageInterval = intervals.reduce((total, interval) => total + interval, 0) / intervals.length;
    onChange(clamp(Math.round(60_000 / averageInterval), MIN_BPM, MAX_BPM));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, shouldTap = true) => {
    event.currentTarget.classList.remove("is-dragging");
    if (shouldTap && !drag.current.moved) tapTempo();
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
      onPointerUp={(event) => endDrag(event)}
      onPointerCancel={(event) => endDrag(event, false)}
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
      <span className="tap-hint">tap tempo · drag to adjust</span>
      <div className="tempo-track" aria-hidden="true">
        <div className="tempo-fill" style={{ width: `${((bpm - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 100}%` }} />
      </div>
    </div>
  );
}
