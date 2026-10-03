export function deletePrivateReplyAfter(
  interaction: { deleteReply(): Promise<unknown> },
  delayMs = 5_000,
): void {
  setTimeout(() => {
    void interaction.deleteReply().catch(() => undefined);
  }, delayMs).unref();
}
