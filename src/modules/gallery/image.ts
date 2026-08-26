import sharp from "sharp";

const PHOTO_RATIOS = [
  { name: "Stories", ratio: 9 / 16 },
  { name: "Post vertical", ratio: 4 / 5 },
  { name: "Foto vertical comum", ratio: 3 / 4 },
  { name: "Foto horizontal", ratio: 1.91 },
] as const;

const RATIO_TOLERANCE = 0.1;

export function closestPhotoRatio(width: number, height: number): number | null {
  if (!width || !height) return null;
  const ratio = width / height;
  const closest = PHOTO_RATIOS.reduce((best, current) =>
    Math.abs(ratio - current.ratio) / current.ratio < Math.abs(ratio - best.ratio) / best.ratio ? current : best,
  );
  return Math.abs(ratio - closest.ratio) / closest.ratio <= RATIO_TOLERANCE ? closest.ratio : null;
}

export async function prepareGalleryImage(input: Buffer): Promise<{ data: Buffer; extension: "png" | "gif" }> {
  const image = sharp(input, { animated: true, failOn: "warning" });
  const metadata = await image.metadata();

  // Reencodar GIFs como PNG removeria a animação. Eles continuam sendo publicados como GIF.
  if (metadata.format === "gif" && (metadata.pages ?? 1) > 1) return { data: input, extension: "gif" };

  const ratio = closestPhotoRatio(metadata.width ?? 0, metadata.height ?? 0);
  if (!ratio) return { data: await image.rotate().png({ quality: 92 }).toBuffer(), extension: "png" };

  const height = 1920;
  const width = Math.round(height * ratio);
  return {
    data: await image.rotate().resize(width, height, { fit: "cover", position: "centre" }).png({ quality: 92 }).toBuffer(),
    extension: "png",
  };
}
