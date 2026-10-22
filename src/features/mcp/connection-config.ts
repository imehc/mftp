export function connectionConfig(endpoint: string, token?: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        mftp: {
          url: endpoint,
          headers: { Authorization: `Bearer ${token ?? "<YOUR_TOKEN>"}` },
        },
      },
    },
    null,
    2,
  );
}
