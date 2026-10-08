import { describe, expect, it } from "vitest";
import { isGameParticipant, isOpposingPlayer } from "./gameAuthorization.js";

const players = { whiteId: "white-player", blackId: "black-player" };

describe("game socket authorization", () => {
  it("recognizes only the two players as participants", () => {
    expect(isGameParticipant(players, "white-player")).toBe(true);
    expect(isGameParticipant(players, "black-player")).toBe(true);
    expect(isGameParticipant(players, "outsider")).toBe(false);
  });

  it("allows only the other player to accept a draw offer", () => {
    expect(isOpposingPlayer(players, "white-player", "black-player")).toBe(true);
    expect(isOpposingPlayer(players, "black-player", "white-player")).toBe(true);
    expect(isOpposingPlayer(players, "white-player", "white-player")).toBe(false);
    expect(isOpposingPlayer(players, "outsider", "black-player")).toBe(false);
  });
});
