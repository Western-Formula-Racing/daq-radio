import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import Dropdown from "./Dropdown";

describe("Dropdown light-mode contrast", () => {
  it("keeps menu item labels as text-white on bg-dropdown-menu-bg", async () => {
    const user = userEvent.setup();
    render(
      <Dropdown items={["Export CSV"]} onSelect={() => {}}>
        <span>Menu</span>
      </Dropdown>
    );

    await user.click(screen.getByText("Menu"));
    const item = screen.getByRole("button", { name: "Export CSV" });

    expect(item.className).toMatch(/\btext-white\b/);
    expect(item.className).not.toMatch(/text-text-primary/);
    expect(item.closest(".bg-dropdown-menu-bg")).not.toBeNull();
  });
});
