import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunRecord, Season, SensorsGroupedResponse, SeriesResponse } from "../types";

vi.mock("../api", () => ({
  fetchSeasons: vi.fn(),
  fetchRuns: vi.fn(),
  fetchSensors: vi.fn(),
  fetchSensorsGrouped: vi.fn(),
  fetchScannerStatus: vi.fn(),
  triggerScan: vi.fn(),
  updateNote: vi.fn(),
  querySeries: vi.fn(),
  querySensorData: vi.fn(),
}));

vi.mock("react-plotly.js", () => ({
  default: () => <div data-testid="plotly-mock" />,
}));

vi.mock("../analysis/export-csv", async () => {
  const actual = await vi.importActual<typeof import("../analysis/export-csv")>(
    "../analysis/export-csv",
  );
  return {
    ...actual,
    downloadSeriesCsv: vi.fn(),
  };
});

import App from "../App";
import {
  fetchRuns,
  fetchScannerStatus,
  fetchSeasons,
  fetchSensors,
  fetchSensorsGrouped,
  querySeries,
} from "../api";
import { downloadSeriesCsv } from "../analysis/export-csv";
import { AnalysisWorkspace } from "./AnalysisWorkspace";

const fetchSeasonsMock = vi.mocked(fetchSeasons);
const fetchRunsMock = vi.mocked(fetchRuns);
const fetchSensorsMock = vi.mocked(fetchSensors);
const fetchSensorsGroupedMock = vi.mocked(fetchSensorsGrouped);
const fetchScannerStatusMock = vi.mocked(fetchScannerStatus);
const querySeriesMock = vi.mocked(querySeries);
const downloadSeriesCsvMock = vi.mocked(downloadSeriesCsv);

const seasons: Season[] = [
  { name: "WFR26", year: 2026, table: "wfr26" },
  { name: "WFR25", year: 2025, table: "wfr25" },
];

const run: RunRecord = {
  key: "run-1",
  start_utc: "2026-06-08T21:00:00.000Z",
  end_utc: "2026-06-09T03:00:00.000Z",
  start_local: "2026-06-08T17:00:00-04:00",
  end_local: "2026-06-08T23:00:00-04:00",
  bins: 60,
};

const grouped: SensorsGroupedResponse = {
  updated_at: null,
  dbc_source: "github",
  messages: [
    {
      name: "M160_Temperature_Set_1",
      subsystem: "INV",
      can_id: 160,
      can_id_hex: "0x0A0",
      signals: ["INV_Analog_Input_2"],
    },
  ],
  ungrouped: [],
};

const emptyGrouped: SensorsGroupedResponse = {
  updated_at: null,
  dbc_source: "none",
  messages: [],
  ungrouped: [],
};

function seriesResponse(
  season: string,
  signal: string,
  value: number,
  mode: "raw" | "envelope" = "raw",
): SeriesResponse {
  if (mode === "envelope") {
    return {
      season,
      start: "s",
      end: "e",
      series: {
        [signal]: {
          mode: "envelope",
          resolution_ms: 1000,
          point_count: 1,
          t: [Date.parse(run.start_utc)],
          min: [value - 1],
          max: [value + 1],
          avg: [value],
        },
      },
    };
  }
  return {
    season,
    start: "s",
    end: "e",
    series: {
      [signal]: {
        mode: "raw",
        resolution_ms: null,
        point_count: 1,
        t: [Date.parse(run.start_utc)],
        v: [value],
      },
    },
  };
}

function emptySeriesResponse(season: string, signal: string): SeriesResponse {
  return {
    season,
    start: "s",
    end: "e",
    series: {
      [signal]: {
        mode: "raw",
        resolution_ms: null,
        point_count: 0,
        t: [],
        v: [],
      },
    },
  };
}

function stubAppApis() {
  fetchSeasonsMock.mockResolvedValue(seasons);
  fetchRunsMock.mockImplementation(async (season?: string) => {
    if (season === "WFR25") {
      return { updated_at: null, runs: [] };
    }
    return { updated_at: "2026-07-16T10:00:00Z", runs: [run] };
  });
  fetchSensorsMock.mockResolvedValue({
    updated_at: "2026-07-16T10:00:00Z",
    sensors: ["INV_Analog_Input_2"],
  });
  fetchSensorsGroupedMock.mockResolvedValue(grouped);
  fetchScannerStatusMock.mockResolvedValue({
    scanning: false,
    started_at: null,
    finished_at: null,
    source: null,
    updated_at: null,
  });
  querySeriesMock.mockResolvedValue(seriesResponse("wfr26", "INV_Analog_Input_2", 5));
}

async function flushInitialLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Analysis workspace tabs (App)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubAppApis();
  });

  it("shows Downloader and Analysis tabs with Past Runs initially", async () => {
    render(<App />);
    await flushInitialLoad();

    expect(screen.getByRole("tab", { name: "Downloader" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Past Runs" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Run window/i)).not.toBeInTheDocument();
  });

  it("switches to Analysis workspace while keeping the shared season selected", async () => {
    render(<App />);
    await flushInitialLoad();

    fireEvent.click(screen.getByRole("tab", { name: "Analysis" }));

    expect(screen.getByLabelText(/Run window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Search signals/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Past Runs" })).not.toBeInTheDocument();

    const activeSeason = screen.getByRole("button", { name: "WFR26" });
    expect(activeSeason).toHaveStyle({ fontWeight: "bold" });
  });

  it("queries the season table with exact run UTC bounds and selected signal", async () => {
    render(<App />);
    await flushInitialLoad();

    fireEvent.click(screen.getByRole("tab", { name: "Analysis" }));

    fireEvent.change(screen.getByLabelText(/Run window/i), {
      target: { value: run.key },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "INV_Analog_Input_2" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(querySeriesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        season: "wfr26",
        signals: ["INV_Analog_Input_2"],
        start: run.start_utc,
        end: run.end_utc,
      }),
    );
  });
});

describe("AnalysisWorkspace", () => {
  const runsBySeason: Record<string, RunRecord[]> = {
    WFR26: [run],
    WFR25: [],
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    querySeriesMock.mockReset();
    downloadSeriesCsvMock.mockReset();
  });

  it("clears prior season plots when the season prop changes", async () => {
    const clearSeason: Season = { name: "WFR26", year: 2026, table: "wfr26-clear" };
    querySeriesMock.mockResolvedValue(seriesResponse("wfr26-clear", "INV_Analog_Input_2", 5));

    const { rerender } = render(
      <AnalysisWorkspace
        season={clearSeason}
        runs={[run]}
        grouped={grouped}
        theme="light"
        runsBySeason={runsBySeason}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Run window/i), {
      target: { value: run.key },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "INV_Analog_Input_2" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(await screen.findByTestId("plotly-mock")).toBeInTheDocument();
    expect(querySeriesMock).toHaveBeenCalledTimes(1);

    querySeriesMock.mockClear();
    rerender(
      <AnalysisWorkspace
        season={seasons[1]}
        runs={[]}
        grouped={emptyGrouped}
        theme="light"
        runsBySeason={runsBySeason}
      />,
    );

    expect(screen.queryByTestId("plotly-mock")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "INV_Analog_Input_2" })).not.toBeInTheDocument();
    expect(querySeriesMock).not.toHaveBeenCalled();
  });

  it("does not show the neutral empty state before the first response completes", async () => {
    let resolveSeries!: (value: SeriesResponse) => void;
    querySeriesMock.mockReturnValue(
      new Promise<SeriesResponse>((resolve) => {
        resolveSeries = resolve;
      }),
    );

    const emptySeason: Season = { name: "WFR26", year: 2026, table: "wfr26-empty-timing" };

    render(
      <AnalysisWorkspace
        season={emptySeason}
        runs={[run]}
        grouped={grouped}
        theme="light"
        runsBySeason={runsBySeason}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Run window/i), {
      target: { value: run.key },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "INV_Analog_Input_2" }));

    expect(screen.queryByTestId("analysis-empty")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(screen.queryByTestId("analysis-empty")).not.toBeInTheDocument();
    expect(screen.getByText(/Loading series/i)).toBeInTheDocument();

    await act(async () => {
      resolveSeries(emptySeriesResponse("wfr26-empty-timing", "INV_Analog_Input_2"));
      await Promise.resolve();
    });

    expect(screen.getByTestId("analysis-empty")).toBeInTheDocument();
  });

  it("asks for inline confirmation before exporting envelope data", async () => {
    const envelopeSeason: Season = { name: "WFR26", year: 2026, table: "wfr26-envelope" };
    querySeriesMock.mockResolvedValue(
      seriesResponse("wfr26-envelope", "INV_Analog_Input_2", 5, "envelope"),
    );
    const confirmSpy = vi.spyOn(window, "confirm");

    render(
      <AnalysisWorkspace
        season={envelopeSeason}
        runs={[run]}
        grouped={grouped}
        theme="light"
        runsBySeason={runsBySeason}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Run window/i), {
      target: { value: run.key },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "INV_Analog_Input_2" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(await screen.findByTestId("plotly-mock")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(downloadSeriesCsvMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("analysis-export-confirm")).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId("analysis-export-confirm")).getByRole("button", {
        name: /Export anyway/i,
      }),
    );

    expect(downloadSeriesCsvMock).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });
});
