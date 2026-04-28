import { uid } from "./id";
import type { ImageAttachment } from "../types";

export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function fileToImageAttachment(
  file: File
): Promise<ImageAttachment> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type))
    throw new Error("Unsupported image format.");
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error("Image too large (>8 MB).");
  const dataUrl = await readAsDataUrl(file);
  const dims = await getImageDimensions(dataUrl).catch(() => undefined);
  return {
    id: uid("att_"),
    type: "image",
    dataUrl,
    name: file.name,
    size: file.size,
    width: dims?.width,
    height: dims?.height,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}
