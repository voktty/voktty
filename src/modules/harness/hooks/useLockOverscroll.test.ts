import { describe, expect, it } from "vitest";

function shouldPreventWheel(
  el: Pick<HTMLElement, "scrollTop" | "scrollLeft" | "clientHeight" | "clientWidth" | "scrollHeight" | "scrollWidth">,
  e: Pick<WheelEvent, "deltaX" | "deltaY">,
) {
  const canScrollX = el.scrollWidth > el.clientWidth + 1;
  const canScrollY = el.scrollHeight > el.clientHeight + 1;
  const atTop = canScrollY && el.scrollTop <= 0 && e.deltaY < 0;
  const atBottom =
    canScrollY &&
    el.scrollTop + el.clientHeight >= el.scrollHeight - 1 &&
    e.deltaY > 0;
  const atLeft = canScrollX && el.scrollLeft <= 0 && e.deltaX < 0;
  const atRight =
    canScrollX &&
    el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 &&
    e.deltaX > 0;
  return atTop || atBottom || atLeft || atRight;
}

describe("useLockOverscroll wheel guard", () => {
  it("does not block horizontal wheel on vertically scrolling containers", () => {
    const el = {
      scrollTop: 0,
      scrollLeft: 0,
      clientHeight: 400,
      clientWidth: 400,
      scrollHeight: 800,
      scrollWidth: 400,
    };

    expect(shouldPreventWheel(el, { deltaX: 40, deltaY: 0 })).toBe(false);
    expect(shouldPreventWheel(el, { deltaX: -40, deltaY: 0 })).toBe(false);
  });

  it("still blocks vertical rubber-band at the top and bottom", () => {
    const el = {
      scrollTop: 0,
      scrollLeft: 0,
      clientHeight: 400,
      clientWidth: 400,
      scrollHeight: 800,
      scrollWidth: 400,
    };

    expect(shouldPreventWheel(el, { deltaX: 0, deltaY: -40 })).toBe(true);

    const atBottom = {
      ...el,
      scrollTop: 400,
    };
    expect(shouldPreventWheel(atBottom, { deltaX: 0, deltaY: 40 })).toBe(true);
  });
});
