import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Hamburger from "./HamburgerMenu";

describe("HamburgerMenu semantic colors", () => {
  it("paints bars with the primary text token instead of hardcoded white", () => {
    const { container } = render(<Hamburger trigger={() => {}} />);
    const bars = container.querySelectorAll("span");

    expect(bars.length).toBe(3);
    for (const bar of bars) {
      expect(bar.className).toMatch(/\bbg-text-primary\b/);
      expect(bar.className).not.toMatch(/\bbg-white\b/);
    }
  });
});
