export type GameParticipants = {
  whiteId: string | null;
  blackId: string | null;
};

export function isGameParticipant(game: GameParticipants, userId: string) {
  return game.whiteId === userId || game.blackId === userId;
}

export function isOpposingPlayer(
  game: GameParticipants,
  offererId: string,
  responderId: string
) {
  return (
    offererId !== responderId &&
    ((game.whiteId === offererId && game.blackId === responderId) ||
      (game.blackId === offererId && game.whiteId === responderId))
  );
}
