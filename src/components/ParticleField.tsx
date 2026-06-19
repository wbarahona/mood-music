import { useMemo } from "react";

const COLORS = [
  "var(--md-sys-color-primary)",
  "var(--md-sys-color-secondary)",
  "var(--md-sys-color-tertiary)",
];

const BLOB_COUNT = 6;
const PARTICLE_COUNT = 38;

interface Props {
  visible: boolean;
}

export function ParticleField({ visible }: Props) {
  const blobs = useMemo(
    () =>
      Array.from({ length: BLOB_COUNT }, (_, i) => ({
        id: i,
        x: 5 + (i * 19 + 7) % 85,
        y: 5 + (i * 23 + 11) % 85,
        size: 140 + (i * 47) % 180,
        color: COLORS[i % COLORS.length],
        duration: 9 + (i * 2.3) % 8,
        delay: -(i * 1.9),
      })),
    [],
  );

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: i,
        x: (i * 2.71) % 100,
        size: 2 + (i * 0.61) % 5,
        color: COLORS[i % COLORS.length],
        duration: 5 + (i * 0.43) % 7,
        delay: -(i * 0.34) % 9,
        driftX: ((i * 13 + 5) % 100) - 50,
      })),
    [],
  );

  return (
    <div
      className="particle-field"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden="true"
    >
      {blobs.map((b) => (
        <div
          key={b.id}
          className="particle-blob"
          style={
            {
              left: `${b.x}%`,
              top: `${b.y}%`,
              width: b.size,
              height: b.size,
              background: b.color,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}

      {particles.map((p) => (
        <div
          key={p.id}
          className="particle-dot"
          style={
            {
              left: `${p.x}%`,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              "--drift": `${p.driftX}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
