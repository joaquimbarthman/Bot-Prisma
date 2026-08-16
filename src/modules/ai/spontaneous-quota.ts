export class SpontaneousReservationLedger {
  private readonly reservations = new Map<string, number>();

  async reserve(discordId: string, configuredLimit: number, loadPersistedCount: () => Promise<number>): Promise<boolean> {
    const limit = Math.min(10, Math.max(1, Math.floor(configuredLimit)));
    const persisted = await loadPersistedCount();
    const reserved = this.reservations.get(discordId) ?? 0;
    if (persisted + reserved >= limit) return false;
    this.reservations.set(discordId, reserved + 1);
    return true;
  }

  release(discordId: string): void {
    const remaining = (this.reservations.get(discordId) ?? 1) - 1;
    if (remaining > 0) this.reservations.set(discordId, remaining);
    else this.reservations.delete(discordId);
  }
}
