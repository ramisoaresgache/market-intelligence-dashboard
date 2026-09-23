export type ShareableGraphic = HTMLCanvasElement | SVGSVGElement;

export async function shareGraphic(target: ShareableGraphic, filename: string): Promise<"shared" | "downloaded"> {
  const blob = target instanceof HTMLCanvasElement
    ? await canvasToBlob(target)
    : await svgToPngBlob(target);

  const safeName = filename.toLowerCase().endsWith(".png") ? filename : `${filename}.png`;
  const file = new File([blob], safeName, { type: "image/png" });

  if (typeof navigator.share === "function") {
    try {
      const canShareFiles = typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({
          files: [file],
          title: "Market Intelligence",
          text: "Gráfico de Market Intelligence",
        });
        return "shared";
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "shared";
      // Si el share nativo falla, descargamos el PNG como fallback.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "downloaded";
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("No se pudo generar la imagen del gráfico"));
    }, "image/png");
  });
}

async function svgToPngBlob(source: SVGSVGElement): Promise<Blob> {
  const rect = source.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || source.viewBox.baseVal.width || 1200));
  const height = Math.max(1, Math.round(rect.height || source.viewBox.baseVal.height || 600));
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const clone = source.cloneNode(true) as SVGSVGElement;

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  inlineComputedStyles(source, clone);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas no disponible para exportar SVG");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#0d1118";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function inlineComputedStyles(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceNodes: Element[] = [source, ...source.querySelectorAll("*")];
  const cloneNodes: Element[] = [clone, ...clone.querySelectorAll("*")];
  const properties = [
    "fill",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-dasharray",
    "opacity",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "text-anchor",
  ];

  sourceNodes.forEach((node, index) => {
    const copy = cloneNodes[index] as SVGElement | undefined;
    if (!copy) return;
    const computed = window.getComputedStyle(node);
    const styles = properties
      .map((property) => `${property}:${computed.getPropertyValue(property)}`)
      .join(";");
    copy.setAttribute("style", `${copy.getAttribute("style") ?? ""};${styles}`);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo renderizar el SVG"));
    image.src = url;
  });
}
