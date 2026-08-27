import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "./test-setup";
import {
  Card,
  DataTable,
  EmptyState,
  Metric,
  RecordCard,
  ResponsiveRecords,
  Skeleton,
  type DataColumn,
} from "./data-display";

interface TestRecord {
  id: string;
  name: string;
  questions: number;
}

const records: readonly TestRecord[] = [
  { id: "test-1", name: "JEE Main Mock 1", questions: 90 },
  { id: "test-2", name: "Physics Chapter Test", questions: 25 },
];

const columns: readonly DataColumn<TestRecord>[] = [
  { key: "name", header: "Test", cell: (record) => record.name },
  { key: "questions", header: "Questions", cell: (record) => record.questions },
];

function setViewport(wide: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      addEventListener: vi.fn(),
      matches: media === "(min-width: 48rem)" ? wide : false,
      media,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

describe("data display primitives", () => {
  beforeEach(() => setViewport(false));

  it("renders cards, metrics, empty state, loading status, and named record articles", () => {
    render(
      <>
        <Card title="Performance">Steady progress</Card>
        <Metric label="Tests completed" value="12" />
        <EmptyState
          title="No tests yet"
          description="Create a test to begin."
        />
        <Skeleton label="Loading tests" />
        <RecordCard label="JEE Main Mock 1">90 questions</RecordCard>
      </>,
    );

    expect(
      screen.getByRole("region", { name: "Performance" }),
    ).toHaveTextContent("Steady progress");
    expect(screen.getByText("Tests completed").closest("dl")).toHaveTextContent(
      "12",
    );
    expect(
      screen.getByRole("status", { name: "No tests yet" }),
    ).toHaveTextContent("Create a test to begin.");
    expect(
      screen.getByRole("status", { name: "Loading tests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "JEE Main Mock 1" }),
    ).toHaveTextContent("90 questions");
  });

  it("renders a captioned semantic table", () => {
    render(
      <DataTable
        caption="Available tests"
        columns={columns}
        getRecordId={(record) => record.id}
        records={records}
      />,
    );

    expect(
      screen.getByRole("table", { name: "Available tests" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
});

describe("ResponsiveRecords", () => {
  it("renders only the semantic table on wide screens", () => {
    setViewport(true);
    render(
      <ResponsiveRecords
        caption="Available tests"
        columns={columns}
        getRecordId={(record) => record.id}
        getRecordLabel={(record) => record.name}
        records={records}
      />,
    );

    expect(
      screen.getByRole("table", { name: "Available tests" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("renders only named record articles on narrow screens", () => {
    setViewport(false);
    render(
      <ResponsiveRecords
        caption="Available tests"
        columns={columns}
        getRecordId={(record) => record.id}
        getRecordLabel={(record) => record.name}
        records={records}
      />,
    );

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(
      screen.getByRole("article", { name: "Physics Chapter Test" }),
    ).toHaveTextContent("Questions25");
  });

  it("defaults to record cards during server rendering", () => {
    const html = renderToString(
      <ResponsiveRecords
        caption="Available tests"
        columns={columns}
        getRecordId={(record) => record.id}
        getRecordLabel={(record) => record.name}
        records={records}
      />,
    );

    expect(html).toContain("<article");
    expect(html).not.toContain("<table");
  });
});
