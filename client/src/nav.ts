export function goToGame(gameId: string): void {
  window.location.hash = `#/game/${gameId}`;
}

export function goHome(): void {
  window.location.hash = '#/';
}

export function inviteLink(gameId: string): string {
  return `${window.location.origin}${window.location.pathname}#/join/${gameId}`;
}
