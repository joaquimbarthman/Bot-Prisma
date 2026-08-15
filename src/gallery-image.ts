import sharp from "sharp";

export async function addPhotoFrame(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "warning" })
    .rotate()
    .resize(1080, 1920, { fit: "cover", position: "attention" })
    .png({ quality: 92 })
    .toBuffer();
}
