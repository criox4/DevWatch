/**
 * Animates a number from one value to another over a specified duration.
 * Uses ease-out quadratic easing for smooth deceleration.
 *
 * @param element - The DOM element whose textContent will be updated
 * @param from - Starting value
 * @param to - Target value
 * @param durationMs - Animation duration in milliseconds
 * @param formatFn - Optional formatter (defaults to rounded integer)
 * @returns A cancel function to stop the animation mid-flight
 */
export function animateNumber(
  element: HTMLElement,
  from: number,
  to: number,
  durationMs: number,
  formatFn?: (value: number) => string
): () => void {
  const startTime = performance.now();
  let rafId: number | undefined;

  const format = formatFn ?? ((val: number) => Math.round(val).toString());

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / durationMs, 1);

    // Ease-out quadratic: t * (2 - t)
    const eased = progress * (2 - progress);

    const current = from + (to - from) * eased;
    element.textContent = format(current);

    if (progress < 1) {
      rafId = requestAnimationFrame(animate);
    }
  };

  rafId = requestAnimationFrame(animate);

  // Return cancel function
  return () => {
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId);
    }
  };
}
