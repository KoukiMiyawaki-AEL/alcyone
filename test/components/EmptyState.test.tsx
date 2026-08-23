import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TriangleAlertIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

describe("EmptyState", () => {
  it("renders only the title when nothing else is given", () => {
    render(<EmptyState title="No tasks yet" />);

    expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the description and a working action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <EmptyState
        icon={TriangleAlertIcon}
        title="Something went wrong"
        description="タスクの取得に失敗しました。"
        action={<Button onClick={onRetry}>Retry</Button>}
      />,
    );

    expect(screen.getByText("タスクの取得に失敗しました。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
