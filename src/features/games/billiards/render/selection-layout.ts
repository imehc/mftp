export function shortestAngle(from: number, to: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function selectionLayout(
  count: number,
  bounds: { x: number; y: number; width: number; height: number },
  touch: boolean,
) {
  let diameter = Math.min(touch ? 48 : 56, Math.max(40, bounds.width - 24));
  let step = Math.max(52, diameter + 12);
  const maxColumns = Math.max(
    1,
    Math.min(count, Math.floor((bounds.width - 24 + 12) / step)),
  );
  const rows = Math.ceil(count / maxColumns);
  const columns = rows ? Math.ceil(count / rows) : 1;
  if (rows)
    diameter = Math.min(
      diameter,
      Math.max(40, (bounds.height - 24) / rows - 28),
    );
  step = Math.max(52, diameter + 12);
  const rowStep = diameter + 28;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const rowCount = Math.min(columns, count - row * columns);
    return {
      x:
        bounds.x +
        bounds.width / 2 +
        ((index % columns) - (rowCount - 1) / 2) * step,
      y: bounds.y + bounds.height / 2 + (row - (rows - 1) / 2) * rowStep,
      diameter,
    };
  });
}
