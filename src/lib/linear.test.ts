import { describe, expect, it } from "vitest";
import { linearTeamIdsForFetch } from "./linear";

describe("linearTeamIdsForFetch", () => {
  const teams = [
    { id: "t1", key: "ENG", name: "Engineering" },
    { id: "t2", key: "DES", name: "Design" },
  ];

  it("sends no team filter when nothing is hidden", () => {
    expect(linearTeamIdsForFetch(teams, [])).toEqual([]);
  });

  it("keeps visible team ids", () => {
    expect(linearTeamIdsForFetch(teams, ["t2"])).toEqual(["t1"]);
  });
});
