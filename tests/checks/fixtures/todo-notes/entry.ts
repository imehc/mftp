document.getElementById("open")?.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const { mountEditor } = await import("./editor");
  mountEditor();
  button.disabled = true;
});
