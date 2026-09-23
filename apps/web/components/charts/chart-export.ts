export async function exportSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
): Promise<void> {
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await loadImage(url);
    const viewBox = svg.viewBox.baseVal;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = viewBox.width * scale;
    canvas.height = viewBox.height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export is unavailable");
    context.scale(scale, scale);
    context.drawImage(image, 0, 0, viewBox.width, viewBox.height);
    const anchor = document.createElement("a");
    anchor.download = filename;
    anchor.href = canvas.toDataURL("image/png");
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render chart image"));
    image.src = url;
  });
}
